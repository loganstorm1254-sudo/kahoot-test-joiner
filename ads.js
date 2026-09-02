import { AD_CLIENT, AD_SLOT } from "./ads-config.js";

const ADS_SCRIPT = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";

function hasClient() {
  return Boolean(String(AD_CLIENT || "").trim());
}

function hasSlot() {
  return Boolean(String(AD_SLOT || "").trim());
}

function mountSlot(root) {
  if (!root || root.dataset.stormyAdReady === "1") {
    return;
  }
  root.dataset.stormyAdReady = "1";
  root.hidden = false;

  const ins = document.createElement("ins");
  ins.className = "adsbygoogle";
  ins.style.display = "block";
  ins.style.minHeight = "90px";
  ins.setAttribute("data-ad-client", AD_CLIENT.trim());
  ins.setAttribute("data-ad-slot", AD_SLOT.trim());
  ins.setAttribute("data-ad-format", "horizontal");
  ins.setAttribute("data-full-width-responsive", "true");
  root.appendChild(ins);

  try {
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  } catch {
    // ignore
  }
}

function loadScript() {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src*="adsbygoogle.js"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.async = true;
    script.src = `${ADS_SCRIPT}?client=${encodeURIComponent(AD_CLIENT.trim())}`;
    script.crossOrigin = "anonymous";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("ads script failed"));
    document.head.appendChild(script);
  });
}

/** Load one non-intrusive display ad into #stormy-ad (joiner footer). */
export async function initStormyAd() {
  const root = document.getElementById("stormy-ad");
  if (!root) {
    return;
  }
  if (!hasClient() || !hasSlot()) {
    root.hidden = true;
    root.replaceChildren();
    return;
  }

  try {
    await loadScript();
    mountSlot(root);
  } catch {
    root.hidden = true;
  }
}
