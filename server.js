const express = require("express");
const { chromium } = require("playwright");


const app = express();
const PORT = process.env.PORT || 9001;
const SPOTIFY_WEB_ENDPOINT = "https://open.spotify.com";

// Cache settings
const CACHE_EXPIRY = 60 * 60 * 1000; // 1 hour
const cache = new Map();

// Browser management
let browserInstance = null;
let browserLastRestart = Date.now();
const BROWSER_MAX_LIFETIME = 1 * 60 * 60 * 1000; // 1 hours before forced restart
const BROWSER_RESTART_INTERVAL = 30 * 60 * 1000; // 30 minutes health check

// Request queue management
const requestQueue = [];
let isProcessing = false;
const MAX_CONCURRENT_PAGES = 3; 
let activePages = 0;

/**
 * Start or restart the persistent Playwright Browser
 */
async function startBrowser() {
  try {
    if (browserInstance) {
      await browserInstance.close().catch(err => console.error("Error closing browser:", err));
      browserInstance = null;
    }
    
    browserInstance = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-extensions",
        "--disable-component-update",
        "--disable-gpu",
        "--disable-accelerated-2d-canvas", // Additional performance options
        "--disable-accelerated-video-decode",
        "--disable-software-rasterizer"
      ],
    });
    
    browserLastRestart = Date.now();
    // Only log a fixed string and ISO timestamp (no user input)
    console.log(`Browser launched at ${new Date().toISOString()}`);
    return true;
  } catch (error) {
    console.error("Failed to start browser:", String(error && error.message ? error.message.replace(/[\r\n]/g, "") : "Unknown error"));
    browserInstance = null;
    return false;
  }
}

/**
 * Check browser health and restart if needed
 */
async function checkBrowserHealth() {
  const now = Date.now();
  const browserAge = now - browserLastRestart;
  
  // Force restart if browser is too old
  if (browserAge > BROWSER_MAX_LIFETIME || !browserInstance) {
    // Only log sanitized browser age
    const ageMinutes = Math.floor(browserAge/60000);
    console.log(`Browser health check: Restarting browser (age: ${ageMinutes} minutes)`);
    await startBrowser();
    return;
  }
  
  // Test if browser is responsive
  try {
    const context = await browserInstance.newContext();
    await context.close();
  } catch {
    await startBrowser();
  }
}

/**
 * Helper: Block unwanted resources to speed up scraping
 * @param {import('playwright').Page} page
 */
async function setupPage(page) {
  page.setDefaultNavigationTimeout(20000);
  page.setDefaultTimeout(20000);
  
  await page.route("**/*", (route, request) => {
    const resourceType = request.resourceType();
    const url = request.url();
    
    // Block these resource types completely
    const fullBlockTypes = ["image", "font", "media"];
    
    // Be selective about these types
    if (fullBlockTypes.includes(resourceType)) {
      route.abort();
    } 
    // Selectively block certain scripts/resources
    else if (resourceType === "script" && (
      url.includes("analytics") || 
      url.includes("tracking") || 
      url.includes("gtm.") ||
      url.includes("pixel")
    )) {
      route.abort();
    }
    // Block unneeded fetch/XHR resources
    else if ((resourceType === "fetch" || resourceType === "xhr") && (
      url.includes("recommendations") || 
      url.includes("collector") ||
      url.includes("metrics") ||
      url.includes("analytics")
    )) {
      route.abort();
    } 
    // Allow all other resources including stylesheets
    else {
      route.continue();
    }
  });
}

/**
 * Process the next item in the request queue
 */
async function processQueue() {
  if (isProcessing || requestQueue.length === 0 || activePages >= MAX_CONCURRENT_PAGES) {
    return;
  }
  
  isProcessing = true;
  activePages++;
  
  const task = requestQueue.shift();
  
  try {
    if (!browserInstance) {
      await startBrowser();
      if (!browserInstance) {
        throw new Error("Failed to start browser");
      }
    }
    
    const result = await task.execute();
    task.resolve(result);
  } catch (error) {
    const safeType = typeof task.type === "string" ? task.type.replace(/[\r\n]/g, "") : "unknown";
    const safeMsg = String(error && error.message ? error.message.replace(/[\r\n]/g, "") : "Unknown error");
    console.error(`Error processing task: ${safeType}`, safeMsg);
    task.reject(error);
    
    if (error.message.includes("Browser") || error.message.includes("context")) {
      await startBrowser();
    }
  } finally {
    activePages--;
    isProcessing = false;
    
    setImmediate(processQueue);
  }
}

/**
 * Add a task to the queue
 * @param {string} type - Task type
 * @param {Function} execute - Function that returns a promise
 * @returns {Promise} - Promise that resolves with the task result
 */
function queueTask(type, execute) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ type, execute, resolve, reject });
    setImmediate(processQueue);
  });
}

/**
 * Generic helper function to scrape data from Spotify
 * @param {Object} options - Configuration options
 * @param {string} options.type - Type of entity (artist or track)
 * @param {string} options.id - Entity ID
 * @param {string} options.path - URL path component
 * @param {Array} options.selectionStrategies - Array of strategies to locate the element
 * @param {Function} options.processText - Function to process the text
 * @returns {Promise<Object>} - Promise with the scraped data
 */
async function scrapeSpotifyData(options) {
  const { type, id, path, selectionStrategies, processText } = options;
  const cacheKey = `${type}:${id}`;
  
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }
  
  return queueTask(`${type}-data`, async () => {
    if (!/^[A-Za-z0-9]{22}$/.test(id)) {
      throw new Error(`Invalid ${type}Id format`);
    }

    let context = null;
    let page = null;
    let result = { [`${type}Id`]: id };
    
    // Set default value based on type
    if (type === 'artist') {
      result.monthlyListeners = "N/A";
    } else if (type === 'track') {
      result.playCount = "N/A";
    }

    try {
      if (!browserInstance || !browserInstance.isConnected()) {
        console.log("Browser instance invalid, attempting restart before task execution.");
        await startBrowser();
        if (!browserInstance) throw new Error("Browser restart failed.");
      }
      
      context = await browserInstance.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
      });
      
      page = await context.newPage({ viewport: { width: 500, height: 300 } });
      await setupPage(page);

      try {
        await page.goto(`${SPOTIFY_WEB_ENDPOINT}/${path}/${id}`, {
          timeout: 20000,
          waitUntil: "domcontentloaded"
        });
      } catch (navError) {
        throw new Error(`Navigation failed for ${type} ${id}: ${navError.message}`);
      }

      let element;
      let strategyUsed = "none";
      try {
        // Execute strategies in parallel and use the first successful one
        const strategyPromises = selectionStrategies.map(strategy => strategy(page));
        const strategyResult = await Promise.race(strategyPromises.map(p => p.catch(e => null)));
        
        if (strategyResult) {
          element = strategyResult.element;
          strategyUsed = strategyResult.strategy;
          console.log(`Successfully found element using strategy: ${strategyUsed} for ${type} ${id}`);
        } else {
          throw new Error("All strategies returned null");
        }
      } catch (selectorError) {
        console.warn(`All selectors failed for ${type} ${id}: ${selectorError.message}`);
      }

      if (element) {
        const text = await element.innerText();
        processText(result, text);
      }

      cache.set(cacheKey, result);
      setTimeout(() => cache.delete(cacheKey), CACHE_EXPIRY);

      return result;
    } catch (taskError) {
      console.error(`Error during ${type} data scraping for ${id}:`, taskError.message);
      throw taskError;
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (err) {
          console.error(`Error closing page for ${type} ${id}:`, err.message);
        }
      }
      if (context) {
        try {
          await context.close();
        } catch (err) {
          console.error(`Error closing context for ${type} ${id}:`, err.message);
        }
      }
    }
  });
}

/**
 * Scrape monthly listeners from an artist page
 * @param {string} artistId
 * @returns {Promise<{artistId: string, monthlyListeners: string}>}
 */
async function getMonthlyListeners(artistId) {
  return scrapeSpotifyData({
    type: 'artist',
    id: artistId,
    path: 'artist',
    selectionStrategies: [
      // Strategy 1: Locator with filter
      async (page) => {
        try {
          const el = await page.locator("span").filter({ hasText: /[\d,]+ monthly listeners/ }).first();
          return { element: el, strategy: "locator-filter" };
        } catch (e) {
          return null;
        }
      },
      
      // Strategy 2: Text-based selector
      async (page) => {
        try {
          const el = await page.waitForSelector("span:has-text('monthly listeners')", {
            timeout: 15000
          });
          return { element: el, strategy: "has-text-selector" };
        } catch (e) {
          return null;
        }
      }
    ],
    processText: (result, text) => {
      const numericValue = text.replace(/\D/g, "");
      result.monthlyListeners = numericValue;
    }
  });
}

/**
 * Scrape track play count from a track page
 * @param {string} trackId
 * @returns {Promise<{trackId: string, playCount: string}>}
 */
async function getTrackPlaycount(trackId) {
  return scrapeSpotifyData({
    type: 'track',
    id: trackId,
    path: 'track',
    selectionStrategies: [
      // Strategy 1: Using data-testid
      async (page) => {
        try {
          const el = await page.waitForSelector("span[data-testid='playcount']", {
            timeout: 15000
          });
          return { element: el, strategy: "data-testid" };
        } catch (e) {
          return null;
        }
      },
      
      // Strategy 2: Using locator with filter
      async (page) => {
        try {
          const el = await page.locator("span").filter({ hasText: /^[0-9,]+$/ }).first();
          return { element: el, strategy: "locator-filter" };
        } catch (e) {
          return null;
        }
      },
      
      // Strategy 3: JavaScript evaluation
      async (page) => {
        try {
          const text = await page.evaluate(() => {
            // Look for spans containing only numbers and commas (likely play counts)
            const spans = Array.from(document.querySelectorAll('span'));
            const playCountSpan = spans.find(span => 
              span.innerText && /^[0-9,]+$/.test(span.innerText.trim()));
            
            return playCountSpan ? playCountSpan.innerText : null;
          });
          
          if (text) {
            return { 
              element: { innerText: async () => text },
              strategy: "evaluate-text" 
            };
          }
          return null;
        } catch (e) {
          return null;
        }
      }
    ],
    processText: (result, text) => {
      result.playCount = text;
    }
  });
}

// -- API Routes --
app.get("/get/monthly-listeners/:artistId", async (req, res) => {
  const startTime = Date.now();
  try {
    const result = await getMonthlyListeners(req.params.artistId);
    const responseTime = Date.now() - startTime;
    res.json({
      ...result,
      responseTime: `${responseTime} ms`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    // Only log sanitized error message
    console.error("Error in /get/monthly-listeners:", String(error && error.message ? error.message.replace(/[\r\n]/g, "") : "Unknown error"));
    res.status(500).json({
      error: "Unable to process request.",
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.get("/get/playcount/:trackId", async (req, res) => {
  const startTime = Date.now();
  try {
    const result = await getTrackPlaycount(req.params.trackId);
    const responseTime = Date.now() - startTime;
    res.json({
      ...result,
      responseTime: `${responseTime} ms`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    // Only log sanitized error message
    console.error("Error in /get/playcount:", String(error && error.message ? error.message.replace(/[\r\n]/g, "") : "Unknown error"));
    res.status(500).json({
      error: "Unable to process request.",
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Health check endpoint
app.get("/get/health", async (req, res) => {
  const browserStatus = browserInstance ? "running" : "not running";
  const uptime = process.uptime();
  const browserAge = browserInstance ? (Date.now() - browserLastRestart) / 1000 : 0;
  
  res.json({
    status: "normal",
    serverUptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`,
    browserStatus,
    browserUptime: browserInstance ? `${Math.floor(browserAge / 3600)}h ${Math.floor((browserAge % 3600) / 60)}m ${Math.floor(browserAge % 60)}s` : "N/A",
    queueLength: requestQueue.length,
    activePages,
    timestamp: new Date().toISOString()
  });
});

async function startServer() {
  // Start the HTTP server with Express
  app.listen(PORT, async () => {
    // Only log fixed string and port
    console.log(`Server is running on http://localhost:${PORT}`);
  });
  
  // Start browser
  await startBrowser();
  
  // Set up periodic health checks and browser restarts
  setInterval(checkBrowserHealth, BROWSER_RESTART_INTERVAL);
  
  // Start queue processing
  for (let i = 0; i < MAX_CONCURRENT_PAGES; i++) {
    setImmediate(processQueue);
  }
}

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', String(error && error.message ? error.message.replace(/[\r\n]/g, "") : "Unknown error"));
  process.exit(1)
});

process.on('unhandledRejection', (reason, promise) => {
  const safeReason = String(reason && reason.message ? reason.message.replace(/[\r\n]/g, "") : "Unknown reason");
  console.error('Unhandled Rejection at:', promise, 'reason:', safeReason);
});

startServer().catch((err) => {
  console.error("Error starting server:", err);
});
