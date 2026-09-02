/**
 * Stormy™ site shield
 * - Hide native context menu (View Page Source won't appear); no trap on right-click/tap
 * - Trap on DevTools / view-source keyboard shortcuts
 * - Trap when DevTools opens on DESKTOP only (size gap) — never on phones
 */
(function stormyShield() {
  var TRAP = "/steal.html";
  var VIDEO = "/assets/you-thought.mp4";
  if (String(location.pathname || "").indexOf("steal") !== -1) {
    return;
  }

  var armed = true;
  var gapHits = 0;
  var readyAt = Date.now() + 2500;
  var keyOpts = { capture: true, passive: false };
  var menuOpts = { capture: true, passive: false };

  function isPhoneLike() {
    try {
      if (/Mobi|Android|iPhone|iPod|iPad|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || "")) {
        return true;
      }
      if (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 900) {
        return true;
      }
      if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) {
        if (window.matchMedia("(max-width: 900px)").matches) {
          return true;
        }
      }
    } catch (e) {
      /* ignore */
    }
    return false;
  }

  var phone = isPhoneLike();

  function paintTrap() {
    if (document.getElementById("stormy-steal-overlay")) {
      return;
    }
    var overlay = document.createElement("div");
    overlay.id = "stormy-steal-overlay";
    overlay.setAttribute(
      "style",
      "position:fixed;inset:0;z-index:2147483647;background:#fff;color:#000;" +
        "display:flex;flex-direction:column;align-items:center;justify-content:flex-start;" +
        "font-family:Impact,Haettenschweiler,'Arial Black',sans-serif;overflow:hidden;",
    );
    overlay.innerHTML =
      "<h1 style=\"margin:28px 16px 18px;text-align:center;font-size:clamp(28px,7vw,72px);" +
      "font-weight:900;letter-spacing:.04em;line-height:1.05;text-transform:uppercase;" +
      "color:#000;\">YOU THOUGHT YOU COULD STEAL?</h1>" +
      "<div style=\"position:relative;width:min(100vw,960px);max-height:70vh;background:#000;\">" +
      "<video id=\"stormy-trap-video\" src=\"" +
      VIDEO +
      "\" autoplay playsinline webkit-playsinline loop preload=\"auto\" " +
      "style=\"display:block;width:100%;max-height:70vh;background:#000;pointer-events:none\"></video>" +
      "<div style=\"position:absolute;inset:0;z-index:2\"></div></div>";
    (document.documentElement || document.body).appendChild(overlay);

    var video = document.getElementById("stormy-trap-video");
    if (!video) {
      return;
    }
    video.controls = false;
    video.loop = true;
    video.volume = 1;
    function kick() {
      video.muted = false;
      video.volume = 1;
      var p = video.play();
      if (p && typeof p.catch === "function") {
        p.catch(function () {
          video.muted = true;
          video
            .play()
            .then(function () {
              video.muted = false;
              video.volume = 1;
            })
            .catch(function () {});
        });
      }
    }
    kick();
    video.addEventListener(
      "pause",
      function () {
        if (!video.ended) {
          kick();
        }
      },
      true,
    );
  }

  function go() {
    if (!armed) {
      return;
    }
    armed = false;
    try {
      paintTrap();
    } catch (e) {
      /* ignore */
    }
    try {
      location.replace(TRAP);
    } catch (e2) {
      try {
        location.href = TRAP;
      } catch (e3) {
        /* ignore */
      }
    }
  }

  function hideNativeMenu(e) {
    try {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    } catch (err) {
      /* ignore */
    }
    return false;
  }

  function isDevtoolsOrSourceKey(e) {
    var k = String(e.key || "").toLowerCase();
    var code = String(e.code || "");
    var meta = !!(e.ctrlKey || e.metaKey);
    var isU = k === "u" || code === "KeyU" || e.keyCode === 85;

    if (k === "f12" || e.keyCode === 123 || code === "F12") {
      return true;
    }
    if (meta && isU && !e.shiftKey) {
      return true;
    }
    if (
      meta &&
      e.shiftKey &&
      (code === "KeyI" ||
        code === "KeyJ" ||
        code === "KeyC" ||
        code === "KeyE" ||
        code === "KeyK")
    ) {
      return true;
    }
    if (
      meta &&
      e.altKey &&
      (code === "KeyI" || code === "KeyJ" || code === "KeyC")
    ) {
      return true;
    }
    return false;
  }

  function onKey(e) {
    if (!isDevtoolsOrSourceKey(e)) {
      return;
    }
    go();
    try {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    } catch (err) {
      /* ignore */
    }
    return false;
  }

  window.addEventListener("contextmenu", hideNativeMenu, menuOpts);
  document.addEventListener("contextmenu", hideNativeMenu, menuOpts);
  if (document.documentElement) {
    document.documentElement.addEventListener("contextmenu", hideNativeMenu, menuOpts);
  }
  try {
    document.oncontextmenu = hideNativeMenu;
    window.oncontextmenu = hideNativeMenu;
  } catch (e) {
    /* ignore */
  }

  window.addEventListener("keydown", onKey, keyOpts);
  document.addEventListener("keydown", onKey, keyOpts);
  if (document.documentElement) {
    document.documentElement.addEventListener("keydown", onKey, keyOpts);
  }

  // Desktop only: when Inspect / ⋮ opens docked DevTools, redirect.
  // Phones skipped — URL bar resize was false-triggering on every tap.
  if (!phone) {
    setInterval(function () {
      if (!armed || Date.now() < readyAt) {
        return;
      }
      var wGap = Math.abs((window.outerWidth || 0) - (window.innerWidth || 0));
      var hGap = Math.abs((window.outerHeight || 0) - (window.innerHeight || 0));
      // Docked DevTools is usually a large panel; ignore thin browser chrome.
      if (wGap > 160 || hGap > 160) {
        gapHits += 1;
      } else {
        gapHits = 0;
      }
      if (gapHits >= 3) {
        go();
      }
    }, 200);
  }
})();
