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
const BROWSER_MAX_LIFETIME = 4 * 60 * 60 * 1000; // 4 hours before forced restart
const BROWSER_RESTART_INTERVAL = 30 * 60 * 1000; // 30 minutes health check

// Request queue management
const requestQueue = [];
let isProcessing = false;
const MAX_CONCURRENT_PAGES = 2; // Reduced to 2 concurrent pages as requested
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
        "--js-flags=--max-old-space-size=1024",
      ],
    });
    
    browserLastRestart = Date.now();
    console.log(`Browser launched at ${new Date().toISOString()}`);
    return true;
  } catch (error) {
    console.error("Failed to start browser:", error);
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
    console.log(`Browser health check: Restarting browser (age: ${Math.floor(browserAge/60000)} minutes)`);
    await startBrowser();
    return;
  }
  
  // Test if browser is responsive
  try {
    const context = await browserInstance.newContext();
    await context.close();
    console.log("Browser health check: Browser is responsive");
  } catch (error) {
    console.error("Browser health check: Browser is unresponsive, restarting:", error);
    await startBrowser();
  }
}

/**
 * Helper: Block unwanted resources to speed up scraping
 * @param {import('playwright').Page} page
 */
async function setupPage(page) {
  page.setDefaultNavigationTimeout(15000);
  page.setDefaultTimeout(15000);
  
  await page.route("**/*", (route, request) => {
    const resourceType = request.resourceType();
    const blockedTypes = ["image", "font", "media", "xhr"];
    if (blockedTypes.includes(resourceType)) {
      route.abort();
    } else {
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
    console.error(`Error processing task: ${task.type}`, error);
    task.reject(error);
    
    if (error.message.includes("Browser") || error.message.includes("context")) {
      await startBrowser();
    }
  } finally {
    activePages--;
    isProcessing = false;
    
    // Process next item
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
 * Scrape monthly listeners from an artist page
 * @param {string} artistId
 * @returns {Promise<{artistId: string, monthlyListeners: string}>}
 */
async function getMonthlyListeners(artistId) {
  if (cache.has(`artist:${artistId}`)) {
    return cache.get(`artist:${artistId}`);
  }
  
  return queueTask("monthly-listeners", async () => {
    let context = null;
    let page = null;
    let result = { artistId, monthlyListeners: "N/A" };
    
    try {
      context = await browserInstance.newContext();
      page = await context.newPage();
      await setupPage(page);
      
      await page.goto(`${SPOTIFY_WEB_ENDPOINT}/artist/${artistId}`, {
        timeout: 20000,
        waitUntil: "domcontentloaded"
      });
      
      const element = await page.waitForSelector("span:has-text('monthly listeners')", {
        timeout: 15000
      });
      
      if (element) {
        const text = await element.innerText();
        const numericValue = text.replace(/\D/g, "");
        result.monthlyListeners = numericValue;
      }
      
      cache.set(`artist:${artistId}`, result);
      setTimeout(() => cache.delete(`artist:${artistId}`), CACHE_EXPIRY);
      
      return result;
    } finally {
      if (page) await page.close().catch(err => console.error("Error closing page:", err));
      if (context) await context.close().catch(err => console.error("Error closing context:", err));
    }
  });
}

/**
 * Scrape track play count from a track page
 * @param {string} trackId
 * @returns {Promise<{trackId: string, playCount: string}>}
 */
async function getTrackPlaycount(trackId) {
  if (cache.has(`track:${trackId}`)) {
    return cache.get(`track:${trackId}`);
  }
  
  return queueTask("track-playcount", async () => {
    let context = null;
    let page = null;
    let result = { trackId, playCount: "N/A" };
    
    try {
      context = await browserInstance.newContext();
      page = await context.newPage();
      await setupPage(page);
      
      await page.goto(`${SPOTIFY_WEB_ENDPOINT}/track/${trackId}`, {
        timeout: 20000,
        waitUntil: "domcontentloaded"
      });
      
      const element = await page.waitForSelector("span[data-testid='playcount']", {
        timeout: 15000
      });
      
      if (element) {
        const text = await element.innerText();
        result.playCount = text;
      }
      
      cache.set(`track:${trackId}`, result);
      setTimeout(() => cache.delete(`track:${trackId}`), CACHE_EXPIRY);
      
      return result;
    } finally {
      if (page) await page.close().catch(err => console.error("Error closing page:", err));
      if (context) await context.close().catch(err => console.error("Error closing context:", err));
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
    console.error("Error in /get/monthly-listeners:", error);
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
    console.error("Error in /get/playcount:", error);
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
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

startServer().catch((err) => {
  console.error("Error starting server:", err);
});
