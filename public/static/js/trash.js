// Trash page: restore, permanent delete, and the asset cleanup sweeper.

(function () {
  "use strict";

  function api(url, options) {
    options = options || {};
    return fetch(url, Object.assign({}, options, {
      headers: Object.assign(
        { "X-Requested-With": "fetch", "Content-Type": "application/json" },
        options.headers || {}
      ),
    })).then(function (response) {
      return response.json().catch(function () { return null; }).then(function (data) {
        if (!response.ok) {
          throw new Error(data && data.error ? data.error : "خطای سرور.");
        }
        return data;
      });
    });
  }

  function reportDone() {
    window.location.reload();
  }

  function reportError(err) {
    window.alert(err && err.message ? err.message : "خطای ناشناخته.");
  }

  document.querySelectorAll(".btn-restore").forEach(function (btn) {
    btn.addEventListener("click", function () {
      btn.disabled = true;
      api("/api/reports/" + btn.dataset.id + "/restore", { method: "POST" })
        .then(reportDone)
        .catch(reportError);
    });
  });

  document.querySelectorAll(".btn-purge").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var title = btn.dataset.title || "این گزارش";
      if (!window.confirm(
        "«" + title + "» برای همیشه حذف شود؟ فایل‌هایی که هیچ گزارش دیگری به آن‌ها ارجاع نمی‌دهد نیز پاک خواهند شد و این عمل قابل بازگشت نیست."
      )) {
        return;
      }
      btn.disabled = true;
      api("/api/reports/" + btn.dataset.id + "/permanent", { method: "DELETE" })
        .then(reportDone)
        .catch(function (err) {
          btn.disabled = false;
          reportError(err);
        });
    });
  });

  var cleanupBtn = document.getElementById("cleanup-btn");
  var cleanupResult = document.getElementById("cleanup-result");
  if (cleanupBtn && cleanupResult) {
    cleanupBtn.addEventListener("click", function () {
      if (!window.confirm("فایل‌های بی‌رفرنس برای همیشه حذف شوند؟")) return;
      cleanupBtn.disabled = true;
      cleanupResult.hidden = true;
      api("/api/cleanup", { method: "POST" })
        .then(function (data) {
          cleanupResult.textContent =
            "پاک‌سازی انجام شد: " +
            data.pendingDeleted + " فایل نیمه‌حذف، " +
            data.orphansPurged + " فایل بی‌رفرنس، " +
            data.r2OrphansDeleted + " فایل بدون ثبت — پاک شدند.";
          cleanupResult.hidden = false;
          cleanupBtn.disabled = false;
        })
        .catch(function (err) {
          cleanupBtn.disabled = false;
          reportError(err);
        });
    });
  }
})();
