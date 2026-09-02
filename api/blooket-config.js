import { BLOOKET_JOIN_WORKER_URL } from "../blooket-shared.js";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store, no-cache, must-revalidate",
  };
}

export async function OPTIONS() {
  return new Response(null, { headers: corsHeaders() });
}

export async function GET() {
  const joinWorkerUrl =
    String(process.env.BLOOKET_JOIN_WORKER_URL || "").trim() || BLOOKET_JOIN_WORKER_URL;

  return Response.json(
    {
      joinWorkerUrl,
      joinReady: Boolean(joinWorkerUrl),
    },
    { headers: corsHeaders() },
  );
}
