// Asset library page: upload image/file, list all assets with usage counts,
// copy URL, delete only when unreferenced. Persian UI.

(function () {
  "use strict";

  var imageInput = document.getElementById("library-image-input");
  var imageBtn = document.getElementById("library-image-btn");
  var fileInput = document.getElementById("library-file-input");
  var fileBtn = document.getElementById("library-file-btn");
  var messageEl = document.getElementById("library-message");
  var listEl = document.getElementById("asset-list");

  if (!imageBtn || !fileBtn || !listEl) return;

  function setMessage(text, kind) {
    if (!messageEl) return;
    messageEl.textContent = text || "";
    messageEl.className = kind === "error" ? "form-error" : "form-success";
  }

  function croak(err) {
    setMessage(err && err.message ? err.message : "خطای ناشناخته.", "error");
  }

  function upload(input, button, kind) {
    var file = input.files && input.files[0];
    if (!file) {
      setMessage("ابتدا یک فایل انتخاب کنید.", "error");
      return;
    }
    button.disabled = true;
    input.disabled = true;
    setMessage("در حال بارگذاری «" + file.name + "»…", "ok");

    var form = new FormData();
    form.append("kind", kind);
    form.append("file", file);

    fetch("/api/assets", {
      method: "POST",
      headers: { "X-Requested-With": "fetch" },
      body: form,
    })
      .then(function (response) {
        return response.json().catch(function () { return null; }).then(function (data) {
          if (!response.ok) throw new Error(data && data.error ? data.error : "بارگذاری ناموفق بود.");
          return data;
        });
      })
      .then(function (data) {
        setMessage("«" + data.filename + "» بارگذاری شد. نشانی: " + data.url, "ok");
        return refresh();
      })
      .catch(croak)
      .finally(function () {
        button.disabled = false;
        input.disabled = false;
        input.value = "";
      });
  }

  imageBtn.addEventListener("click", function () {
    upload(imageInput, imageBtn, "image");
  });
  fileBtn.addEventListener("click", function () {
    upload(fileInput, fileBtn, "file");
  });

  // ------------------------------------------------------------------
  // Persian byte formatting (mirrors src/lib/persian.js)
  // ------------------------------------------------------------------

  var faNumFmt = new Intl.NumberFormat("fa-IR");

  function faBytes(n) {
    if (n < 1024) return faNumFmt.format(n) + " بایت";
    if (n < 1048576) return faNumFmt.format(Number((n / 1024).toFixed(1))) + " کیلوبایت";
    return faNumFmt.format(Number((n / 1048576).toFixed(1))) + " مگابایت";
  }

  function copyText(text) {
    navigator.clipboard.writeText(text).catch(function () {
      window.prompt("نشانی فایل:", text);
    });
  }

  // ------------------------------------------------------------------
  // Listing
  // ------------------------------------------------------------------

  function refresh() {
    return fetch("/api/assets", { headers: { "X-Requested-With": "fetch" } })
      .then(function (response) {
        if (!response.ok) throw new Error("فهرست فایل‌ها دریافت نشد.");
        return response.json();
      })
      .then(function (data) {
        renderList(data.assets || []);
      })
      .catch(croak);
  }

  function deleteAsset(asset) {
    if (!window.confirm("«" + asset.filename + "» برای همیشه حذف شود؟ این عمل قابل بازگشت نیست.")) {
      return;
    }
    fetch("/api/assets/" + asset.id, {
      method: "DELETE",
      headers: { "X-Requested-With": "fetch" },
    })
      .then(function (response) {
        return response.json().catch(function () { return null; }).then(function (data) {
          if (!response.ok) throw new Error(data && data.error ? data.error : "حذف ناموفق بود.");
        });
      })
      .then(function () {
        setMessage("«" + asset.filename + "» برای همیشه حذف شد.", "ok");
        return refresh();
      })
      .catch(croak);
  }

  function renderList(assets) {
    listEl.textContent = "";
    if (assets.length === 0) {
      var empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "هنوز فایل یا تصویری بارگذاری نشده است.";
      listEl.appendChild(empty);
      return;
    }

    assets.forEach(function (asset) {
      var row = document.createElement("div");
      row.className = "card asset-row";

      if (asset.kind === "image") {
        var link = document.createElement("a");
        link.href = asset.url;
        link.target = "_blank";
        link.rel = "noopener";
        var img = document.createElement("img");
        img.src = asset.url;
        img.alt = asset.filename;
        img.className = "asset-thumb";
        link.appendChild(img);
        row.appendChild(link);
      } else {
        var extMatch = asset.filename.match(/\.([^.]+)$/);
        var icon = document.createElement("span");
        icon.className = "asset-icon";
        icon.textContent = extMatch ? extMatch[1].toUpperCase() : "BIN";
        row.appendChild(icon);
      }

      var meta = document.createElement("div");
      meta.className = "asset-meta";
      var name = document.createElement("div");
      name.className = "asset-name";
      name.textContent = asset.filename;
      var sub = document.createElement("div");
      sub.className = "muted";
      sub.textContent =
        (asset.used_count > 0
          ? "استفاده در " + faNumFmt.format(asset.used_count) + " گزارش"
          : "بدون رفرنس") +
        " — " +
        faBytes(asset.size);
      meta.appendChild(name);
      meta.appendChild(sub);

      var urlSpan = document.createElement("span");
      urlSpan.className = "upload-url asset-url";
      urlSpan.dir = "ltr";
      urlSpan.title = asset.url;
      urlSpan.textContent = asset.url;
      meta.appendChild(urlSpan);

      row.appendChild(meta);

      var actions = document.createElement("div");
      actions.className = "asset-actions";

      var copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "btn btn-ghost btn-small";
      copyBtn.textContent = "کپی نشانی";
      copyBtn.addEventListener("click", function () {
        copyText(asset.url);
      });
      actions.appendChild(copyBtn);

      if (asset.used_count === 0) {
        var delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "btn btn-danger btn-small";
        delBtn.textContent = "حذف";
        delBtn.addEventListener("click", function () {
          deleteAsset(asset);
        });
        actions.appendChild(delBtn);
      }

      row.appendChild(actions);
      listEl.appendChild(row);
    });
  }

  refresh();
})();
