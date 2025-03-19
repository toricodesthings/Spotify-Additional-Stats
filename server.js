const express = require("express");
const { chromium } = require("playwright");

const app = express();
const PORT = process.env.PORT || 10000;
const SPOTIFY_WEB_ENDPOINT = "https://open.spotify.com";
const cache = new Map(); // Simple cache

let browserInstance;

// **Start Persistent Playwright Browser**
async function startBrowser() {
    if (!browserInstance) { // Only launch if not already running
        browserInstance = await chromium.launch({
            headless: true,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
            ],
        });
    }
}

// **Helper: Setup route to block unnecessary resources**
async function setupRoute(page) {
    await page.route("**/*", (route, request) => {
        // Block only the following resource types:
        const excludedTypes = ["image", "media", "font"];
        if (excludedTypes.includes(request.resourceType())) {
            route.abort();
        } else {
            route.continue();
        }
    });
}

// **Monthly Listeners with Cache**
async function getMonthlyListeners(artistId) {
    if (cache.has(artistId)) return cache.get(artistId); // Serve from cache

    const page = await browserInstance.newPage();
    await setupRoute(page);
    try {
        await page.goto(`${SPOTIFY_WEB_ENDPOINT}/artist/${artistId}`, { timeout: 10000, waitUntil: "domcontentloaded" });
        const element = await page.waitForSelector("span:has-text('monthly listeners')", { timeout: 25000 });
        const result = { 
            artistId, 
            monthlyListeners: element ? (await element.innerText()).replace(/\D/g, "") : "N/A" 
        };

        cache.set(artistId, result); // Cache result
        setTimeout(() => cache.delete(artistId), 20 * 60 * 1000); // Clear cache after 20 mins

        return result;
    } catch (error) {
        console.error(`Error scraping artist ${artistId}:`, error);
        return { artistId, monthlyListeners: "N/A" };
    } finally {
        await page.close(); // Close the page
    }
}

// **Track Play Count with Optimized Browser**
async function getTrackPlaycount(trackId) {
    const page = await browserInstance.newPage();
    await setupRoute(page);
    try {
        await page.goto(`${SPOTIFY_WEB_ENDPOINT}/track/${trackId}`, { timeout: 10000, waitUntil: "domcontentloaded" });
        const element = await page.waitForSelector("span[data-testid='playcount']", { timeout: 25000 });
        return { 
            trackId, 
            playCount: element ? await element.innerText() : "N/A" 
        };
    } catch (error) {
        console.error(`Error scraping track ${trackId}:`, error);
        return { trackId, playCount: "N/A" };
    } finally {
        await page.close(); // Close the page
    }
}

// **API Routes**
app.get("/get/monthly-listeners/:artistId", async (req, res) => {
    const startTime = Date.now();
    const result = await getMonthlyListeners(req.params.artistId);
    const responseTime = Date.now() - startTime;
    res.json({ ...result, responseTime: `${responseTime} ms` });
});

app.get("/get/playcount/:trackId", async (req, res) => {
    const startTime = Date.now();
    const result = await getTrackPlaycount(req.params.trackId);
    const responseTime = Date.now() - startTime;
    res.json({ ...result, responseTime: `${responseTime} ms` });
});

// **Start Server**
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    await startBrowser();
});
