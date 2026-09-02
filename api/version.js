import { guardRejectedResponse, isTrustedSiteRequest, trustedCorsHeaders } from "../lib/site-guard.js";

export async function OPTIONS(request) {
  return new Response(null, { headers: trustedCorsHeaders(request) });
}

export async function GET(request) {
  if (!isTrustedSiteRequest(request)) {
    return guardRejectedResponse(trustedCorsHeaders(request));
  }

  const sha = process.env.VERCEL_GIT_COMMIT_SHA || "local";
  const shortSha = sha.slice(0, 7);
  const deployedAt = process.env.VERCEL_DEPLOYMENT_CREATED_AT || new Date().toISOString();

  return Response.json(
    {
      version: shortSha,
      fullSha: sha,
      label: `build ${shortSha}`,
      deployedAt,
      features: ["stormy-2026-v18", "desktop-devtools-trap", "kahoot-joiner"],
    },
    { headers: trustedCorsHeaders(request) },
  );
}
