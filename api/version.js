function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Cache-Control": "no-store, no-cache, must-revalidate",
  };
}

export async function OPTIONS() {
  return new Response(null, { headers: corsHeaders() });
}

export async function GET() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA || "local";
  const shortSha = sha.slice(0, 7);
  const deployedAt = process.env.VERCEL_DEPLOYMENT_CREATED_AT || new Date().toISOString();

  return Response.json(
    {
      version: shortSha,
      fullSha: sha,
      label: `build ${shortSha}`,
      deployedAt,
      features: ["kahoot-decoy-v20", "blooket-decoy", "blooket-joiner-relay", "activity-log", "vision-search"],
    },
    { headers: corsHeaders() },
  );
}
