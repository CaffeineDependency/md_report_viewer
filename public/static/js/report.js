// Public report page interactions: code copy buttons and the image lightbox.
// No dependencies; no inline scripts (CSP-safe).

(function () {
  "use strict";

  // ------------------------------------------------------------------
  // Copy-code buttons (rendered by the shared markdown renderer)
  // ------------------------------------------------------------------

  // Mobile browsers often reject navigator.clipboard (permissions, in-app
  // webviews). Fall back to the classic hidden-textarea + execCommand path.
  function legacyCopy(text) {
    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length);
    var ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (e) {
      ok = false;
    }
    document.body.removeChild(area);
    return ok;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () {
        if (legacyCopy(text)) return;
        throw new Error("copy failed");
      });
    }
    if (legacyCopy(text)) return Promise.resolve();
    return Promise.reject(new Error("copy failed"));
  }

  document.querySelectorAll(".copy-code-btn[data-copy-code]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var figure = btn.closest(".code-block");
      var codeEl = figure && figure.querySelector("pre code");
      if (!codeEl) return;

      var original = btn.textContent;
      function feedback(label) {
        btn.textContent = label;
        btn.disabled = true;
        setTimeout(function () {
          btn.textContent = original;
          btn.disabled = false;
        }, 1600);
      }

      copyText(codeEl.textContent).then(
        function () {
          feedback("کپی شد");
        },
        function () {
          feedback("کپی نشد");
        }
      );
    });
  });

  // ------------------------------------------------------------------
  // Lightbox: click a report image to view it large; Esc / overlay click closes
  // ------------------------------------------------------------------

  var overlay = null;
  var lightboxImg = null;

  function buildOverlay() {
    overlay = document.createElement("div");
    overlay.className = "lightbox-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "نمایش تصویر در اندازه کامل");

    lightboxImg = document.createElement("img");
    lightboxImg.className = "lightbox-img";
    lightboxImg.alt = "";

    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "lightbox-close";
    closeBtn.textContent = "بستن";
    closeBtn.setAttribute("aria-label", "بستن");

    overlay.appendChild(lightboxImg);
    overlay.appendChild(closeBtn);
    document.body.appendChild(overlay);

    overlay.addEventListener("click", function (event) {
      if (event.target === overlay || event.target === closeBtn) close();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") close();
    });
  }

  function open(src, alt) {
    if (!overlay) buildOverlay();
    lightboxImg.src = src;
    lightboxImg.alt = alt || "";
    overlay.classList.add("open");
    document.body.style.overflow = "hidden";
    closeBtnFocus();
  }

  var closeBtnEl;

  function closeBtnFocus() {
    closeBtnEl = overlay.querySelector(".lightbox-close");
    if (closeBtnEl) closeBtnEl.focus();
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove("open");
    document.body.style.overflow = "";
    lightboxImg.src = "";
  }

  document.querySelectorAll("img.report-img").forEach(function (img) {
    img.addEventListener("click", function () {
      open(img.getAttribute("src"), img.getAttribute("alt"));
    });
  });

  // ------------------------------------------------------------------
  // Wide tables: show a swipe hint only when the table really overflows,
  // so people scroll the table instead of pinch-zooming out of the page.
  // ------------------------------------------------------------------

  var tableSyncs = [];

  document.querySelectorAll(".table-wrap").forEach(function (wrap) {
    var hint = null;

    function sync() {
      var scrollable = wrap.scrollWidth > wrap.clientWidth + 4;
      wrap.classList.toggle("is-scrollable", scrollable);

      if (scrollable && !hint) {
        hint = document.createElement("p");
        hint.className = "table-scroll-hint";
        hint.textContent = "◀ برای دیدن همهٔ ستون‌ها جدول را افقی بکشید ▶";
        wrap.parentNode.insertBefore(hint, wrap);
      } else if (!scrollable && hint) {
        if (hint.parentNode) hint.parentNode.removeChild(hint);
        hint = null;
      }
    }

    tableSyncs.push(sync);
    sync();
  });

  var resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      tableSyncs.forEach(function (fn) {
        fn();
      });
    }, 150);
  });

  // Fonts change table widths once they finish loading.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      tableSyncs.forEach(function (fn) {
        fn();
      });
    });
  }
})();
