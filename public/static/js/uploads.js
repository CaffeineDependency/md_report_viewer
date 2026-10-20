// Editor upload panel: upload an image or project file, then either copy the
// asset URL or insert the Markdown reference at the cursor. Persian UI.

(function () {
  "use strict";

  var imageInput = document.getElementById("editor-image-input");
  var fileInput = document.getElementById("editor-file-input");
  var statusEl = document.getElementById("editor-upload-status");
  var listEl = document.getElementById("editor-upload-list");

  if (!imageInput || !fileInput || !statusEl || !listEl) return;

  function markEditorDirty() {
    var textarea = document.getElementById("report-markdown");
    if (!textarea) return;
    // Reuse the editor's input listener (dirty flag + local draft autosave).
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function insertAtCursor(text) {
    var textarea = document.getElementById("report-markdown");
    if (!textarea) return false;
    var start = textarea.selectionStart || 0;
    var end = textarea.selectionEnd || 0;
    textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
    textarea.selectionStart = textarea.selectionEnd = start + text.length;
    textarea.focus();
    markEditorDirty();
    return true;
  }

  function setStatus(text, visible) {
    statusEl.textContent = text;
    statusEl.hidden = visible === undefined ? false : !visible;
  }

  function defaultName(filename, kind) {
    if (kind === "image") {
      var base = filename.replace(/\.[^.]+$/, "");
      return "![توضیح تصویر " + base + "](" + "URL" + ")";
    }
    return "[دانلود " + filename + "](" + "URL" + ")";
  }

  function addRow(item) {
    var li = document.createElement("li");
    li.className = "upload-item";

    var urlSpan = document.createElement("span");
    urlSpan.className = "upload-url";
    urlSpan.dir = "ltr";
    urlSpan.title = item.url;
    urlSpan.textContent = item.url;

    var copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "btn btn-ghost btn-small";
    copyBtn.textContent = "کپی نشانی";
    copyBtn.addEventListener("click", function () {
      navigator.clipboard.writeText(item.url).catch(function () {
        window.prompt("نشانی فایل:", item.url);
      });
    });

    var insertBtn = document.createElement("button");
    insertBtn.type = "button";
    insertBtn.className = "btn btn-ghost btn-small";
    insertBtn.textContent = item.kind === "image" ? "درج تصویر در متن" : "درج لینک دانلود";
    insertBtn.addEventListener("click", function () {
      var ref =
        item.kind === "image"
          ? "![" + item.filename.replace(/\.[^.]+$/, "") + "](" + item.url + ")\n"
          : "[" + item.filename + "](" + item.url + ")\n";
      if (!insertAtCursor(ref)) {
        copyBtn.click();
      }
    });

    if (item.kind === "image") {
      var preview = document.createElement("a");
      preview.href = item.url;
      preview.target = "_blank";
      preview.rel = "noopener";
      var img = document.createElement("img");
      img.src = item.url;
      img.alt = item.filename;
      img.className = "upload-thumb";
      preview.appendChild(img);
      li.appendChild(preview);
    }

    var nameSpan = document.createElement("span");
    nameSpan.className = "upload-name";
    nameSpan.textContent = item.filename;
    nameSpan.title = nameSpan.textContent;

    var info = document.createElement("div");
    info.className = "upload-info";
    info.appendChild(nameSpan);
    info.appendChild(urlSpan);

    var actions = document.createElement("div");
    actions.className = "upload-actions";
    actions.appendChild(copyBtn);
    actions.appendChild(insertBtn);

    li.appendChild(info);
    li.appendChild(actions);
    listEl.appendChild(li);
  }

  function upload(file, kind) {
    if (!file) return;
    var form = new FormData();
    form.append("kind", kind);
    form.append("file", file);

    setStatus("در حال بارگذاری «" + file.name + "»…");
    imageInput.disabled = true;
    fileInput.disabled = true;

    fetch("/api/assets", {
      method: "POST",
      headers: { "X-Requested-With": "fetch" },
      body: form,
    })
      .then(function (response) {
        return response.json().catch(function () { return null; }).then(function (data) {
          if (!response.ok || !data || !data.ok) {
            throw new Error(data && data.error ? data.error : "بارگذاری ناموفق بود.");
          }
          return data;
        });
      })
      .then(function (data) {
        setStatus("", true); // hidden
        statusEl.hidden = true;
        addRow(data);
      })
      .catch(function (err) {
        setStatus(err.message || "بارگذاری ناموفق بود.");
      })
      .finally(function () {
        imageInput.disabled = false;
        fileInput.disabled = false;
        imageInput.value = "";
        fileInput.value = "";
      });
  }

  imageInput.addEventListener("change", function () {
    upload(imageInput.files[0], "image");
  });
  fileInput.addEventListener("change", function () {
    upload(fileInput.files[0], "file");
  });
})();
