/**
 * Stormy™ site shield — right-click / DevTools shortcuts → instant trap.
 * Primary copy also lives inline in index.html <head> for earliest bind.
 */
(function stormyShield() {
  var TRAP = "/steal.html";
  var VIDEO = "/assets/you-thought.mp4";
  if (String(location.pathname || "").indexOf("steal") !== -1) {
    return;
  }

  var armed = true;
  var tripCount = 0;
  var gapHits = 0;
  var readyAt = Date.now() + 2500;

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

  function badKey(e) {
    var k = String(e.key || e.code || "").toLowerCase();
    var meta = !!(e.ctrlKey || e.metaKey);
    if (k === "f12" || k === "f12" || e.keyCode === 123) {
      return true;
    }
    if (meta && e.shiftKey && "ijcke".indexOf(k.replace("key", "")) !== -1) {
      return true;
    }
    if (meta && (k === "u" || k === "keyu")) {
      return true;
    }
    if (meta && e.altKey && "ijc".indexOf(k.replace("key", "")) !== -1) {
      return true;
    }
    // Mac Chrome: Cmd+Option+I often reports as "ı" / keyI with alt
    if (meta && e.altKey && (e.code === "KeyI" || e.code === "KeyJ" || e.code === "KeyC")) {
      return true;
    }
    if (meta && e.shiftKey && (e.code === "KeyI" || e.code === "KeyJ" || e.code === "KeyC" || e.code === "KeyE" || e.code === "KeyK")) {
      return true;
    }
    return false;
  }

  function onMenu(e) {
    try {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    } catch (err) {
      /* ignore */
    }
    go();
    return false;
  }

  function onKey(e) {
    if (!badKey(e)) {
      return;
    }
    try {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    } catch (err) {
      /* ignore */
    }
    go();
  }

  function bind(target) {
    if (!target || !target.addEventListener) {
      return;
    }
    target.addEventListener("contextmenu", onMenu, true);
    target.addEventListener("keydown", onKey, true);
    target.addEventListener("keyup", onKey, true);
  }

  bind(window);
  bind(document);
  if (document.documentElement) {
    bind(document.documentElement);
  }
  document.addEventListener(
    "DOMContentLoaded",
    function () {
      bind(document.body);
      try {
        document.oncontextmenu = onMenu;
        window.oncontextmenu = onMenu;
      } catch (e) {
        /* ignore */
      }
    },
    true,
  );

  try {
    document.oncontextmenu = onMenu;
    window.oncontextmenu = onMenu;
  } catch (e) {
    /* ignore */
  }

  // Soft DevTools detect — only after settle, only with sustained large gap (menu open).
  setInterval(function () {
    if (!armed || Date.now() < readyAt) {
      return;
    }
    var wGap = Math.abs((window.outerWidth || 0) - (window.innerWidth || 0));
    var hGap = Math.abs((window.outerHeight || 0) - (window.innerHeight || 0));
    // Ignore tiny chrome / scrollbars; require a real docked tools panel.
    if (wGap > 180 || hGap > 180) {
      gapHits += 1;
    } else {
      gapHits = 0;
    }
    if (gapHits >= 4) {
      go();
    }
  }, 250);
})();
