const express = require("express");
const { chromium } = require("playwright");

const app = express();
const PORT = process.env.PORT || 10000;
const SPOTIFY_WEB_ENDPOINT = "https://open.spotify.com";
const cache = new Map(); // Simple in-memory cache

let browserInstance;
let context;
const pagePool = [];
const MAX_POOL_SIZE = 5;

// Start Playwright Browser with a persistent context
async function startBrowser() {
  if (browserInstance) await browserInstance.close();
  browserInstance = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  context = await browserInstance.newContext();
}

// Get a page from the pool or create a new one
async function getPage() {
  if (pagePool.length > 0) {
    return pagePool.pop();
  }
  return await context.newPage();
}

// Release a page back to the pool after resetting its state
async function releasePage(page) {
  try {
    // Navigate to about:blank to clear any previous state
    await page.goto("about:blank", { waitUntil: "domcontentloaded" });
  } catch (e) {
    // Ignore any errors during reset
  }
  if (pagePool.length < MAX_POOL_SIZE) {
    pagePool.push(page);
  } else {
    await page.close();
  }
}

// Get monthly listeners with caching
async function getMonthlyListeners(artistId) {
  if (cache.has(artistId)) return cache.get(artistId);

  const page = await getPage();
  try {
    await page.goto(`${SPOTIFY_WEB_ENDPOINT}/artist/${artistId}`, {
      timeout: 10000,
      waitUntil: "domcontentloaded",
    });
    const element = await page.waitForSelector("span:has-text('monthly listeners')", {
      timeout: 25000,
    });
    const monthlyListeners = element
      ? (await element.innerText()).replace(/\D/g, "")
      : "N/A";
    const result = { artistId, monthlyListeners };

    cache.set(artistId, result);
    // Clear cache after 20 minutes
    setTimeout(() => cache.delete(artistId), 20 * 60 * 1000);
    return result;
  } catch (error) {
    console.error(`Error scraping artist ${artistId}:`, error);
    return { artistId, monthlyListeners: "N/A" };
  } finally {
    await releasePage(page);
  }
}

// Get track play count using a pooled page
async function getTrackPlaycount(trackId) {
  const page = await getPage();
  try {
    await page.goto(`${SPOTIFY_WEB_ENDPOINT}/track/${trackId}`, {
      timeout: 10000,
      waitUntil: "domcontentloaded",
    });
    const element = await page.waitForSelector("span[data-testid='playcount']", {
      timeout: 25000,
    });
    return { trackId, playCount: element ? await element.innerText() : "N/A" };
  } catch (error) {
    console.error(`Error scraping track ${trackId}:`, error);
    return { trackId, playCount: "N/A" };
  } finally {
    await releasePage(page);
  }
}

// API Routes with response time measurement
app.get("/get/monthly-listeners/:artistId", async (req, res) => {
  const start = Date.now();
  const result = await getMonthlyListeners(req.params.artistId);
  const responseTime = Date.now() - start;
  res.json({ ...result, responseTime });
});

app.get("/get/playcount/:trackId", async (req, res) => {
  const start = Date.now();
  const result = await getTrackPlaycount(req.params.trackId);
  const responseTime = Date.now() - start;
  res.json({ ...result, responseTime });
});

// Start Server and Browser
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await startBrowser();
});
