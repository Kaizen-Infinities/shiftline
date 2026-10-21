// Restore saved theme before React loads to avoid flash. Kept as a file (not inline) so the
// Content-Security-Policy can use script-src 'self' without a hash.
(function () {
  try {
    var t = localStorage.getItem("shiftline-theme-v2");
    var theme = t === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", theme);
    if (theme === "dark") document.documentElement.classList.add("dark");
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "light");
  }
})();
