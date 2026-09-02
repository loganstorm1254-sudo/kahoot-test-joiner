/**
 * Stormy™ site shield — DevTools detection + autoplay trap video.
 */
(function stormyShield() {
  const VIDEO_SRC = "/assets/you-thought.mp4";
  let trapActive = false;
  let audioUnlocked = false;
  let primedVideo = null;
  let lastTrapAt = 0;

  function ensurePrimedVideo() {
    if (primedVideo) {
      return primedVideo;
    }
    primedVideo = document.createElement("video");
    primedVideo.src = VIDEO_SRC;
    primedVideo.preload = "auto";
    primedVideo.playsInline = true;
    primedVideo.loop = true;
    primedVideo.muted = true;
    primedVideo.setAttribute("playsinline", "");
    primedVideo.setAttribute("webkit-playsinline", "");
    primedVideo.style.cssText = "position:fixed;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none";
    document.documentElement.appendChild(primedVideo);
    primedVideo.load();
    return primedVideo;
  }

  function unlockAudioFromGesture() {
    audioUnlocked = true;
    const video = ensurePrimedVideo();
    video.muted = true;
    video.volume = 1;
    const playPromise = video.play();
    if (playPromise && typeof playPromise.then === "function") {
      playPromise
        .then(() => {
          video.pause();
          video.currentTime = 0;
          video.muted = false;
        })
        .catch(() => {});
    }
  }

  function forcePlayLoud(video) {
    if (!video) {
      return;
    }
    video.loop = true;
    video.controls = true;
    video.playsInline = true;
    video.volume = 1;
    video.muted = false;
    video.defaultMuted = false;
    video.removeAttribute("muted");

    const attempt = () => {
      video.volume = 1;
      video.muted = false;
      const result = video.play();
      if (result && typeof result.catch === "function") {
        result.catch(() => {
          // Muted autoplay always allowed — then unmute.
          video.muted = true;
          video.play().then(() => {
            setTimeout(() => {
              video.muted = false;
              video.volume = 1;
            }, 50);
          }).catch(() => {});
        });
      }
    };

    attempt();
    video.addEventListener("canplay", attempt, { once: true });
    video.addEventListener("loadeddata", attempt, { once: true });
  }

  function showStealTrap() {
    const now = Date.now();
    if (trapActive) {
      forcePlayLoud(document.getElementById("stormy-trap-video"));
      return;
    }
    if (now - lastTrapAt < 300) {
      return;
    }
    lastTrapAt = now;
    trapActive = true;

    try {
      document.querySelectorAll("script:not([data-stormy-shield])").forEach((node) => node.remove());
      while (document.body && document.body.firstChild) {
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
        muted
        playsinline
        webkit-playsinline
        loop
        controls
        preload="auto"
      ></video>
    `;

    (document.body || document.documentElement).appendChild(overlay);

    const video = overlay.querySelector("video");
    if (primedVideo && primedVideo.src) {
      try {
        video.src = primedVideo.currentSrc || primedVideo.src || VIDEO_SRC;
      } catch {
        // keep default src
      }
    }

    // Start muted (autoplay policy), then bump to full volume.
    video.muted = true;
    forcePlayLoud(video);
    setTimeout(() => forcePlayLoud(video), 100);
    setTimeout(() => forcePlayLoud(video), 400);
    setTimeout(() => {
      video.muted = false;
      video.volume = 1;
      forcePlayLoud(video);
    }, audioUnlocked ? 80 : 200);

    const bump = () => forcePlayLoud(video);
    window.addEventListener("pointerdown", bump, true);
    window.addEventListener("keydown", bump, true);
    window.addEventListener("touchstart", bump, true);
  }

  function isInspectShortcut(event) {
    const key = String(event.key || "").toLowerCase();
    const code = String(event.code || "");
    const meta = event.ctrlKey || event.metaKey;
    const shift = event.shiftKey;
    const alt = event.altKey;

    if (key === "f12" || code === "F12" || key === "f11" || code === "F11") {
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

  function dockedDevtoolsOpen() {
    const widthGap = window.outerWidth - window.innerWidth;
    const heightGap = window.outerHeight - window.innerHeight;
    return widthGap > 140 || heightGap > 140;
  }

  // Console getter probe — fires when DevTools console is rendering logs (menu open too).
  function consoleDevtoolsOpen() {
    let opened = false;
    const probe = new Image();
    Object.defineProperty(probe, "id", {
      get() {
        opened = true;
        return "stormy-probe";
      },
    });
    try {
      // eslint-disable-next-line no-console
      console.log(probe);
      // eslint-disable-next-line no-console
      console.log("%c", probe);
      console.clear();
    } catch {
      // ignore
    }
    return opened;
  }

  function toStringDevtoolsOpen() {
    // Some Chromium builds reformat function toString when inspected.
    const check = /./;
    check.toString = function trap() {
      showStealTrap();
      return "";
    };
    try {
      // eslint-disable-next-line no-console
      console.log("%c", check);
      console.clear();
    } catch {
      // ignore
    }
    return false;
  }

  // Unlock audio on first real interaction with the site (needed for loud autoplay).
  ["pointerdown", "keydown", "touchstart", "click"].forEach((type) => {
    window.addEventListener(
      type,
      () => {
        unlockAudioFromGesture();
        ensurePrimedVideo();
      },
      { capture: true, once: false },
    );
  });

  document.addEventListener(
    "contextmenu",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      unlockAudioFromGesture();
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
      unlockAudioFromGesture();
      showStealTrap();
      return false;
    },
    true,
  );

  setInterval(() => {
    try {
      toStringDevtoolsOpen();
      if (dockedDevtoolsOpen() || consoleDevtoolsOpen()) {
        showStealTrap();
      }
    } catch {
      showStealTrap();
    }
  }, 300);

  window.addEventListener("resize", () => {
    if (dockedDevtoolsOpen()) {
      showStealTrap();
    }
  });

  // Undocked DevTools: periodic debugger timing (only every ~2s).
  let tick = 0;
  setInterval(() => {
    tick += 1;
    if (tick % 7 !== 0) {
      return;
    }
    const start = performance.now();
    // eslint-disable-next-line no-debugger
    debugger;
    if (performance.now() - start > 80) {
      showStealTrap();
    }
  }, 300);

  try {
    if (window.top !== window.self) {
      window.top.location = window.self.location.href;
    }
  } catch {
    showStealTrap();
  }

  ensurePrimedVideo();
})();
