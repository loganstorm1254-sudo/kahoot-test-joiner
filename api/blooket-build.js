import { parseBuildConfigFromSource } from "../lib/blooket-crypto.js";

const PLAY_ORIGIN = "https://play.blooket.com";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store, no-cache, must-revalidate",
  };
}

function requestHeaders() {
  return {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    Referer: `${PLAY_ORIGIN}/play`,
    "User-Agent": USER_AGENT,
  };
}

export async function OPTIONS() {
  return new Response(null, { headers: corsHeaders() });
}

export async function GET() {
  try {
    const playResponse = await fetch(`${PLAY_ORIGIN}/play`, {
      headers: requestHeaders(),
      redirect: "follow",
    });
    const html = await playResponse.text();
    const scriptPaths = [...html.matchAll(/src="(\/assets\/[^"]+\.js)"/g)].map((match) => match[1]);

    for (const scriptPath of scriptPaths.slice(0, 12)) {
      const scriptResponse = await fetch(`${PLAY_ORIGIN}${scriptPath}`, {
        headers: requestHeaders(),
        redirect: "follow",
      });
      const source = await scriptResponse.text();
      const config = parseBuildConfigFromSource(source);
      if (config) {
        return Response.json(config, { headers: corsHeaders() });
      }
    }

    return Response.json({ error: "Could not load Blooket build config." }, { status: 502, headers: corsHeaders() });
  } catch (error) {
    return Response.json(
      { error: error?.message || "Could not load Blooket build config." },
      { status: 500, headers: corsHeaders() },
    );
  }
}
