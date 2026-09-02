/**
 * Stormy™ site shield — clear DOM when DevTools opens so Elements is empty.
 */
(function stormyShield() {
  var readyAt = Date.now() + 3000;
  var gapHits = 0;
  var consoleHits = 0;
  var wiped = false;
  var inspectOpen = false;
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

  function wipeEmpty() {
    if (wiped) {
      return;
    }
    wiped = true;
    inspectOpen = true;
    try {
      document.title = "";
      document.head.innerHTML = "";
      document.body.innerHTML = "";
      document.documentElement.removeAttribute("class");
      document.documentElement.removeAttribute("style");
      document.body.removeAttribute("class");
      document.body.removeAttribute("style");
      document.body.style.margin = "0";
      document.body.style.background = "#ffffff";
    } catch (e) {
      /* ignore */
    }
  }

  function onInspectClosed() {
    if (!inspectOpen) {
      return;
    }
    inspectOpen = false;
    wiped = false;
    gapHits = 0;
    consoleHits = 0;
    try {
      location.reload();
    } catch (e) {
      /* ignore */
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
    wipeEmpty();
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
    return hit;
  }

  function dockedDevtoolsOpen() {
    var wGap = Math.abs((window.outerWidth || 0) - (window.innerWidth || 0));
    var hGap = Math.abs((window.outerHeight || 0) - (window.innerHeight || 0));
    return wGap > 160 || hGap > 160;
  }

  function poll() {
    if (phone || Date.now() < readyAt) {
      return;
    }

    var gap = dockedDevtoolsOpen();
    var probe = consoleProbeOpen();

    if (gap) {
      gapHits += 1;
    } else {
      gapHits = 0;
    }

    if (probe) {
      consoleHits += 1;
    } else {
      consoleHits = 0;
    }

    if (gapHits >= 4 || consoleHits >= 4 || (gapHits >= 3 && consoleHits >= 1)) {
      wipeEmpty();
      return;
    }

    if (wiped && !gap && !probe) {
      onInspectClosed();
    }
  }

  window.addEventListener("contextmenu", hideMenu, menuOpts);
  document.addEventListener("contextmenu", hideMenu, menuOpts);
  document.oncontextmenu = hideMenu;
  window.oncontextmenu = hideMenu;
  window.addEventListener("keydown", onKey, keyOpts);

  if (!phone) {
    setInterval(poll, 250);
    window.addEventListener("resize", poll, { passive: true });
  }
})();
