import { guardRejectedResponse, isTrustedSiteRequest, trustedCorsHeaders } from "../lib/site-guard.js";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const ALLOWED_HOSTS = /^(media\.kahoot\.|kahoot\.|images\.kahoot\.|cf\.kahoot\.)/i;

function corsHeaders(request, extra = {}) {
  return {
    ...trustedCorsHeaders(request),
    "Cache-Control": "private, max-age=600",
    ...extra,
  };
}

function isAllowedImageUrl(raw) {
  try {
    const url = new URL(String(raw || ""));
    if (url.protocol !== "https:") {
      return false;
    }
    return ALLOWED_HOSTS.test(url.hostname) || url.hostname.endsWith(".kahoot.it");
  } catch {
    return false;
  }
}

export async function OPTIONS(request) {
  return new Response(null, { headers: corsHeaders(request) });
}

export async function GET(request) {
  if (!isTrustedSiteRequest(request)) {
    return guardRejectedResponse(corsHeaders(request));
  }

  const url = new URL(request.url);
  const target = url.searchParams.get("url") || "";

  if (!isAllowedImageUrl(target)) {
    return new Response("Forbidden", { status: 403, headers: corsHeaders(request) });
  }

  try {
    const response = await fetch(target, {
      headers: {
        Accept: "image/*,*/*",
        Referer: "https://kahoot.it/",
        "User-Agent": USER_AGENT,
      },
      redirect: "follow",
    });

    if (!response.ok) {
      return new Response("Upstream error", { status: 502, headers: corsHeaders(request) });
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    return new Response(response.body, {
      headers: corsHeaders(request, { "Content-Type": contentType }),
    });
  } catch {
    return new Response("Proxy error", { status: 500, headers: corsHeaders(request) });
  }
}
