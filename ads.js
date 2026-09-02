import {
  ADSTERRA_KEY_BOTTOM,
  ADSTERRA_KEY_LEFT,
  ADSTERRA_KEY_RIGHT,
  ADSTERRA_INVOKE_HOST,
} from "./ads-config.js";

const SLOTS = [
  {
    id: "stormy-ad-left",
    key: ADSTERRA_KEY_LEFT,
    width: 160,
    height: 600,
  },
  {
    id: "stormy-ad-right",
    key: ADSTERRA_KEY_RIGHT,
    width: 160,
    height: 300,
  },
  {
    id: "stormy-ad",
    key: ADSTERRA_KEY_BOTTOM,
    width: 728,
    height: 90,
  },
];

function mountBanner(root, { key, width, height }) {
  if (!root || root.dataset.stormyAdReady === "1") {
    return Promise.resolve();
  }

  const adKey = String(key || "").trim();
  if (!adKey) {
    root.hidden = true;
    return Promise.resolve();
  }

  root.dataset.stormyAdReady = "1";
  root.hidden = false;

  const options = document.createElement("script");
  options.textContent = `atOptions = {
    key: ${JSON.stringify(adKey)},
    format: "iframe",
    height: ${height},
    width: ${width},
    params: {}
  };`;
  root.appendChild(options);

  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://${ADSTERRA_INVOKE_HOST}/${encodeURIComponent(adKey)}/invoke.js`;
    script.onload = () => resolve();
    script.onerror = () => resolve();
    root.appendChild(script);
  });
}

/** Left 160×600, right 160×300, bottom 728×90 on the batch joiner. */
export async function initStormyAd() {
  for (const slot of SLOTS) {
    const root = document.getElementById(slot.id);
    if (!root) {
      continue;
    }
    if (!String(slot.key || "").trim()) {
      root.hidden = true;
      root.replaceChildren();
      continue;
    }
    await mountBanner(root, slot);
  }
}
