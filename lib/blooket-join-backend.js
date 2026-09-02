import { encryptBlooketPayload, parseBuildConfigFromSource } from "./blooket-crypto.js";

const PLAY_ORIGIN = "https://play.blooket.com";
const JOIN_URL = "https://fb.blooket.com/c/firebase/join";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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

export async function joinBlooketPlayers(gameId, names) {
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

  return results;
}
