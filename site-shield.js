/**
 * Stormy™ site shield
 * - Block right-click (no trap on right-click)
 * - Trap on DevTools shortcuts + DevTools open (console/debugger probes — not screen size)
 */
(function stormyShield() {
  var TRAP = "/steal.html";
  if (String(location.pathname || "").indexOf("steal") !== -1) {
    return;
  }

  var armed = true;
  var probeHits = 0;
  var readyAt = Date.now() + 3000;
  var keyOpts = { capture: true, passive: false };
  var menuOpts = { capture: true, passive: false };

  function isPhoneLike() {
    return /Mobi|Android|iPhone|iPod|iPad/i.test(navigator.userAgent || "");
  }

  function go() {
    if (!armed) {
      return;
    }
    armed = false;
    try {
      location.replace(TRAP);
    } catch (e) {
      location.href = TRAP;
    }
  }

  function hideMenu(e) {
    try {
      e.preventDefault();
      e.stopPropagation();
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
    go();
    try {
      e.preventDefault();
      e.stopImmediatePropagation();
    } catch (err) {
      /* ignore */
    }
    return false;
  }

  function devtoolsProbe() {
    var opened = false;
    var probe = document.createElement("div");
    Object.defineProperty(probe, "id", {
      get: function () {
        opened = true;
        return "stormy";
      },
    });
    console.log("%c", probe);
    try {
      console.clear();
    } catch (e) {
      /* ignore */
    }
    if (opened) {
      return true;
    }

    var start = performance.now();
    // DevTools pauses on debugger when open.
    debugger; // eslint-disable-line no-debugger
    return performance.now() - start > 90;
  }

  window.addEventListener("contextmenu", hideMenu, menuOpts);
  document.addEventListener("contextmenu", hideMenu, menuOpts);
  document.oncontextmenu = hideMenu;
  window.oncontextmenu = hideMenu;
  window.addEventListener("keydown", onKey, keyOpts);
  document.addEventListener("keydown", onKey, keyOpts);

  if (!isPhoneLike()) {
    setInterval(function () {
      if (!armed || Date.now() < readyAt) {
        return;
      }
      try {
        if (devtoolsProbe()) {
          probeHits += 1;
        } else {
          probeHits = 0;
        }
      } catch (e) {
        probeHits = 0;
      }
      if (probeHits >= 2) {
        go();
      }
    }, 900);
  }
})();
