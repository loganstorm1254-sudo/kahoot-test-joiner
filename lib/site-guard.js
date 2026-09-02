import { STORMY_SITE_TOKEN } from "../stormy-token.js";

function parseUrlSafe(value) {
  try {
    return new URL(String(value || ""));
  } catch {
    return null;
  }
}

function hostLooksLikeOurs(hostname) {
  const host = String(hostname || "")
    .toLowerCase()
    .replace(/:\d+$/, "");
  if (!host) {
    return false;
  }
  if (host === "localhost" || host === "127.0.0.1") {
    return true;
  }
  if (host.includes("kahoot-test-joiner") && host.endsWith(".vercel.app")) {
    return true;
  }
  return host === "kahoot-test-joiner.vercel.app";
}

export function getSiteToken() {
  return STORMY_SITE_TOKEN;
}

export function isTrustedSiteRequest(request) {
  const requestUrl = parseUrlSafe(request.url);
  const originHeader = request.headers.get("origin") || "";
  const refererHeader = request.headers.get("referer") || "";
  const token = request.headers.get("x-stormy-token") || "";

  if (token !== STORMY_SITE_TOKEN) {
    return false;
  }

  const origin = parseUrlSafe(originHeader);
  // Same-origin browser calls always pass when token matches.
  if (requestUrl && origin && origin.host === requestUrl.host) {
    return true;
  }

  if (origin && hostLooksLikeOurs(origin.hostname)) {
    return true;
  }

  if (!originHeader && requestUrl && hostLooksLikeOurs(requestUrl.hostname)) {
    const referer = parseUrlSafe(refererHeader);
    if (!refererHeader || (referer && (referer.host === requestUrl.host || hostLooksLikeOurs(referer.hostname)))) {
      return true;
    }
  }

  const referer = parseUrlSafe(refererHeader);
  if (referer && hostLooksLikeOurs(referer.hostname)) {
    return true;
  }

  return false;
}

export function guardRejectedResponse(corsHeaders = {}) {
  return Response.json(
    { error: "Forbidden" },
    {
      status: 403,
      headers: {
        ...corsHeaders,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

export function trustedCorsHeaders(request, extra = {}) {
  const origin = request.headers.get("origin") || "";
  const parsed = parseUrlSafe(origin);
  const requestUrl = parseUrlSafe(request.url);
  let allowOrigin = "https://kahoot-test-joiner.vercel.app";
  if (parsed && requestUrl && parsed.host === requestUrl.host) {
    allowOrigin = origin;
  } else if (parsed && hostLooksLikeOurs(parsed.hostname)) {
    allowOrigin = origin;
  }

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Stormy-Token",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    ...extra,
  };
}
