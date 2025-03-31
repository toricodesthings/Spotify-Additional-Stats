const express = require("express");
const { chromium } = require("playwright");
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8443;
const SPOTIFY_WEB_ENDPOINT = "https://open.spotify.com";

const cache = new Map();

let browserInstance;

const USE_HTTPS = true; // On for the time being

// Attempt to load SSL certs if USE_HTTPS is set
let sslOptions;
if (USE_HTTPS) {
  try {
    sslOptions = {
      key: fs.readFileSync(path.join(__dirname, "SSL", "private.key")),
      cert: fs.readFileSync(path.join(__dirname, "SSL", "certificate.crt")),
      ca: fs.readFileSync(path.join(__dirname, "SSL", "ca_bundle.crt")), // if applicable
    };
  } catch (error) {
    console.error("Failed to load SSL certificates, falling back to normal server:", error);
    sslOptions = null;
  }
}
/**
 * Start or restart the persistent Playwright Browser
 */
async function startBrowser() {
  if (!browserInstance) {
    browserInstance = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-extensions",
        // "--disable-gpu",
      ],
    });
    console.log("Browser launched.");
  }
}

/**
 * Force a refresh of the browser instance (close old instance, launch new)
 */
async function refreshBrowser() {
  console.log("Refreshing browser instance...");
  if (browserInstance) {
    try {
      await browserInstance.close();
      console.log("Browser instance closed.");
    } catch (error) {
      console.error("Error closing browser instance:", error);
    }
  }
  await startBrowser();
  console.log("New browser instance launched.");
}

/**
 * Helper: Block unwanted resources to speed up scraping
 * @param {import('playwright').Page} page
 */
async function setupRoute(page) {
  await page.route("**/*", (route, request) => {
    const resourceType = request.resourceType();
    
    const blockedTypes = ["image", "font", "media"];
    if (blockedTypes.includes(resourceType)) {
      route.abort();
    } else {
      route.continue();
    }
  });
}

/**
 * Scrape monthly listeners from an artist page
 * @param {string} artistId
 * @returns {Promise<{artistId: string, monthlyListeners: string}>}
 */
async function getMonthlyListeners(artistId) {
  // Check cache first
  if (cache.has(artistId)) return cache.get(artistId);

  // In case the browser wasn’t started or was closed
  if (!browserInstance) {
    await startBrowser();
  }

  const context = await browserInstance.newContext();
  const page = await context.newPage();
  await setupRoute(page);

  let result = { artistId, monthlyListeners: "N/A" };

  try {
    await page.goto(`${SPOTIFY_WEB_ENDPOINT}/artist/${artistId}`, {
      timeout: 20000, 
      waitUntil: "domcontentloaded"
    });

    const element = await page.waitForSelector("span:has-text('monthly listeners')", {
      timeout: 30000
    });

    if (element) {
      const text = await element.innerText();
      const numericValue = text.replace(/\D/g, "");
      result.monthlyListeners = numericValue;
    }
    
    cache.set(artistId, result);
    setTimeout(() => cache.delete(artistId), 60 * 60 * 1000);
  } catch (error) {
    console.error(`Error scraping artist ${artistId}:`, error);
  } finally {
    await page.close();
    await context.close();
  }

  return result;
}

/**
 * Scrape track play count from a track page
 * @param {string} trackId
 * @returns {Promise<{trackId: string, playCount: string}>}
 */
async function getTrackPlaycount(trackId) {
  if (!browserInstance) {
    await startBrowser();
  }

  const context = await browserInstance.newContext();
  const page = await context.newPage();
  await setupRoute(page);

  let result = { trackId, playCount: "N/A" };

  try {
    await page.goto(`${SPOTIFY_WEB_ENDPOINT}/track/${trackId}`, {
      timeout: 20000,
      waitUntil: "domcontentloaded"
    });


    const element = await page.waitForSelector("span[data-testid='playcount']", {
      timeout: 30000
    });

    if (element) {
      const text = await element.innerText();
      result.playCount = text;
    }
  } catch (error) {
    console.error(`Error scraping track ${trackId}:`, error);
  } finally {
    // Always close context/page
    await page.close();
    await context.close();
  }

  return result;
}

// -- API Routes --

app.get("/get/monthly-listeners/:artistId", async (req, res) => {
  const startTime = Date.now();
  try {
    const result = await getMonthlyListeners(req.params.artistId);
    const responseTime = Date.now() - startTime;
    res.json({ 
      ...result, 
      responseTime: `${responseTime} ms` 
    });
  } catch (error) {
    console.error("Error in /get/monthly-listeners:", error);
    res.status(500).json({ error: "Unable to process request." });
  }
});

app.get("/get/playcount/:trackId", async (req, res) => {
  const startTime = Date.now();
  try {
    const result = await getTrackPlaycount(req.params.trackId);
    const responseTime = Date.now() - startTime;
    res.json({ 
      ...result, 
      responseTime: `${responseTime} ms` 
    });
  } catch (error) {
    console.error("Error in /get/playcount:", error);
    res.status(500).json({ error: "Unable to process request." });
  }
});


async function startServer() {
  if (USE_HTTPS && sslOptions) {
    https.createServer(sslOptions, app).listen(PORT, async () => {
	  console.log(`Detected SSL certs, running custom server https`);
    console.log(`Custom secure server is running on https://localhost:${PORT}`);
    });
  } else {
    http.createServer(app).listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
  }
  await startBrowser();
  setInterval(refreshBrowser, 30 * 60 * 1000);
}

startServer().catch((err) => {
  console.error("Error starting server:", err);
});


