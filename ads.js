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

let adsStarted = false;

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

  const slot = document.createElement("div");
  slot.className = "stormy-ad-slot";
  slot.style.width = `${width}px`;
  slot.style.minHeight = `${height}px`;
  root.appendChild(slot);

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

/** Left 160×600, right 160×300, bottom 728×90 — loads when joiner is visible. */
export async function initStormyAd() {
  const joiner = document.getElementById("view-joiner");
  if (!joiner || joiner.hidden) {
    return;
  }

  for (const slot of SLOTS) {
    const root = document.getElementById(slot.id);
    if (!root) {
      continue;
    }
    if (!String(slot.key || "").trim()) {
      root.hidden = true;
      continue;
    }
    await mountBanner(root, slot);
  }
  adsStarted = true;
}

/** Call when opening the batch joiner so ads render in a visible panel. */
export function initStormyAdWhenJoinerOpens() {
  if (adsStarted) {
    return;
  }
  requestAnimationFrame(() => {
    void initStormyAd();
  });
}
