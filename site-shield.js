/**
 * Stormy™ site shield — deters casual copying.
 * Nothing client-side is fully unstealable; this raises the bar.
 */
(function stormyShield() {
  const block = (event) => {
    event.preventDefault();
    return false;
  };

  document.addEventListener("contextmenu", block);
  document.addEventListener("dragstart", block);

  document.addEventListener("keydown", (event) => {
    const key = String(event.key || "").toLowerCase();
    const meta = event.ctrlKey || event.metaKey;
    if (meta && ["s", "u", "p"].includes(key)) {
      event.preventDefault();
      return false;
    }
    if (meta && event.shiftKey && ["i", "j", "c"].includes(key)) {
      event.preventDefault();
      return false;
    }
    if (key === "f12") {
      event.preventDefault();
      return false;
    }
    return undefined;
  });

  // Break trivial iframe embeds / clones wrapping the site.
  try {
    if (window.top !== window.self) {
      window.top.location = window.self.location.href;
    }
  } catch {
    document.documentElement.innerHTML = "";
  }
})();
