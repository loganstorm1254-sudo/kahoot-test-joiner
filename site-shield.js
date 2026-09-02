/**
 * Stormy™ site shield — inspect shortcuts / right-click → trap video.
 * Avoids false positives on normal browsing (no size/debugger spam).
 */
(function stormyShield() {
  const VIDEO_SRC = "/assets/you-thought.mp4";
  let trapActive = false;
  let audioUnlocked = false;

  function unlockAudioFromGesture() {
    audioUnlocked = true;
  }

  function lockPlay(video) {
    if (!video) {
      return;
    }
    video.loop = true;
    video.controls = false;
    video.disablePictureInPicture = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.playsInline = true;
    video.volume = 1;

    const kick = () => {
      if (video.paused) {
        const wasMuted = video.muted;
        // Prefer loud; fall back to muted autoplay then unmute.
        video.muted = audioUnlocked ? false : true;
        video.volume = 1;
        const result = video.play();
        if (result && typeof result.catch === "function") {
          result.catch(() => {
            video.muted = true;
            video.play().then(() => {
              if (audioUnlocked) {
                video.muted = false;
                video.volume = 1;
              }
            }).catch(() => {});
          });
        } else if (audioUnlocked && wasMuted) {
          video.muted = false;
        }
      } else if (audioUnlocked && video.muted) {
        video.muted = false;
        video.volume = 1;
      }
    };

    kick();
  }

  function showStealTrap() {
    if (trapActive) {
      lockPlay(document.getElementById("stormy-trap-video"));
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
          overflow: hidden;
          font-family: Impact, Haettenschweiler, "Arial Black", sans-serif;
          user-select: none;
          -webkit-user-select: none;
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
          outline: none;
          pointer-events: none;
        }
        #stormy-steal-trap .video-block {
          position: absolute;
          inset: 0;
          z-index: 2;
          cursor: default;
        }
      </style>
      <h1>YOU THOUGHT YOU COULD STEAL?</h1>
      <div class="video-wrap">
        <video
          id="stormy-trap-video"
          src="${VIDEO_SRC}"
          autoplay
          muted
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

    // No native controls — block pause via overlay + events.
    video.removeAttribute("controls");
    video.controls = false;

    video.addEventListener("pause", () => {
      // Only force resume while trap is showing.
      if (trapActive) {
        lockPlay(video);
      }
    });
    video.addEventListener("ended", () => {
      video.currentTime = 0;
      lockPlay(video);
    });

    // Start (muted for policy), then unmute if user already clicked the site.
    video.muted = true;
    lockPlay(video);
    if (audioUnlocked) {
      setTimeout(() => {
        video.muted = false;
        video.volume = 1;
        lockPlay(video);
      }, 120);
    }

    // Keep locked on play.
    setInterval(() => {
      if (trapActive) {
        lockPlay(video);
      }
    }, 400);

    // Any click on trap unlocks loud playback.
    overlay.addEventListener(
      "pointerdown",
      () => {
        unlockAudioFromGesture();
        video.muted = false;
        video.volume = 1;
        lockPlay(video);
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
    if (meta && ["s", "p"].includes(key)) {
      return true;
    }
    return false;
  }

  ["pointerdown", "keydown", "touchstart", "click"].forEach((type) => {
    window.addEventListener(type, unlockAudioFromGesture, { capture: true });
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

  // Only treat a *large side panel* as DevTools — avoids Mac toolbar false positives.
  let gapHits = 0;
  setInterval(() => {
    const widthGap = window.outerWidth - window.innerWidth;
    if (widthGap > 280) {
      gapHits += 1;
      if (gapHits >= 3) {
        showStealTrap();
      }
    } else {
      gapHits = 0;
    }
  }, 500);

  try {
    if (window.top !== window.self) {
      window.top.location = window.self.location.href;
    }
  } catch {
    // ignore framing errors without trapping
  }
})();
