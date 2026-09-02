/**
 * Stormy™ site shell — block right-click on the inspect decoy page only.
 */
(function stormyShield() {
  var menuOpts = { capture: true, passive: false };

  function hideMenu(e) {
    try {
      e.preventDefault();
      e.stopImmediatePropagation();
    } catch (err) {
      /* ignore */
    }
    return false;
  }

  window.addEventListener("contextmenu", hideMenu, menuOpts);
  document.addEventListener("contextmenu", hideMenu, menuOpts);
  document.oncontextmenu = hideMenu;
  window.oncontextmenu = hideMenu;
})();
