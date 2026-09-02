import { gotScraping } from "got-scraping";
import { CookieJar } from "tough-cookie";
import { encryptBlooketPayload, parseBuildConfigFromSource } from "./blooket-crypto.js";

const PLAY_ORIGIN = "https://play.blooket.com";
const JOIN_URL = "https://fb.blooket.com/c/firebase/join";

const HEADER_OPTIONS = {
  browsers: [{ name: "chrome", minVersion: 122 }],
  devices: ["desktop"],
  locales: ["en-US"],
  operatingSystems: ["macos"],
};

function parseJoinBody(body, statusCode) {
  if (!body) {
    return {
      success: false,
      msg: statusCode === 403 ? "Blocked by Blooket (HTTP 403)." : "Empty join response.",
      httpStatus: statusCode,
    };
  }

  try {
    const data = JSON.parse(body);
    if (!data.success && !data.msg) {
      data.msg = "Could not join that game.";
    }
    data.httpStatus = statusCode;
    return data;
  } catch {
    const preview = String(body).replace(/\s+/g, " ").slice(0, 160);
    const blocked = statusCode === 403 || /cloudflare|cf-browser-verification/i.test(preview);
    return {
      success: false,
      msg: blocked ? "Blocked by Blooket security (Cloudflare)." : `Unexpected response (HTTP ${statusCode}).`,
      httpStatus: statusCode,
      preview,
    };
  }
}

async function scrapeBuildConfig(cookieJar) {
  const page = await gotScraping({
    url: `${PLAY_ORIGIN}/play`,
    cookieJar,
    useHeaderGenerator: true,
    headerGeneratorOptions: HEADER_OPTIONS,
    throwHttpErrors: false,
  });

  const scriptPaths = [...String(page.body || "").matchAll(/src="(\/assets\/[^"]+\.js)"/g)].map(
    (match) => match[1],
  );

  for (const scriptPath of scriptPaths.slice(0, 12)) {
    const script = await gotScraping({
      url: `${PLAY_ORIGIN}${scriptPath}`,
      cookieJar,
      useHeaderGenerator: true,
      headerGeneratorOptions: HEADER_OPTIONS,
      throwHttpErrors: false,
    });
    const config = parseBuildConfigFromSource(script.body);
    if (config) {
      return config;
    }
  }

  return null;
}

async function warmSession(cookieJar, gameId) {
  await gotScraping({
    url: `${PLAY_ORIGIN}/play?id=${encodeURIComponent(gameId)}`,
    cookieJar,
    useHeaderGenerator: true,
    headerGeneratorOptions: HEADER_OPTIONS,
    throwHttpErrors: false,
  });
}

async function requestJoin(cookieJar, gameId, name, { encrypted = false, buildConfig = null } = {}) {
  const payload = { id: String(gameId), name: String(name) };
  const headers = {
    "content-type": "application/json",
    origin: PLAY_ORIGIN,
    referer: `${PLAY_ORIGIN}/play`,
  };

  let body = JSON.stringify(payload);
  if (encrypted) {
    if (!buildConfig?.buildId || !buildConfig?.secret) {
      throw new Error("Missing Blooket build config.");
    }
    body = await encryptBlooketPayload(payload, buildConfig.secret);
    headers["x-blooket-build"] = buildConfig.buildId;
  }

  const response = await gotScraping({
    url: JOIN_URL,
    method: "PUT",
    cookieJar,
    headers,
    body,
    useHeaderGenerator: true,
    headerGeneratorOptions: HEADER_OPTIONS,
    throwHttpErrors: false,
  });

  return parseJoinBody(response.body, response.statusCode);
}

export async function joinBlooketPlayers(gameId, names) {
  const uniqueNames = [...new Set(names.map((name) => String(name || "").trim()).filter(Boolean))];
  if (!uniqueNames.length) {
    return [];
  }

  const cookieJar = new CookieJar();
  await warmSession(cookieJar, gameId);

  let buildConfig = null;
  const results = [];

  for (const name of uniqueNames) {
    let joinData = await requestJoin(cookieJar, gameId, name);

    if (!joinData.success && (joinData.httpStatus === 403 || !joinData.msg || joinData.preview)) {
      buildConfig ||= await scrapeBuildConfig(cookieJar);
      if (buildConfig) {
        joinData = await requestJoin(cookieJar, gameId, name, { encrypted: true, buildConfig });
      }
    }

    results.push({ name, ...joinData });
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  return results;
}
