// Admin panel scripts (loaded on dashboard, editor and future admin pages).
// All user-facing messages are Persian. No frameworks; no inline scripts.

(function () {
  "use strict";

  // ------------------------------------------------------------------
  // Shared: authed fetch wrapper (adds the CSRF custom header)
  // ------------------------------------------------------------------

  function api(url, options) {
    options = options || {};
    return fetch(url, Object.assign({}, options, {
      headers: Object.assign(
        {
          "X-Requested-With": "fetch",
          "Content-Type": "application/json",
        },
        options.headers || {}
      ),
    })).then(function (response) {
      return response.json().catch(function () { return null; }).then(function (data) {
        if (!response.ok) {
          var message = data && data.error ? data.error : "خطای سرور.";
          var err = new Error(message);
          err.status = response.status;
          throw err;
        }
        return data;
      });
    });
  }

  function sentRequestForbidden() {
    return "درخواست رد شد؛ لطفاً صفحه را تازه‌سازی کنید و دوباره تلاش کنید.";
  }

  function statusMessage(err) {
    if (err && err.status === 403) return sentRequestForbidden();
    if (err && err.status === 401) return "نشست شما منقضی شده است؛ دوباره وارد شوید.";
    return err && err.message ? err.message : "خطای ناشناخته.";
  }

  // ------------------------------------------------------------------
  // Logout (all admin pages)
  // ------------------------------------------------------------------

  var logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", function () {
      api("/api/auth/logout", { method: "POST" })
        .then(function () {
          window.location.replace("/login");
        })
        .catch(function () {
          window.location.replace("/login");
        });
    });
  }

  // ------------------------------------------------------------------
  // Dashboard: move a report to the trash (soft delete)
  // ------------------------------------------------------------------

  document.querySelectorAll(".btn-delete").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var title = btn.dataset.title || "این گزارش";
      if (!window.confirm("«" + title + "» به سطل زباله منتقل شود؟ می‌توانید بعداً آن را بازیابی کنید.")) {
        return;
      }
      btn.disabled = true;
      api("/api/reports/" + btn.dataset.id, { method: "DELETE" })
        .then(function () {
          window.location.reload();
        })
        .catch(function (err) {
          btn.disabled = false;
          window.alert(err && err.message ? err.message : "حذف ناموفق بود.");
        });
    });
  });

  // ------------------------------------------------------------------
  // Editor page
  // ------------------------------------------------------------------

  var dataEl = document.getElementById("editor-data");
  var form = document.getElementById("report-form");
  if (!dataEl || !form) return;

  var data;
  try {
    data = JSON.parse(dataEl.textContent);
  } catch (e) {
    return;
  }

  var el = {
    title: document.getElementById("report-title"),
    category: document.getElementById("report-category"),
    tags: document.getElementById("report-tags"),
    markdown: document.getElementById("report-markdown"),
    save: document.getElementById("btn-save"),
    publish: document.getElementById("btn-publish"),
    preview: document.getElementById("btn-preview"),
    restore: document.getElementById("btn-restore-draft"),
    previewArea: document.getElementById("preview-area"),
    message: document.getElementById("editor-message"),
  };

  var status = data.status || "draft";
  var reportId = data.reportId;
  var dirty = false;
  var busy = false;
  var draftKey = "gk:draft:" + (reportId || "new");

  function setMessage(text, kind) {
    el.message.textContent = text;
    el.message.className = kind === "error" ? "form-error" : "form-success";
  }

  function setBusy(value) {
    busy = value;
    [el.save, el.publish, el.preview].forEach(function (b) {
      if (b) b.disabled = value;
    });
  }

  function readFields() {
    return {
      title: el.title.value,
      category: el.category.value,
      tags: el.tags.value,
      markdown: el.markdown.value,
    };
  }

  function validateClient() {
    var fields = readFields();
    if (!fields.title.trim()) return "عنوان گزارش را وارد کنید.";
    if (!fields.markdown.trim()) return "متن گزارش خالی است.";
    return null;
  }

  // --- local draft ---------------------------------------------------

  var savedDraft = null;
  try {
    savedDraft = JSON.parse(window.localStorage.getItem(draftKey) || "null");
  } catch (e) {
    savedDraft = null;
  }

  function showRestoreOption() {
    if (savedDraft && el.restore) el.restore.hidden = false;
  }

  if (el.restore) {
    el.restore.addEventListener("click", function () {
      if (!savedDraft) return;
      el.title.value = savedDraft.title || "";
      el.category.value = savedDraft.category || "";
      el.tags.value = savedDraft.tags || "";
      el.markdown.value = savedDraft.markdown || "";
      dirty = true;
      el.restore.hidden = true;
      setMessage("پیش‌نویس محلی بازیابی شد.", "ok");
    });
  }

  function clearLocalDraft() {
    try {
      window.localStorage.removeItem(draftKey);
      savedDraft = null;
      if (el.restore) el.restore.hidden = true;
    } catch (e) { /* storage unavailable; ignore */ }
  }

  el.markdown.addEventListener("input", function () {
    dirty = true;
    try {
      window.localStorage.setItem(draftKey, JSON.stringify(readFields()));
    } catch (e) { /* storage unavailable; ignore */ }
  });
  el.title.addEventListener("input", function () {
    dirty = true;
  });

  window.addEventListener("beforeunload", function (event) {
    if (dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  // --- load existing report (edit mode) --------------------------------

  if (data.mode === "edit" && reportId) {
    api("/api/reports/" + reportId)
      .then(function (res) {
        var r = res.report;
        status = r.status;
        el.title.value = r.title || "";
        el.category.value = r.category || "";
        el.tags.value = r.tags || "";
        el.markdown.value = r.markdown || "";
        updatePublishButton(r.slug);
        showRestoreOption();
      })
      .catch(function (err) {
        setMessage("بارگذاری گزارش ناموفق بود: " + statusMessage(err), "error");
        setBusy(true);
      });
  } else {
    showRestoreOption();
    el.title.focus();
  }

  function updatePublishButton() {
    if (status === "published" && el.publish) {
      el.publish.hidden = true;
    }
  }

  // --- preview -----------------------------------------------------------

  var previewVisible = false;

  el.preview.addEventListener("click", function () {
    previewVisible = !previewVisible;
    if (!previewVisible) {
      el.previewArea.hidden = true;
      el.preview.textContent = "پیش‌نمایش";
      return;
    }
    var error = validateClient();
    if (error) {
      previewVisible = false;
      setMessage(error, "error");
      return;
    }
    setBusy(true);
    api("/api/preview", { method: "POST", body: JSON.stringify({ markdown: el.markdown.value }) })
      .then(function (res) {
        el.previewArea.innerHTML = res.html;
        el.previewArea.hidden = false;
        el.preview.textContent = "بستن پیش‌نمایش";
      })
      .catch(function (err) {
        setMessage(statusMessage(err), "error");
        previewVisible = false;
      })
      .finally(function () {
        setBusy(false);
      });
  });

  // --- save ---------------------------------------------------------------

  function saveReport() {
    var error = validateClient();
    if (error) return Promise.reject(new Error(error));

    var fields = readFields();
    if (data.mode === "new") {
      return api("/api/reports", { method: "POST", body: JSON.stringify(fields) }).then(function (res) {
        reportId = res.id;
        status = res.status;
        draftKey = "gk:draft:" + reportId;
        dirty = false;
        return res;
      });
    }
    return api("/api/reports/" + reportId, { method: "PUT", body: JSON.stringify(fields) }).then(function (res) {
      dirty = false;
      return res;
    });
  }

  function afterSave(saveResult, message) {
    clearLocalDraft();
    setMessage(message, "ok");
    if (data.mode === "new") {
      // switch to the edit URL so reloads keep working on the same report
      window.location.replace("/admin/edit/" + reportId);
    }
  }

  el.save.addEventListener("click", function () {
    if (busy) return;
    setBusy(true);
    saveReport()
      .then(function () {
        afterSave(null, "پیش‌نویس ذخیره شد.");
      })
      .catch(function (err) {
        setMessage(statusMessage(err), "error");
      })
      .finally(function () {
        setBusy(false);
      });
  });

  // --- publish (explicit confirmation) ----------------------------------

  if (el.publish) {
    el.publish.addEventListener("click", function () {
      if (busy) return;
      if (!window.confirm("آیا از انتشار این گزارش مطمئن هستید؟ گزارش در صفحه اصلی قابل مشاهده خواهد بود.")) {
        return;
      }
      setBusy(true);
      saveReport()
        .then(function () {
          return api("/api/reports/" + reportId + "/publish", { method: "POST" });
        })
        .then(function () {
          clearLocalDraft();
          dirty = false;
          setMessage("گزارش منتشر شد.", "ok");
          if (data.mode === "new") {
            window.location.replace("/admin/edit/" + reportId);
          } else {
            window.location.reload();
          }
        })
        .catch(function (err) {
          setMessage(statusMessage(err), "error");
          setBusy(false);
        });
    });
  }
})();
