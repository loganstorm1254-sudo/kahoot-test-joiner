import { STORMY_SITE_TOKEN } from "../stormy-token.js";

const ALLOWED_HOST_SUFFIXES = [
  "kahoot-test-joiner.vercel.app",
  "localhost",
  "127.0.0.1",
];

function hostAllowed(hostname) {
  const host = String(hostname || "")
    .toLowerCase()
    .replace(/:\d+$/, "");
  if (!host) {
    return false;
  }
  return ALLOWED_HOST_SUFFIXES.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`) || host.endsWith(allowed),
  );
}

function parseUrlSafe(value) {
  try {
    return new URL(String(value || ""));
  } catch {
    return null;
  }
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
  if (origin && hostAllowed(origin.hostname)) {
    return true;
  }

  if (!originHeader && requestUrl && hostAllowed(requestUrl.hostname)) {
    const referer = parseUrlSafe(refererHeader);
    if (!refererHeader || (referer && hostAllowed(referer.hostname))) {
      return true;
    }
  }

  const referer = parseUrlSafe(refererHeader);
  if (referer && hostAllowed(referer.hostname)) {
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
  const allowOrigin =
    parsed && hostAllowed(parsed.hostname) ? origin : "https://kahoot-test-joiner.vercel.app";

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
