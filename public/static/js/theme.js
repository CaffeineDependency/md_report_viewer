// Theme: dark by default, toggle in the header, choice remembered in
// localStorage. Loaded synchronously in <head> so data-theme is applied
// before first paint (no flash). CSP-safe: external script, no inline code.

(function () {
  "use strict";

  var STORAGE_KEY = "gk-theme";
  var root = document.documentElement;

  function stored() {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return null;
    }
  }

  function apply(theme) {
    var dark = theme !== "light";
    root.setAttribute("data-theme", dark ? "dark" : "light");

    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#0b1215" : "#f5f7f7");

    var btn = document.getElementById("theme-toggle");
    if (btn) {
      btn.textContent = dark ? "روشن" : "تاریک";
      btn.setAttribute(
        "aria-label",
        dark ? "تغییر به پوسته روشن" : "تغییر به پوسته تاریک"
      );
    }
  }

  apply(stored());

  document.addEventListener("DOMContentLoaded", function () {
    apply(stored());
    var btn = document.getElementById("theme-toggle");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var next =
        root.getAttribute("data-theme") === "light" ? "dark" : "light";
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch (e) {
        /* storage unavailable; theme still switches for this page */
      }
      apply(next);
    });
  });
})();
