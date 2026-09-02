const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store, no-cache, must-revalidate",
  };
}

export async function OPTIONS() {
  return new Response(null, { headers: corsHeaders() });
}

export async function PUT(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const id = String(body.id || "").trim();
    const name = String(body.name || "").trim();

    if (!id || !name) {
      return Response.json(
        { success: false, msg: "Game ID and name are required." },
        { status: 400, headers: corsHeaders() },
      );
    }

    const response = await fetch("https://fb.blooket.com/c/firebase/join", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
      body: JSON.stringify({ id, name }),
    });

    const data = await response.json().catch(() => ({}));
    return Response.json(data, {
      status: response.ok ? 200 : response.status,
      headers: corsHeaders(),
    });
  } catch (error) {
    return Response.json(
      { success: false, msg: error.message || "Join proxy failed." },
      { status: 500, headers: corsHeaders() },
    );
  }
}
