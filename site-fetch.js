import { STORMY_SITE_TOKEN } from "./stormy-token.js";

export function stormyFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("X-Stormy-Token", STORMY_SITE_TOKEN);
  return fetch(url, { ...options, headers, credentials: "same-origin" });
}
