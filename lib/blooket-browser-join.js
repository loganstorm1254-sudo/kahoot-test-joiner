import chromium from "@sparticuz/chromium-min";
import puppeteer from "puppeteer-core";
import { encryptBlooketPayload } from "./blooket-crypto.js";

const PLAY_ORIGIN = "https://play.blooket.com";
const JOIN_URL = "https://fb.blooket.com/c/firebase/join";
const CHROMIUM_PACK_URL =
  "https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar";

function parseJoinBody(data, statusCode) {
  if (!data || typeof data !== "object") {
    return {
      success: false,
      msg: statusCode === 403 ? "Blocked by Blooket (HTTP 403)." : "Empty join response.",
      httpStatus: statusCode,
    };
  }
  if (!data.success && !data.msg) {
    data.msg = "Could not join that game.";
  }
  data.httpStatus = statusCode;
  return data;
}

async function launchBrowser() {
  if (typeof chromium.setGraphicsMode === "function") {
    chromium.setGraphicsMode(false);
  }

  return puppeteer.launch({
    args: [
      ...chromium.args,
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-setuid-sandbox",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
    ],
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(CHROMIUM_PACK_URL),
    headless: chromium.headless,
  });
}

async function joinInPage(page, { gameId, name, encrypted = false, buildConfig = null }) {
  const payload = { id: String(gameId), name: String(name) };
  let body = JSON.stringify(payload);
  const headers = { "Content-Type": "application/json" };

  if (encrypted) {
    if (!buildConfig?.buildId || !buildConfig?.secret) {
      throw new Error("Missing Blooket build config.");
    }
    body = await encryptBlooketPayload(payload, buildConfig.secret);
    headers["X-Blooket-Build"] = buildConfig.buildId;
  }

  const result = await page.evaluate(
    async ({ joinUrl, body, headers }) => {
      const response = await fetch(joinUrl, {
        method: "PUT",
        credentials: "include",
        headers,
        body,
      });
      const text = await response.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { success: false, msg: `Invalid response (${response.status})` };
      }
      return { status: response.status, data };
    },
    { joinUrl: JOIN_URL, body, headers },
  );

  return parseJoinBody(result.data, result.status);
}

export async function joinBlooketPlayersInBrowser(gameId, names, buildConfig = null) {
  const uniqueNames = [...new Set(names.map((name) => String(name || "").trim()).filter(Boolean))];
  if (!uniqueNames.length) {
    return [];
  }

  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    );
    await page.goto(`${PLAY_ORIGIN}/play?id=${encodeURIComponent(gameId)}`, {
      waitUntil: "domcontentloaded",
      timeout: 25000,
    });

    const results = [];
    let useEncrypted = false;

    for (const name of uniqueNames) {
      let joinData = await joinInPage(page, { gameId, name, encrypted: useEncrypted, buildConfig });

      if (!joinData.success && !useEncrypted && buildConfig) {
        useEncrypted = true;
        joinData = await joinInPage(page, { gameId, name, encrypted: true, buildConfig });
      }

      results.push({ name, ...joinData });
      await new Promise((resolve) => setTimeout(resolve, 120));
    }

    return results;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
