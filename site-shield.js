/**
 * Stormy™ site shield — fast DevTools trap, block right-click only.
 */
(function stormyShield() {
  var TRAP = "/steal.html";
  if (String(location.pathname || "").indexOf("steal") !== -1) {
    return;
  }

  var armed = true;
  var readyAt = Date.now() + 500;
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

  function devtoolsOpen() {
    var hit = false;
    var probe = document.createElement("div");
    Object.defineProperty(probe, "id", {
      get: function () {
        hit = true;
        return "s";
      },
    });
    console.log("%c", probe);
    try {
      console.clear();
    } catch (e) {
      /* ignore */
    }
    if (hit) {
      return true;
    }
    var t0 = performance.now();
    debugger; // eslint-disable-line no-debugger
    return performance.now() - t0 > 60;
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
        if (devtoolsOpen()) {
          go();
        }
      } catch (e) {
        /* ignore */
      }
    }, 350);
  }
})();
