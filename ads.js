import { ADSTERRA_KEY } from "./ads-config.js";

function ready() {
  return Boolean(String(ADSTERRA_KEY || "").trim());
}

function mountBanner(root) {
  if (!root || root.dataset.stormyAdReady === "1") {
    return;
  }
  root.dataset.stormyAdReady = "1";
  root.hidden = false;

  const key = ADSTERRA_KEY.trim();
  window.atOptions = {
    key,
    format: "iframe",
    height: 90,
    width: 728,
    params: {},
  };

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.highperformanceformat.com/${encodeURIComponent(key)}/invoke.js`;
  root.appendChild(script);
}

/** One banner at the bottom of the joiner — no popunders from our side. */
export function initStormyAd() {
  const root = document.getElementById("stormy-ad");
  if (!root) {
    return;
  }
  if (!ready()) {
    root.hidden = true;
    root.replaceChildren();
    return;
  }
  mountBanner(root);
}
