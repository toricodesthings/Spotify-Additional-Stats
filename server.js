/* For Personal and Education Purposes Only */
const express = require("express");
const { chromium } = require("playwright");

const app = express();
const PORT = process.env.PORT || 5000;
const SPOTIFY_WEB_ENDPOINT = "https://open.spotify.com";

let browserInstance;
let artistPage, trackPage;

// **Start Persistent Browser & Preload Pages**
async function startBrowser() {
    if (!browserInstance) {
        browserInstance = await chromium.launchPersistentContext("/tmp/playwright", {
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });
        artistPage = await browserInstance.newPage();
        trackPage = await browserInstance.newPage();
    }
    return browserInstance;
}

// **Reduce Request Workload**
async function blockUnnecessaryRequests(page) {
    await page.route("**/*", async (route) => {
        if (["image", "font", "media", "xhr", "websocket", "eventsource"].includes(route.request().resourceType())) {
            await route.abort();
        } else {
            await route.continue();
        }
    });
}

// **Monthly Listeners**
async function getMonthlyListeners(artistId) {
    const startTime = Date.now();
    const artistUrl = `${SPOTIFY_WEB_ENDPOINT}/artist/${artistId}`;
    let data = "N/A";

    try {
        await artistPage.goto(artistUrl, { timeout: 6000, waitUntil: "domcontentloaded" });

        const element = await artistPage.waitForSelector("span:has-text('monthly listeners')", { timeout: 3000 });
        const text = await element.innerText();
        data = text.replace(/\D/g, "") || "N/A";
    } catch (error) {
        console.error(`Error scraping artist ${artistId}:`, error);
    }

    const responseTime = Date.now() - startTime;
    return { artistId, monthlyListeners: data, responseTime: `${responseTime}ms` };
}

// **Scrape Track Play Count with Time Tracking**
async function getTrackPlaycount(trackId) {
    const startTime = Date.now();
    const trackUrl = `${SPOTIFY_WEB_ENDPOINT}/track/${trackId}`;
    let data = "N/A";

    try {
        await trackPage.goto(trackUrl, { timeout: 6000, waitUntil: "domcontentloaded" });

        const element = await trackPage.waitForSelector("span[data-testid='playcount']", { timeout: 3000 });
        data = await element.innerText() || "N/A";
    } catch (error) {
        console.error(`Error scraping track ${trackId}:`, error);
    }

    const responseTime = Date.now() - startTime;
    return { trackId, playCount: data, responseTime: `${responseTime}ms` };
}

// **API Route 1 - Monthly Listeners**
app.get("/get/monthly-listeners/:artistId", async (req, res) => {
    const result = await getMonthlyListeners(req.params.artistId);
    res.json(result);
});

// **API Route 2 - Individual Track Play Count**
app.get("/get/playcount/:trackId", async (req, res) => {
    const result = await getTrackPlaycount(req.params.trackId);
    res.json(result);
});

// **Start the Server & Browser**
app.listen(PORT, async () => {
    console.log(`Server is running on port ${PORT}`);
    await startBrowser();
    await blockUnnecessaryRequests(artistPage);
    await blockUnnecessaryRequests(trackPage);
});
