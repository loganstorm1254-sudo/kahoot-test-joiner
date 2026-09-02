/**
 * Stormy™ site shield — trap inspect / DevTools no matter how they open it.
 * Note: pages cannot disable Chrome's ⋮ menu, but we detect DevTools once open.
 */
(function stormyShield() {
  const VIDEO_SRC = "/assets/you-thought.mp4";
  let trapActive = false;
  let lastTrigger = 0;

  function unlockAudio(video) {
    if (!video) {
      return;
    }
    try {
      video.muted = false;
      video.volume = 1;
      video.defaultMuted = false;
      const play = video.play();
      if (play && typeof play.catch === "function") {
        play.catch(() => {
          video.muted = true;
          video
            .play()
            .then(() => {
              video.muted = false;
              video.volume = 1;
            })
            .catch(() => {});
        });
      }
    } catch {
      // ignore
    }
  }

  function showStealTrap() {
    const now = Date.now();
    if (now - lastTrigger < 400 && trapActive) {
      unlockAudio(document.getElementById("stormy-trap-video"));
      return;
    }
    lastTrigger = now;

    if (trapActive) {
      unlockAudio(document.getElementById("stormy-trap-video"));
      return;
    }
    trapActive = true;

    // Wipe page content so stolen DOM / sources aren't useful.
    try {
      document.querySelectorAll("script:not([data-stormy-shield])").forEach((node) => node.remove());
      while (document.body.firstChild) {
        document.body.removeChild(document.body.firstChild);
      }
    } catch {
      // ignore
    }

    const overlay = document.createElement("div");
    overlay.id = "stormy-steal-trap";
    overlay.setAttribute("role", "alertdialog");
    overlay.innerHTML = `
      <style>
        html, body {
          margin: 0 !important;
          background: #ffffff !important;
          overflow: hidden !important;
        }
        #stormy-steal-trap {
          position: fixed;
          inset: 0;
          z-index: 2147483647;
          background: #ffffff;
          color: #000000;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          overflow: auto;
          font-family: Impact, Haettenschweiler, "Arial Black", sans-serif;
        }
        #stormy-steal-trap h1 {
          margin: 28px 16px 18px;
          padding: 0;
          text-align: center;
          font-size: clamp(28px, 7vw, 72px);
          font-weight: 900;
          letter-spacing: 0.04em;
          line-height: 1.05;
          color: #000000;
          background: #ffffff;
          text-transform: uppercase;
        }
        #stormy-steal-trap video {
          width: min(100vw, 960px);
          max-height: 70vh;
          background: #000;
          outline: none;
        }
      </style>
      <h1>YOU THOUGHT YOU COULD STEAL?</h1>
      <video
        id="stormy-trap-video"
        src="${VIDEO_SRC}"
        autoplay
        playsinline
        loop
        controls
        preload="auto"
      ></video>
    `;

    (document.body || document.documentElement).appendChild(overlay);

    const video = overlay.querySelector("video");
    if (video) {
      video.volume = 1;
      video.muted = false;
      unlockAudio(video);
      video.addEventListener("loadeddata", () => unlockAudio(video), { once: true });
      const bump = () => unlockAudio(video);
      window.addEventListener("pointerdown", bump, { once: true, capture: true });
      window.addEventListener("keydown", bump, { once: true, capture: true });
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
    // Some keyboards / layouts; also catch F11 fullscreen used while snooping.
    if (key === "f11" || code === "F11") {
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
    if (meta && ["s", "p"].includes(key)) {
      return true;
    }
    return false;
  }

  function isDevtoolsOpen() {
    const widthGap = window.outerWidth - window.innerWidth;
    const heightGap = window.outerHeight - window.innerHeight;
    // Docked DevTools (side or bottom) — thresholds cover most laptop chrome.
    if (widthGap > 120 || heightGap > 120) {
      return true;
    }

    // Console element probe (works when console is open)
    const probe = document.createElement("div");
    let opened = false;
    Object.defineProperty(probe, "id", {
      get() {
        opened = true;
        return "stormy";
      },
    });
    // eslint-disable-next-line no-console
    console.log("%c", probe);
    try {
      console.clear();
    } catch {
      // ignore
    }
    return opened;
  }

  let debuggerChecks = 0;
  function debuggerDetect() {
    debuggerChecks += 1;
    if (debuggerChecks % 6 !== 0) {
      return false;
    }
    const start = performance.now();
    // eslint-disable-next-line no-debugger
    debugger;
    return performance.now() - start > 100;
  }

  document.addEventListener(
    "contextmenu",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      showStealTrap();
      return false;
    },
    true,
  );

  document.addEventListener(
    "dragstart",
    (event) => {
      event.preventDefault();
      return false;
    },
    true,
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (!isInspectShortcut(event)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      showStealTrap();
      return false;
    },
    true,
  );

  // Continuous detection — covers Chrome ⋮ → More tools → Developer tools
  setInterval(() => {
    try {
      if (isDevtoolsOpen() || debuggerDetect()) {
        showStealTrap();
      }
    } catch {
      showStealTrap();
    }
  }, 400);

  // Visibility / focus changes often accompany opening tools
  window.addEventListener("resize", () => {
    if (isDevtoolsOpen()) {
      showStealTrap();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && isDevtoolsOpen()) {
      showStealTrap();
    }
  });

  try {
    if (window.top !== window.self) {
      window.top.location = window.self.location.href;
    }
  } catch {
    showStealTrap();
  }
})();
