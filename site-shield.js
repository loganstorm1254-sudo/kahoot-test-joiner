/* Backup shield — primary trap is inline in index.html <head> for instant redirect. */
(function () {
  var TRAP = "/steal.html";
  if (location.pathname.indexOf("steal") !== -1) return;
  function go() {
    location.replace(TRAP);
  }
  function badKey(e) {
    var k = (e.key || "").toLowerCase();
    var meta = e.ctrlKey || e.metaKey;
    if (k === "f12") return true;
    if (meta && e.shiftKey && "ijcke".indexOf(k) !== -1) return true;
    if (meta && k === "u") return true;
    if (meta && e.altKey && "ijc".indexOf(k) !== -1) return true;
    return false;
  }
  window.addEventListener(
    "contextmenu",
    function (e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      go();
    },
    true,
  );
  window.addEventListener(
    "keydown",
    function (e) {
      if (!badKey(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      go();
    },
    true,
  );
})();
