import { joinBlooketPlayers } from "../lib/blooket-join-backend.js";

const DEFAULT_BLOOKET_JOIN_WORKER_URL = "";

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

function joinResponse(joins) {
  const successCount = joins.filter((entry) => entry.success).length;
  return {
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
  };
}

async function joinViaWorker(workerUrl, id, names) {
  const response = await fetch(workerUrl.replace(/\/$/, ""), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, names }),
  });
  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`Join worker returned invalid JSON (HTTP ${response.status}).`);
  }
  if (!Array.isArray(data.joins)) {
    throw new Error(data.msg || `Join worker failed (HTTP ${response.status}).`);
  }
  return data;
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

  const workerUrl = String(process.env.BLOOKET_JOIN_WORKER_URL || DEFAULT_BLOOKET_JOIN_WORKER_URL).trim();

  try {
    if (workerUrl) {
      const data = await joinViaWorker(workerUrl, id, names);
      return Response.json(data, { headers: corsHeaders() });
    }

    const joins = await joinBlooketPlayers(id, names);
    return Response.json(joinResponse(joins), { headers: corsHeaders() });
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
