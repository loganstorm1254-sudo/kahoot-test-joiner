/**
 * Stormy™ site shield — trap DevTools without false positives on load.
 */
(function stormyShield() {
  var TRAP = "/steal.html";
  if (String(location.pathname || "").indexOf("steal") !== -1) {
    return;
  }

  var armed = true;
  var readyAt = Date.now() + 2500;
  var gapHits = 0;
  var consoleHits = 0;
  var keyOpts = { capture: true, passive: false };
  var menuOpts = { capture: true, passive: false };
  var phone = isPhoneLike();

  function isPhoneLike() {
    try {
      if (/Mobi|Android|iPhone|iPod|iPad|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || "")) {
        return true;
      }
      if (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 900) {
        return true;
      }
      if (
        window.matchMedia &&
        window.matchMedia("(pointer: coarse)").matches &&
        window.matchMedia("(max-width: 900px)").matches
      ) {
        return true;
      }
    } catch (e) {
      /* ignore */
    }
    return false;
  }

  function canTrapNow() {
    try {
      var last = parseInt(sessionStorage.getItem("stormy-trap-ts") || "0", 10);
      return !last || Date.now() - last > 2000;
    } catch (e) {
      return true;
    }
  }

  function go(fromGesture) {
    if (!armed || !canTrapNow()) {
      return;
    }
    armed = false;
    try {
      sessionStorage.setItem("stormy-trap-ts", String(Date.now()));
    } catch (e) {
      /* ignore */
    }
    var target = fromGesture ? TRAP + "?g=1" : TRAP;
    try {
      location.replace(target);
    } catch (e) {
      location.href = target;
    }
  }

  function hideMenu(e) {
    try {
      e.preventDefault();
      e.stopImmediatePropagation();
    } catch (err) {
      /* ignore */
    }
    return false;
  }

  function isDevKey(e) {
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
      (code === "KeyI" || code === "KeyJ" || code === "KeyC" || code === "KeyE" || code === "KeyK")
    ) {
      return true;
    }
    if (meta && e.altKey && (code === "KeyI" || code === "KeyJ" || code === "KeyC")) {
      return true;
    }
    return false;
  }

  function onKey(e) {
    if (!isDevKey(e)) {
      return;
    }
    go(true);
    try {
      e.preventDefault();
      e.stopImmediatePropagation();
    } catch (err) {
      /* ignore */
    }
    return false;
  }

  function consoleProbeOpen() {
    var hit = false;
    var probe = document.createElement("div");
    Object.defineProperty(probe, "id", {
      get: function () {
        hit = true;
        return "stormy";
      },
    });

    console.log("%c", probe);
    if (hit) {
      return true;
    }

    console.dir(probe);
    return hit;
  }

  function dockedDevtoolsOpen() {
    var wGap = Math.abs((window.outerWidth || 0) - (window.innerWidth || 0));
    var hGap = Math.abs((window.outerHeight || 0) - (window.innerHeight || 0));
    return wGap > 160 || hGap > 160;
  }

  function poll() {
    if (!armed || Date.now() < readyAt) {
      return;
    }

    if (dockedDevtoolsOpen()) {
      gapHits += 1;
    } else {
      gapHits = 0;
    }

    if (consoleProbeOpen()) {
      consoleHits += 1;
    } else {
      consoleHits = 0;
    }

    if (gapHits >= 3) {
      go(false);
      return;
    }
    if (consoleHits >= 3) {
      go(false);
      return;
    }
    if (gapHits >= 2 && consoleHits >= 1) {
      go(false);
    }
  }

  window.addEventListener("contextmenu", hideMenu, menuOpts);
  document.addEventListener("contextmenu", hideMenu, menuOpts);
  document.oncontextmenu = hideMenu;
  window.oncontextmenu = hideMenu;
  window.addEventListener("keydown", onKey, keyOpts);

  if (!phone) {
    setInterval(poll, 200);
    window.addEventListener("resize", poll, { passive: true });
  }
})();
