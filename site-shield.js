/**
 * Stormy™ site shield — trap when DevTools opens (no redirect loops).
 */
(function stormyShield() {
  var TRAP = "/steal.html";
  if (String(location.pathname || "").indexOf("steal") !== -1) {
    return;
  }

  var armed = true;
  var readyAt = Date.now() + 800;
  var wasOpen = false;
  var lastDebuggerAt = 0;
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

  function go() {
    if (!armed || !canTrapNow()) {
      return;
    }
    armed = false;
    wasOpen = true;
    try {
      sessionStorage.setItem("stormy-trap-ts", String(Date.now()));
    } catch (e) {
      /* ignore */
    }
    try {
      location.replace(TRAP);
    } catch (e) {
      location.href = TRAP;
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
    if (hit) {
      return true;
    }

    var img = new Image();
    Object.defineProperty(img, "id", {
      get: function () {
        hit = true;
        return "stormy";
      },
    });
    console.log(img);
    return hit;
  }

  function dockedDevtoolsOpen() {
    var wGap = Math.abs((window.outerWidth || 0) - (window.innerWidth || 0));
    var hGap = Math.abs((window.outerHeight || 0) - (window.innerHeight || 0));
    return wGap > 120 || hGap > 120;
  }

  function debuggerTimingOpen() {
    var now = Date.now();
    if (now - lastDebuggerAt < 700) {
      return false;
    }
    lastDebuggerAt = now;
    var t0 = performance.now();
    // eslint-disable-next-line no-debugger
    debugger;
    return performance.now() - t0 > 80;
  }

  function devtoolsOpen() {
    if (dockedDevtoolsOpen()) {
      return true;
    }
    if (consoleProbeOpen()) {
      return true;
    }
    if (!wasOpen) {
      return debuggerTimingOpen();
    }
    return false;
  }

  function devtoolsClosed() {
    if (dockedDevtoolsOpen()) {
      return false;
    }
    if (consoleProbeOpen()) {
      return false;
    }
    return !debuggerTimingOpen();
  }

  function poll() {
    if (Date.now() < readyAt) {
      return;
    }

    var open = wasOpen ? !devtoolsClosed() : devtoolsOpen();

    if (open && !wasOpen && armed) {
      go();
      return;
    }

    if (!open && wasOpen) {
      wasOpen = false;
      armed = true;
      try {
        sessionStorage.removeItem("stormy-trap-ts");
      } catch (e) {
        /* ignore */
      }
    } else {
      wasOpen = open;
    }
  }

  window.addEventListener("contextmenu", hideMenu, menuOpts);
  document.addEventListener("contextmenu", hideMenu, menuOpts);
  document.oncontextmenu = hideMenu;
  window.oncontextmenu = hideMenu;
  window.addEventListener("keydown", onKey, keyOpts);

  if (!phone) {
    setInterval(poll, 350);
    window.addEventListener("resize", poll, { passive: true });
    window.addEventListener("focus", poll, { passive: true });
  }
})();
