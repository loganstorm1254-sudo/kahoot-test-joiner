const PLAY_ORIGIN = "https://play.blooket.com";
const JOIN_URL = "https://fb.blooket.com/c/firebase/join";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function parseJoinBody(text, statusCode) {
  if (!text) {
    return {
      success: false,
      msg: statusCode === 403 ? "Blocked by Blooket (HTTP 403)." : "Empty join response.",
      httpStatus: statusCode,
    };
  }

  try {
    const data = JSON.parse(text);
    if (!data.success && !data.msg) {
      data.msg = "Could not join that game.";
    }
    data.httpStatus = statusCode;
    return data;
  } catch {
    const preview = String(text).replace(/\s+/g, " ").slice(0, 160);
    const blocked = statusCode === 403 || /cloudflare|cf-browser-verification/i.test(preview);
    return {
      success: false,
      msg: blocked ? "Blocked by Blooket security (Cloudflare)." : `Unexpected response (HTTP ${statusCode}).`,
      httpStatus: statusCode,
      preview,
    };
  }
}

function mergeSetCookie(existing, setCookieHeader) {
  const jar = new Map();
  for (const part of String(existing || "").split(";").map((c) => c.trim()).filter(Boolean)) {
    const [name, ...rest] = part.split("=");
    if (name) {
      jar.set(name, rest.join("="));
    }
  }
  if (setCookieHeader) {
    const chunks = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    for (const chunk of chunks) {
      const first = String(chunk).split(";")[0];
      const [name, ...rest] = first.split("=");
      if (name) {
        jar.set(name.trim(), rest.join("="));
      }
    }
  }
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function blooketHeaders(cookie = "", extra = {}) {
  return {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    Origin: PLAY_ORIGIN,
    Referer: `${PLAY_ORIGIN}/play`,
    "User-Agent": USER_AGENT,
    ...(cookie ? { Cookie: cookie } : {}),
    ...extra,
  };
}

async function warmFetchSession(gameId) {
  let cookies = "";
  const response = await fetch(`${PLAY_ORIGIN}/play?id=${encodeURIComponent(gameId)}`, {
    headers: blooketHeaders(),
    redirect: "follow",
  });
  cookies = mergeSetCookie(cookies, response.headers.getSetCookie?.() || response.headers.get("set-cookie"));
  return cookies;
}

async function fetchJoin(gameId, name, cookies, extraHeaders = {}) {
  const response = await fetch(JOIN_URL, {
    method: "PUT",
    headers: blooketHeaders(cookies, extraHeaders),
    body: JSON.stringify({ id: String(gameId), name: String(name) }),
  });
  const text = await response.text();
  return parseJoinBody(text, response.status);
}

async function joinWithFetch(gameId, names) {
  const cookies = await warmFetchSession(gameId);
  const results = [];

  for (const name of names) {
    const joinData = await fetchJoin(gameId, name, cookies);
    results.push({ name, ...joinData });
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  return results;
}

async function joinWithPuppeteer(gameId, names) {
  const chromium = (await import("@sparticuz/chromium")).default;
  const puppeteer = (await import("puppeteer-core")).default;

  if (typeof chromium.setGraphicsMode === "function") {
    chromium.setGraphicsMode(false);
  }

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.goto(`${PLAY_ORIGIN}/play?id=${encodeURIComponent(gameId)}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    await page
      .waitForFunction(
        () => {
          const text = document.body?.innerText || "";
          return text.includes("Game ID") || text.includes("Blooket") || text.length > 80;
        },
        { timeout: 20000 },
      )
      .catch(() => {});

    const results = [];
    for (const name of names) {
      const joinData = await page.evaluate(
        async ({ joinUrl, id, playerName }) => {
          const response = await fetch(joinUrl, {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, name: playerName }),
          });
          const text = await response.text();
          try {
            return { ...JSON.parse(text), httpStatus: response.status };
          } catch {
            return {
              success: false,
              msg: `Invalid response (${response.status})`,
              httpStatus: response.status,
            };
          }
        },
        { joinUrl: JOIN_URL, id: gameId, name },
      );
      results.push({ name, ...joinData });
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    return results;
  } finally {
    await browser.close().catch(() => {});
  }
}

export async function joinBlooketPlayers(gameId, names) {
  const uniqueNames = [...new Set(names.map((name) => String(name || "").trim()).filter(Boolean))];
  if (!uniqueNames.length) {
    return [];
  }

  try {
    return await joinWithPuppeteer(gameId, uniqueNames);
  } catch (puppeteerError) {
    console.error("Puppeteer join failed, falling back to fetch:", puppeteerError?.message || puppeteerError);
    return joinWithFetch(gameId, uniqueNames);
  }
}
