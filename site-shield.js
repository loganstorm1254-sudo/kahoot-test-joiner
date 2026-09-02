/**
 * Stormy™ site shield — inspect / DevTools traps to anti-theft screen.
 */
(function stormyShield() {
  const VIDEO_SRC = "/assets/you-thought.mp4";
  let trapActive = false;

  function unlockAudio(video) {
    try {
      video.muted = false;
      video.volume = 1;
      video.defaultMuted = false;
      const play = video.play();
      if (play && typeof play.catch === "function") {
        play.catch(() => {
          video.muted = true;
          video.play().then(() => {
            video.muted = false;
            video.volume = 1;
          }).catch(() => {});
        });
      }
    } catch {
      // ignore
    }
  }

  function showStealTrap() {
    if (trapActive) {
      unlockAudio(document.getElementById("stormy-trap-video"));
      return;
    }
    trapActive = true;

    const overlay = document.createElement("div");
    overlay.id = "stormy-steal-trap";
    overlay.setAttribute("role", "alertdialog");
    overlay.innerHTML = `
      <style>
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

    document.documentElement.appendChild(overlay);
    document.body.style.overflow = "hidden";

    const video = overlay.querySelector("video");
    if (video) {
      video.volume = 1;
      video.muted = false;
      unlockAudio(video);
      video.addEventListener("loadeddata", () => unlockAudio(video), { once: true });
      // Keep trying — browsers often block unmuted autoplay until a gesture.
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
    // Chrome/Edge/Firefox DevTools
    if (meta && shift && ["i", "j", "c", "k"].includes(key)) {
      return true;
    }
    // View source
    if (meta && key === "u") {
      return true;
    }
    // Mac alt+cmd+i / alt+cmd+j sometimes
    if (meta && alt && ["i", "j", "c"].includes(key)) {
      return true;
    }
    // Save / print used while snooping
    if (meta && ["s", "p"].includes(key)) {
      return true;
    }
    return false;
  }

  document.addEventListener(
    "contextmenu",
    (event) => {
      event.preventDefault();
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

  // Detect DevTools open via viewport / debugger timing.
  let lastTrigger = 0;
  function maybeTrapFromDevtools() {
    const now = Date.now();
    if (now - lastTrigger < 1500) {
      return;
    }
    const widthGap = Math.abs(window.outerWidth - window.innerWidth) > 160;
    const heightGap = Math.abs(window.outerHeight - window.innerHeight) > 160;
    if (widthGap || heightGap) {
      lastTrigger = now;
      showStealTrap();
    }
  }

  setInterval(maybeTrapFromDevtools, 800);

  try {
    if (window.top !== window.self) {
      window.top.location = window.self.location.href;
    }
  } catch {
    showStealTrap();
  }
})();
