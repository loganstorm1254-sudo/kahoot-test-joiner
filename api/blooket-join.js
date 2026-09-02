import { joinBlooketPlayers } from "../lib/blooket-join-backend.js";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store, no-cache, must-revalidate",
  };
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

export async function OPTIONS() {
  return new Response(null, { headers: corsHeaders() });
}

export async function PUT(request) {
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
    console.error("blooket-join error:", error);
    return Response.json(
      {
        success: false,
        msg: message,
        joins: failureResults(names, message),
      },
      { status: 500, headers: corsHeaders() },
    );
  }
}
