const express = require("express");
const puppeteer = require("puppeteer");

const app = express();
const PORT = process.env.PORT || 10000;
const SPOTIFY_WEB_ENDPOINT = "https://open.spotify.com";
const cache = new Map(); // Simple cache

let browserInstance;
const pagePool = [];
const MAX_PAGES = 5; // Adjust based on expected concurrency

// Launch Puppeteer with more aggressive options
async function startBrowser() {
  if (browserInstance) await browserInstance.close();
  browserInstance = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
      "--no-zygote"
    ],
  });

  // Pre-create a pool of pages for reuse
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await browserInstance.newPage();
    await setupPage(page);
    pagePool.push(page);
  }
}

// Setup page with request interception, caching, and a minimal viewport
async function setupPage(page) {
  await page.setCacheEnabled(true);
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const type = req.resourceType();
    const url = req.url();
    // Block images and fonts; block common analytics/ads
    if (["image", "font"].includes(type)) {
      req.abort();
    } else if (url.includes("google-analytics") || url.includes("doubleclick") || url.includes("ads")) {
      req.abort();
    } else {
      req.continue();
    }
  });
  // Set a common user agent and minimal viewport to speed rendering
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/90.0.4430.85 Safari/537.36");
  await page.setViewport({ width: 1280, height: 720 });
}

// Get a page from the pool or create a new one if needed
async function getPage() {
  if (pagePool.length > 0) {
    return pagePool.pop();
  }
  const page = await browserInstance.newPage();
  await setupPage(page);
  return page;
}

// Return a page to the pool for reuse
function releasePage(page) {
  pagePool.push(page);
}

// Get monthly listeners with aggressive timeouts and querySelector-based search
async function getMonthlyListeners(artistId) {
  if (cache.has(artistId)) return cache.get(artistId);
  
  const page = await getPage();
  try {
    await page.goto(`${SPOTIFY_WEB_ENDPOINT}/artist/${artistId}`, {
      timeout: 8000,
      waitUntil: "domcontentloaded"
    });
    
    // Wait for a span that includes the text "monthly listeners" using querySelector
    await page.waitForFunction(() => {
      return Array.from(document.querySelectorAll("span")).some(el => el.innerText && el.innerText.toLowerCase().includes("monthly listeners"));
    }, { timeout: 15000 });
    
    const text = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll("span")).find(el => el.innerText && el.innerText.toLowerCase().includes("monthly listeners"));
      return el ? el.innerText : "N/A";
    });
    
    const result = { artistId, monthlyListeners: text.replace(/\D/g, "") };
    cache.set(artistId, result);
    setTimeout(() => cache.delete(artistId), 20 * 60 * 1000); // Invalidate cache after 20 minutes
    return result;
  } catch (error) {
    console.error(`Error scraping artist ${artistId}:`, error);
    return { artistId, monthlyListeners: "N/A" };
  } finally {
    releasePage(page);
  }
}

// Get track playcount with similar optimizations
async function getTrackPlaycount(trackId) {
  const page = await getPage();
  try {
    await page.goto(`${SPOTIFY_WEB_ENDPOINT}/track/${trackId}`, {
      timeout: 8000,
      waitUntil: "domcontentloaded"
    });
    await page.waitForSelector("span[data-testid='playcount']", { timeout: 15000 });
    const playCount = await page.evaluate(() => {
      const el = document.querySelector("span[data-testid='playcount']");
      return el ? el.innerText : "N/A";
    });
    return { trackId, playCount };
  } catch (error) {
    console.error(`Error scraping track ${trackId}:`, error);
    return { trackId, playCount: "N/A" };
  } finally {
    releasePage(page);
  }
}

// API Routes with response time included
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

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await startBrowser();
});
