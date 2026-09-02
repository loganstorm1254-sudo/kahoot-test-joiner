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
    height: 600,
  },
  {
    id: "stormy-ad",
    key: ADSTERRA_KEY_BOTTOM,
    width: 728,
    height: 90,
  },
];

let adsStarted = false;

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function slotHasCreative(slot) {
  if (!slot) {
    return false;
  }
  return Boolean(
    slot.querySelector("iframe") ||
      slot.querySelector("img") ||
      slot.querySelector("a") ||
      slot.offsetHeight > 4,
  );
}

function mountBanner(root, { key, width, height }, { force = false } = {}) {
  if (!root) {
    return Promise.resolve(false);
  }
  if (root.dataset.stormyAdReady === "1" && !force) {
    return Promise.resolve(true);
  }

  const adKey = String(key || "").trim();
  if (!adKey) {
    root.hidden = true;
    return Promise.resolve(false);
  }

  root.dataset.stormyAdReady = "1";
  root.hidden = false;
  root.replaceChildren();

  const label = document.createElement("p");
  label.className = "stormy-ad-label";
  label.textContent = "Ad";
  root.appendChild(label);

  const slot = document.createElement("div");
  slot.className = "stormy-ad-slot";
  slot.dataset.adWidth = String(width);
  slot.dataset.adHeight = String(height);
  slot.style.width = `${width}px`;
  slot.style.height = `${height}px`;
  root.appendChild(slot);

  const options = document.createElement("script");
  options.textContent = `atOptions = {
    key: ${JSON.stringify(adKey)},
    format: "iframe",
    height: ${height},
    width: ${width},
    params: {}
  };`;
  slot.appendChild(options);

  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.async = false;
    script.src = `https://${ADSTERRA_INVOKE_HOST}/${encodeURIComponent(adKey)}/invoke.js`;
    script.onload = () => {
      delay(250).then(() => resolve(slotHasCreative(slot)));
    };
    script.onerror = () => resolve(false);
    slot.appendChild(script);
  });
}

async function remountIfEmpty(root, slotConfig) {
  const slot = root?.querySelector(".stormy-ad-slot");
  if (slotHasCreative(slot)) {
    return;
  }
  root.dataset.stormyAdReady = "0";
  await mountBanner(root, slotConfig, { force: true });
}

/** Left 160×600, right 160×600, bottom 728×90 — loads when joiner is visible. */
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
    await delay(300);
  }

  const leftRoot = document.getElementById("stormy-ad-left");
  const rightRoot = document.getElementById("stormy-ad-right");
  await delay(1500);
  await remountIfEmpty(leftRoot, SLOTS[0]);
  await delay(400);
  await remountIfEmpty(rightRoot, SLOTS[1]);

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
