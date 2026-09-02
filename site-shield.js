/**
 * Stormy™ site shield
 * Trap ONLY on intentional inspect actions (right-click / DevTools shortcuts).
 * No background detectors — those were falsely trapping everyone on load.
 */
(function stormyShield() {
  const VIDEO_SRC = "/assets/you-thought.mp4";
  let trapActive = false;
  let keepAliveTimer = null;

  function showStealTrap(fromUserGesture) {
    if (trapActive) {
      const existing = document.getElementById("stormy-trap-video");
      if (existing && existing.paused) {
        existing.play().catch(() => {});
      }
      return;
    }
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
          overflow: hidden;
          font-family: Impact, Haettenschweiler, "Arial Black", sans-serif;
          user-select: none;
          -webkit-user-select: none;
        }
        #stormy-steal-trap h1 {
          margin: 28px 16px 18px;
          text-align: center;
          font-size: clamp(28px, 7vw, 72px);
          font-weight: 900;
          letter-spacing: 0.04em;
          line-height: 1.05;
          color: #000000;
          text-transform: uppercase;
        }
        #stormy-steal-trap .video-wrap {
          position: relative;
          width: min(100vw, 960px);
          max-height: 70vh;
          background: #000;
        }
        #stormy-steal-trap video {
          display: block;
          width: 100%;
          max-height: 70vh;
          background: #000;
          pointer-events: none;
        }
        #stormy-steal-trap .video-block {
          position: absolute;
          inset: 0;
          z-index: 2;
        }
      </style>
      <h1>YOU THOUGHT YOU COULD STEAL?</h1>
      <div class="video-wrap">
        <video
          id="stormy-trap-video"
          src="${VIDEO_SRC}"
          autoplay
          playsinline
          webkit-playsinline
          loop
          preload="auto"
        ></video>
        <div class="video-block" aria-hidden="true"></div>
      </div>
    `;

    (document.body || document.documentElement).appendChild(overlay);

    const video = overlay.querySelector("#stormy-trap-video");
    if (!video) {
      return;
    }

    video.controls = false;
    video.loop = true;
    video.volume = 1;

    // User gesture (right-click / shortcut) can start loud; otherwise muted then one unmute try.
    if (fromUserGesture) {
      video.muted = false;
    } else {
      video.muted = true;
    }

    const start = () => {
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {
          video.muted = true;
          video.play().catch(() => {});
        });
      }
    };

    start();

    // If something pauses it, resume ONCE per pause — don't spam play()/mute toggles.
    video.addEventListener("pause", () => {
      if (!trapActive || video.ended) {
        return;
      }
      requestAnimationFrame(() => {
        if (video.paused) {
          video.play().catch(() => {});
        }
      });
    });

    video.addEventListener("ended", () => {
      video.currentTime = 0;
      video.play().catch(() => {});
    });

    // Soft keep-alive: only if actually paused (not every tick restarting playback).
    keepAliveTimer = window.setInterval(() => {
      if (trapActive && video.paused) {
        video.play().catch(() => {});
      }
    }, 1000);

    overlay.addEventListener(
      "pointerdown",
      () => {
        video.muted = false;
        video.volume = 1;
        if (video.paused) {
          video.play().catch(() => {});
        }
      },
      true,
    );
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

  document.addEventListener(
    "contextmenu",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      showStealTrap(true);
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
      showStealTrap(true);
      return false;
    },
    true,
  );
})();
