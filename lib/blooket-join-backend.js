import chromium from "@sparticuz/chromium-min";
import puppeteer from "puppeteer-core";

const PLAY_ORIGIN = "https://play.blooket.com";
const JOIN_URL = "https://fb.blooket.com/c/firebase/join";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const CHROMIUM_ARGS = [
  ...chromium.args,
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--disable-setuid-sandbox",
  "--no-first-run",
  "--no-zygote",
  "--single-process",
];

async function launchBrowser() {
  return puppeteer.launch({
    args: CHROMIUM_ARGS,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
    ignoreHTTPSErrors: true,
  });
}

async function joinOnPage(page, gameId, name) {
  return page.evaluate(
    async ({ joinUrl, id, playerName }) => {
      const response = await fetch(joinUrl, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name: playerName }),
      });
      const text = await response.text();
      try {
        const data = JSON.parse(text);
        return { ...data, httpStatus: response.status };
      } catch {
        return {
          success: false,
          msg: text?.slice(0, 120) || `Invalid response (${response.status})`,
          httpStatus: response.status,
        };
      }
    },
    { joinUrl: JOIN_URL, id: gameId, name },
  );
}

export async function joinBlooketPlayers(gameId, names) {
  const uniqueNames = [...new Set(names.map((name) => String(name || "").trim()).filter(Boolean))];
  if (!uniqueNames.length) {
    return [];
  }

  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);

    await page.goto(`${PLAY_ORIGIN}/play?id=${encodeURIComponent(gameId)}`, {
      waitUntil: "networkidle2",
      timeout: 45000,
    });

    await page
      .waitForFunction(
        () => {
          const text = document.body?.innerText || "";
          return !/checking your browser|just a moment/i.test(text) && text.length > 40;
        },
        { timeout: 30000 },
      )
      .catch(() => {});

    const results = [];
    for (const name of uniqueNames) {
      const joinData = await joinOnPage(page, gameId, name);
      results.push({ name, ...joinData });
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    return results;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
