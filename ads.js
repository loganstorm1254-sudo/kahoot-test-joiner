import { MEDIANET_CID, MEDIANET_TAG_ID } from "./ads-config.js";

const MEDIANET_VERSION = "3121199";
const AD_SIZE = "728x90";

function ready() {
  return Boolean(String(MEDIANET_CID || "").trim() && String(MEDIANET_TAG_ID || "").trim());
}

function loadMediaNet() {
  return new Promise((resolve, reject) => {
    if (document.querySelector('script[src*="dmedianet.js"]')) {
      resolve();
      return;
    }

    window._mNHandle = window._mNHandle || {};
    window._mNHandle.queue = window._mNHandle.queue || [];
    window.medianet_versionId = MEDIANET_VERSION;

    const script = document.createElement("script");
    script.async = true;
    script.src = `https://contextual.media.net/dmedianet.js?cid=${encodeURIComponent(MEDIANET_CID.trim())}`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("medianet script failed"));
    document.head.appendChild(script);
  });
}

function mountBanner(root) {
  if (!root || root.dataset.stormyAdReady === "1") {
    return;
  }
  root.dataset.stormyAdReady = "1";
  root.hidden = false;

  const tagId = MEDIANET_TAG_ID.trim();
  const slot = document.createElement("div");
  slot.id = `stormy-mn-${tagId}`;
  root.appendChild(slot);

  const run = () => {
    try {
      window._mNHandle.queue.push(function () {
        window._mNDetails.loadTag(tagId, AD_SIZE, slot.id);
      });
    } catch {
      // ignore
    }
  };

  if (window._mNDetails) {
    run();
  } else {
    window._mNHandle.queue.push(run);
  }
}

/** One in-flow Media.net banner on the joiner footer. */
export async function initStormyAd() {
  const root = document.getElementById("stormy-ad");
  if (!root) {
    return;
  }
  if (!ready()) {
    root.hidden = true;
    root.replaceChildren();
    return;
  }

  try {
    await loadMediaNet();
    mountBanner(root);
  } catch {
    root.hidden = true;
  }
}
