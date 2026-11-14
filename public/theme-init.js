// Apply a saved light/dark choice before first paint (kept external: the CSP forbids inline scripts).
(function () {
  try {
    var t = localStorage.getItem("recipe-nutrition:theme");
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  } catch (e) {
    /* storage unavailable: follow the system theme */
  }
})();
