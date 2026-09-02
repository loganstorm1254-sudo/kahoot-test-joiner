/**
 * Stormy™ site shield — instant redirect to /steal.html on inspect attempts.
 * Works on decoy + batch joiner (window capture listeners).
 */
(function stormyShield() {
  const TRAP_URL = "/steal.html";
  let redirected = false;

  // Prefetch so redirect feels instant.
  try {
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.href = TRAP_URL;
    document.head.appendChild(link);
    const videoHint = document.createElement("link");
    videoHint.rel = "preload";
    videoHint.as = "video";
    videoHint.href = "/assets/you-thought.mp4";
    document.head.appendChild(videoHint);
  } catch {
    // ignore
  }

  function goTrap() {
    if (redirected) {
      return;
    }
    redirected = true;
    try {
      window.location.replace(TRAP_URL);
    } catch {
      window.location.href = TRAP_URL;
    }
  }

  function isInspectShortcut(event) {
    const key = String(event.key || "").toLowerCase();
    const code = String(event.code || "");
    const meta = event.ctrlKey || event.metaKey;
    const shift = event.shiftKey;
    const alt = event.altKey;

    if (key === "f12" || code === "F12") {
      return true;
    }
    if (meta && shift && ["i", "j", "c", "k", "e"].includes(key)) {
      return true;
    }
    if (meta && key === "u") {
      return true;
    }
    if (meta && alt && ["i", "j", "c"].includes(key)) {
      return true;
    }
    return false;
  }

  // Capture on window so joiner UI can't swallow events.
  window.addEventListener(
    "contextmenu",
    (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      goTrap();
      return false;
    },
    true,
  );

  window.addEventListener(
    "keydown",
    (event) => {
      if (!isInspectShortcut(event)) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      goTrap();
      return false;
    },
    true,
  );

  window.addEventListener(
    "dragstart",
    (event) => {
      event.preventDefault();
      return false;
    },
    true,
  );
})();
