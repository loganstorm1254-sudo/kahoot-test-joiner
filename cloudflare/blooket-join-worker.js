import puppeteer from "@cloudflare/puppeteer";

const PLAY_ORIGIN = "https://play.blooket.com";
const JOIN_URL = "https://fb.blooket.com/c/firebase/join";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const BUILD_UUID_RE = /\w{8}-\w{4}-\w{4}-\w{4}-\w{12}/;
const SECRET_RE = /\(new TextEncoder\)\.encode\("(.+?)"\)/;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store, no-cache, must-revalidate",
  };
}

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

function isBlockedJoin(joinData) {
  return (
    !joinData.success &&
    (joinData.httpStatus === 403 || /blocked by blooket|cloudflare/i.test(joinData.msg || ""))
  );
}

function mergeSetCookie(existing, setCookieHeader) {
  const jar = new Map();
  for (const part of String(existing || "")
    .split(";")
    .map((c) => c.trim())
    .filter(Boolean)) {
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

function requestHeaders(cookie = "", extra = {}) {
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

async function fetchText(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  const setCookie = response.headers.getSetCookie?.() || response.headers.get("set-cookie");
  return { response, text, setCookie };
}

async function encryptBlooketPayload(payload, secret) {
  const blocks = new TextEncoder().encode(JSON.stringify(payload));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, blocks);
  const ivText = Array.from(iv, (byte) => String.fromCharCode(byte)).join("");
  const cipherText = Array.from(new Uint8Array(ciphertext), (byte) => String.fromCharCode(byte)).join("");
  return btoa(ivText + cipherText);
}

function parseBuildConfigFromSource(source) {
  if (!source || typeof source !== "string") {
    return null;
  }
  if (!BUILD_UUID_RE.test(source) || !SECRET_RE.test(source)) {
    return null;
  }
  return {
    buildId: source.match(BUILD_UUID_RE)[0],
    secret: source.match(SECRET_RE)[1],
  };
}

async function warmSession(gameId) {
  let cookies = "";
  const { setCookie } = await fetchText(`${PLAY_ORIGIN}/play?id=${encodeURIComponent(gameId)}`, {
    headers: requestHeaders(),
    redirect: "follow",
  });
  cookies = mergeSetCookie(cookies, setCookie);
  return cookies;
}

async function scrapeBuildConfig(cookies) {
  const { text: html, setCookie } = await fetchText(`${PLAY_ORIGIN}/play`, {
    headers: requestHeaders(cookies),
    redirect: "follow",
  });
  cookies = mergeSetCookie(cookies, setCookie);

  const scriptPaths = [...String(html || "").matchAll(/src="(\/assets\/[^"]+\.js)"/g)].map((match) => match[1]);
  for (const scriptPath of scriptPaths.slice(0, 12)) {
    const { text: source } = await fetchText(`${PLAY_ORIGIN}${scriptPath}`, {
      headers: requestHeaders(cookies),
      redirect: "follow",
    });
    const config = parseBuildConfigFromSource(source);
    if (config) {
      return config;
    }
  }
  return null;
}

async function requestJoin(gameId, name, cookies, { encrypted = false, buildConfig = null } = {}) {
  const payload = { id: String(gameId), name: String(name) };
  const headers = requestHeaders(cookies);

  let body = JSON.stringify(payload);
  if (encrypted) {
    if (!buildConfig?.buildId || !buildConfig?.secret) {
      throw new Error("Missing Blooket build config.");
    }
    body = await encryptBlooketPayload(payload, buildConfig.secret);
    headers["X-Blooket-Build"] = buildConfig.buildId;
  }

  const { response, text } = await fetchText(JOIN_URL, {
    method: "PUT",
    headers,
    body,
  });

  return parseJoinBody(text, response.status);
}

async function scrapeBuildConfigInPage(page) {
  return page.evaluate(async () => {
    const buildUuid = /\w{8}-\w{4}-\w{4}-\w{4}-\w{12}/;
    const secretRe = /\(new TextEncoder\)\.encode\("(.+?)"\)/;
    const paths = [...document.querySelectorAll("script[src]")]
      .map((node) => node.getAttribute("src"))
      .filter((src) => src && src.includes("/assets/"))
      .slice(0, 12);

    for (const path of paths) {
      try {
        const response = await fetch(path, { credentials: "include" });
        const source = await response.text();
        if (buildUuid.test(source) && secretRe.test(source)) {
          return {
            buildId: source.match(buildUuid)[0],
            secret: source.match(secretRe)[1],
          };
        }
      } catch {
        // Try the next asset bundle.
      }
    }
    return null;
  });
}

async function joinPlayersInBrowser(env, gameId, names) {
  const browser = await puppeteer.launch(env.MYBROWSER);
  try {
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.goto(`${PLAY_ORIGIN}/play?id=${encodeURIComponent(gameId)}`, {
      waitUntil: "networkidle2",
      timeout: 45000,
    });
    await new Promise((resolve) => setTimeout(resolve, 2500));

    const buildConfig = await scrapeBuildConfigInPage(page);
    const results = [];

    for (const name of names) {
      const joinData = await page.evaluate(
        async (joinUrl, gameIdValue, playerName, config) => {
          async function encryptPayload(payload, secret) {
            const blocks = new TextEncoder().encode(JSON.stringify(payload));
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
            const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt"]);
            const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, blocks);
            const ivText = Array.from(iv, (byte) => String.fromCharCode(byte)).join("");
            const cipherText = Array.from(new Uint8Array(ciphertext), (byte) => String.fromCharCode(byte)).join("");
            return btoa(ivText + cipherText);
          }

          const payload = { id: String(gameIdValue), name: String(playerName) };
          let response = await fetch(joinUrl, {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          let text = await response.text();
          let data = {};
          try {
            data = text ? JSON.parse(text) : {};
          } catch {
            data = { success: false, msg: `Invalid response (HTTP ${response.status}).` };
          }

          if (!data.success && config?.buildId && config?.secret) {
            const body = await encryptPayload(payload, config.secret);
            response = await fetch(joinUrl, {
              method: "PUT",
              credentials: "include",
              headers: {
                "Content-Type": "application/json",
                "X-Blooket-Build": config.buildId,
              },
              body,
            });
            text = await response.text();
            try {
              data = text ? JSON.parse(text) : {};
            } catch {
              data = { success: false, msg: `Invalid response (HTTP ${response.status}).` };
            }
          }

          if (!data.success && !data.msg) {
            data.msg = response.status === 403 ? "Blocked by Blooket (HTTP 403)." : "Could not join that game.";
          }
          data.httpStatus = response.status;
          return data;
        },
        JOIN_URL,
        gameId,
        name,
        buildConfig,
      );

      results.push({ name, ...joinData });
      await new Promise((resolve) => setTimeout(resolve, 120));
    }

    return results;
  } finally {
    await browser.close();
  }
}

async function joinBlooketPlayers(gameId, names, env) {
  const uniqueNames = [...new Set(names.map((name) => String(name || "").trim()).filter(Boolean))];
  if (!uniqueNames.length) {
    return [];
  }

  let cookies = await warmSession(gameId);
  let buildConfig = null;
  const results = [];

  for (const name of uniqueNames) {
    let joinData = await requestJoin(gameId, name, cookies);

    if (!joinData.success) {
      buildConfig ||= await scrapeBuildConfig(cookies);
      if (buildConfig) {
        joinData = await requestJoin(gameId, name, cookies, { encrypted: true, buildConfig });
      }
    }

    results.push({ name, ...joinData });
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  const blocked = results.length > 0 && results.every((entry) => isBlockedJoin(entry));
  if (blocked && env?.MYBROWSER) {
    try {
      return await joinPlayersInBrowser(env, gameId, uniqueNames);
    } catch (error) {
      console.error("browser join failed:", error);
      return uniqueNames.map((name) => ({
        name,
        success: false,
        msg: error?.message || "Browser join failed.",
        httpStatus: 500,
      }));
    }
  }

  return results;
}

async function loadBuildConfig(env) {
  let cookies = await warmSession("");
  const config = await scrapeBuildConfig(cookies);
  if (config) {
    return config;
  }

  if (!env?.MYBROWSER) {
    return null;
  }

  const browser = await puppeteer.launch(env.MYBROWSER);
  try {
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.goto(`${PLAY_ORIGIN}/play`, {
      waitUntil: "networkidle2",
      timeout: 45000,
    });
    await new Promise((resolve) => setTimeout(resolve, 2500));
    return scrapeBuildConfigInPage(page);
  } finally {
    await browser.close();
  }
}

function normalizeNames(body) {
  if (Array.isArray(body.names)) {
    return body.names.map((name) => String(name || "").trim()).filter(Boolean);
  }
  const single = String(body.name || "").trim();
  return single ? [single] : [];
}

function failureResults(names, message) {
  return names.map((name) => ({
    name,
    success: false,
    msg: message,
  }));
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    if (request.method === "GET") {
      try {
        const buildConfig = await loadBuildConfig(env);
        if (!buildConfig) {
          return Response.json(
            { error: "Could not load Blooket build config." },
            { status: 502, headers: corsHeaders() },
          );
        }
        return Response.json(buildConfig, { headers: corsHeaders() });
      } catch (error) {
        return Response.json(
          { error: error?.message || "Could not load Blooket build config." },
          { status: 500, headers: corsHeaders() },
        );
      }
    }

    if (request.method !== "PUT") {
      return Response.json({ success: false, msg: "Method not allowed." }, { status: 405, headers: corsHeaders() });
    }

    const body = await request.json().catch(() => ({}));
    const id = String(body.id || "").trim();
    const names = normalizeNames(body);

    if (!id || !names.length) {
      return Response.json(
        { success: false, msg: "Game ID and at least one name are required.", joins: [] },
        { status: 400, headers: corsHeaders() },
      );
    }

    try {
      const joins = await joinBlooketPlayers(id, names, env);
      const successCount = joins.filter((entry) => entry.success).length;

      return Response.json(
        {
          success: successCount > 0,
          joins,
          successCount,
          totalCount: joins.length,
          msg:
            successCount === joins.length
              ? undefined
              : successCount === 0
                ? joins[0]?.msg || "Could not join that game."
                : `Joined ${successCount}/${joins.length} players.`,
        },
        { headers: corsHeaders() },
      );
    } catch (error) {
      const message = error?.message || "Join failed.";
      return Response.json(
        {
          success: false,
          msg: message,
          joins: failureResults(names, message),
        },
        { status: 500, headers: corsHeaders() },
      );
    }
  },
};
