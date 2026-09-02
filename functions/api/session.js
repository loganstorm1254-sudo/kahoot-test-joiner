const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders() });
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const pin = String(url.searchParams.get("pin") || "").replace(/\D/g, "");

  if (!pin || !/^\d{6,}$/.test(pin)) {
    return Response.json({ error: "Invalid PIN" }, { status: 400, headers: corsHeaders() });
  }

  try {
    const kahootUrl = `https://kahoot.it/reserve/session/${pin}/?${Date.now()}`;
    const response = await fetch(kahootUrl, {
      headers: {
        Accept: "application/json, text/plain, */*",
        Referer: "https://kahoot.it/",
        Origin: "https://kahoot.it",
        "User-Agent": USER_AGENT,
      },
    });

    const bodyText = await response.text();

    if (response.status === 404) {
      return Response.json(
        { error: "No Kahoot game found with that PIN. Is the host running?" },
        { status: 404, headers: corsHeaders() },
      );
    }

    let body;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return Response.json(
        {
          error: "Unexpected response from Kahoot",
          status: response.status,
          preview: bodyText.slice(0, 120),
        },
        { status: 502, headers: corsHeaders() },
      );
    }

    if (!response.ok) {
      return Response.json(
        { error: `Kahoot returned status ${response.status}` },
        { status: response.status, headers: corsHeaders() },
      );
    }

    const sessionToken = response.headers.get("x-kahoot-session-token");
    if (!sessionToken || !body.challenge) {
      return Response.json(
        { error: "Kahoot did not return session data" },
        { status: 502, headers: corsHeaders() },
      );
    }

    return Response.json({ challenge: body.challenge, sessionToken }, { headers: corsHeaders() });
  } catch (error) {
    return Response.json({ error: error.message || "Server error" }, { status: 500, headers: corsHeaders() });
  }
}
