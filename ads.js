import { ADSTERRA_KEY, ADSTERRA_INVOKE_HOST } from "./ads-config.js";

function ready() {
  return Boolean(String(ADSTERRA_KEY || "").trim());
}

function mountBanner(root) {
  if (!root || root.dataset.stormyAdReady === "1") {
    return;
  }

  const key = ADSTERRA_KEY.trim();
  root.dataset.stormyAdReady = "1";
  root.hidden = false;

  const options = document.createElement("script");
  options.textContent = `atOptions = {
    key: ${JSON.stringify(key)},
    format: "iframe",
    height: 90,
    width: 728,
    params: {}
  };`;
  root.appendChild(options);

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://${ADSTERRA_INVOKE_HOST}/${encodeURIComponent(key)}/invoke.js`;
  root.appendChild(script);
}

/** One Adsterra banner (728×90) at the bottom of the joiner. */
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
