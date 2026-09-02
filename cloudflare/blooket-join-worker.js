const PLAY_ORIGIN = "https://play.blooket.com";
const JOIN_URL = "https://fb.blooket.com/c/firebase/join";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const BUILD_UUID_RE = /\w{8}-\w{4}-\w{4}-\w{4}-\w{12}/;
const SECRET_RE = /\(new TextEncoder\)\.encode\("(.+?)"\)/;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "PUT, OPTIONS",
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

async function joinBlooketPlayers(gameId, names) {
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
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
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
      const joins = await joinBlooketPlayers(id, names);
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
