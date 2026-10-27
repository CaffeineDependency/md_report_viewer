// Admin panel pages: dashboard (report list), new-report editor, edit editor.
// Every route is auth-gated server-side; unauthenticated requests redirect.

import { route } from "../router.js";
import { escapeHtml, htmlResponse, layout, notFoundPage, redirect } from "../lib/html.js";
import { isAuthed } from "../lib/auth.js";
import { faNum, jalaliDate } from "../lib/persian.js";

const statusLabel = (status) =>
  status === "published" ? "منتشرشده" : status === "draft" ? "پیش‌نویس" : "حذف‌شده";

route("GET", "/admin", async (request, env) => {
  if (!(await isAuthed(request, env))) return redirect("/login");

  const stats = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published,
       SUM(CASE WHEN status = 'draft'     THEN 1 ELSE 0 END) AS drafts
       FROM reports`
  ).first();

  const { results } = await env.DB.prepare(
    `SELECT id, slug, title, status, updated_at, created_at
       FROM reports WHERE status != 'deleted'
       ORDER BY updated_at DESC LIMIT 100`
  ).all();

  const trashCount = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM reports WHERE status = 'deleted'"
  ).first();

  let listBlock;
  if (!results || results.length === 0) {
    listBlock = `<div class="card empty-state">
  <h2>هنوز گزارشی ثبت نشده است</h2>
  <p class="muted">اولین گزارش آزمایش را بسازید.</p>
  <a class="btn btn-primary" href="/admin/new">گزارش جدید</a>
</div>`;
  } else {
    const items = results
      .map(
        (r) => `<li class="card report-admin-item">
  <div class="admin-item-main">
    <a href="/admin/edit/${r.id}">${escapeHtml(r.title)}</a>
    <div class="report-meta">
      <span class="chip ${r.status === "published" ? "chip-published" : ""}">${statusLabel(r.status)}</span>
      <span>آخرین تغییر: ${escapeHtml(jalaliDate(r.updated_at))}</span>
      ${r.status === "published" ? `<a href="/reports/${encodeURIComponent(r.slug)}">مشاهده صفحه</a>` : ""}
    </div>
  </div>
  <div class="admin-item-actions">
    <button type="button" class="btn btn-danger btn-small btn-delete"
            data-id="${r.id}" data-title="${escapeHtml(r.title)}">حذف</button>
    <a class="btn btn-ghost" href="/admin/edit/${r.id}">ویرایش</a>
  </div>
</li>`
      )
      .join("\n");
    listBlock = `<ul class="admin-list">${items}</ul>`;
  }

  const published = stats?.published ?? 0;
  const drafts = stats?.drafts ?? 0;
  const inTrash = trashCount?.c ?? 0;

  return htmlResponse(
    layout({
      title: "پیشخوان مدیریت — گزارش‌کار",
      nav: "admin",
      body: `<section>
  <div class="page-head">
    <h1>گزارش‌ها</h1>
    <div class="page-head-actions">
      <a class="btn btn-ghost" href="/admin/assets">کتابخانه فایل‌ها</a>
      <a class="btn btn-ghost" href="/admin/trash">سطل زباله${inTrash > 0 ? ` (${faNum(inTrash)})` : ""}</a>
      <a class="btn btn-primary" href="/admin/new">گزارش جدید</a>
    </div>
  </div>
  <div class="stats">
    <div class="stat"><div class="stat-num">${faNum(published)}</div><div class="muted">منتشرشده</div></div>
    <div class="stat"><div class="stat-num">${faNum(drafts)}</div><div class="muted">پیش‌نویس</div></div>
  </div>
  ${listBlock}
</section>`,
    })
  );
});

// ---------------------------------------------------------------------------
// Asset library page: upload + every stored asset with usage count
// ---------------------------------------------------------------------------

route("GET", "/admin/assets", async (request, env) => {
  if (!(await isAuthed(request, env))) return redirect("/login");

  return htmlResponse(
    layout({
      title: "کتابخانه فایل‌ها — پیشخوان گزارش‌کار",
      nav: "admin",
      body: `<section>
  <div class="page-head">
    <h1>کتابخانه فایل‌ها و تصاویر</h1>
    <a class="btn btn-ghost" href="/admin">بازگشت به پیشخوان</a>
  </div>
  <div class="card upload-box">
    <h2>بارگذاری تصویر</h2>
    <p class="muted">فرمت‌های مجاز: PNG، JPEG، WebP، GIF — حداکثر حجم مطابق تنظیمات سرور؛ SVG مجاز نیست.</p>
    <label class="upload-label">
      <input type="file" id="library-image-input" accept=".png,.jpg,.jpeg,.webp,.gif">
    </label>
    <button type="button" id="library-image-btn" class="btn btn-primary">بارگذاری تصویر</button>
  </div>
  <div class="card upload-box">
    <h2>بارگذاری فایل قابل دانلود</h2>
    <p class="muted">هر نوع فایلی پذیرفته می‌شود، با یا بدون پسوند (به‌صورت پیوست دانلود می‌شود)؛ حداکثر حجم مطابق تنظیمات سرور.</p>
    <label class="upload-label">
      <input type="file" id="library-file-input">
    </label>
    <button type="button" id="library-file-btn" class="btn btn-primary">بارگذاری فایل</button>
  </div>
  <p id="library-message"></p>
  <div id="asset-list" class="asset-list"></div>
</section>
<script src="/static/js/admin-assets.js" defer></script>`,
    })
  );
});

// Shared editor page: data attributes delivered via a non-executing JSON <script>.
const editorPage =
  "#report-form, #editor-message, #btn-preview, #btn-save, #btn-publish";

function editorBody(data) {
  const jsonData = JSON.stringify(data).replace(/</g, "\\u003c");
  const isEdit = data.mode === "edit";
  const heading = isEdit ? "ویرایش گزارش" : "گزارش جدید";
  return `<section class="card editor-card">
  <div class="page-head">
    <h1>${heading}</h1>
    ${isEdit ? `<a class="btn btn-ghost" href="/admin">بازگشت به پیشخوان</a>` : ""}
  </div>
  <form id="report-form" novalidate>
    <label for="report-title">عنوان گزارش</label>
    <input type="text" id="report-title" maxlength="200">
    <div class="field-row">
      <div>
        <label for="report-category">دسته‌بندی (اختیاری)</label>
        <input type="text" id="report-category" maxlength="60">
      </div>
      <div>
        <label for="report-tags">برچسب‌ها (با ویرگول جدا کنید؛ اختیاری)</label>
        <input type="text" id="report-tags" maxlength="200">
      </div>
    </div>
    <label for="report-markdown">متن گزارش (Markdown)</label>
    <textarea id="report-markdown" dir="rtl" spellcheck="false" rows="20"
      placeholder="متن گزارش را اینجا بنویسید یا Markdown تولیدشده را بچسبانید."></textarea>
    <div class="editor-actions">
      <button type="button" id="btn-save" class="btn btn-primary">ذخیره پیش‌نویس</button>
      <button type="button" id="btn-publish" class="btn btn-primary">انتشار</button>
      <button type="button" id="btn-preview" class="btn btn-ghost">پیش‌نمایش</button>
      <button type="button" id="btn-refresh-preview" class="btn btn-ghost" hidden>به‌روزرسانی پیش‌نمایش</button>
      <button type="button" id="btn-restore-draft" class="btn btn-ghost" hidden>بازیابی پیش‌نویس محلی</button>
    </div>
    <p id="editor-message"></p>
  </form>
  <section id="preview-area" class="markdown-body card" hidden></section>
</section>
<div class="card upload-panel" id="upload-panel">
  <h2>تصاویر و فایل‌های پروژه</h2>
  <div class="upload-row">
    <label class="btn btn-ghost">بارگذاری تصویر
      <input type="file" id="editor-image-input" accept=".png,.jpg,.jpeg,.webp,.gif" hidden>
    </label>
    <label class="btn btn-ghost">بارگذاری فایل
      <input type="file" id="editor-file-input" hidden>
    </label>
    <span id="editor-upload-status" class="muted" hidden>در حال بارگذاری…</span>
  </div>
  <ul id="editor-upload-list" class="upload-list"></ul>
  <p class="muted">پس از بارگذاری، با «درج در متن» ارجاع Markdown در محل مکان‌نما اضافه می‌شود؛ یا نشانی فایل را کپی کنید و خودتان در متن بگذارید. برای مدیریت همه فایل‌ها به <a href="/admin/assets">کتابخانه فایل‌ها</a> مراجعه کنید.</p>
</div>
<script id="editor-data" type="application/json">${jsonData}</script>
<script src="/static/js/uploads.js" defer></script>`;
}

route("GET", "/admin/new", async (request, env) => {
  if (!(await isAuthed(request, env))) return redirect("/login");
  return htmlResponse(
    layout({
      title: "گزارش جدید — پیشخوان گزارش‌کار",
      nav: "admin",
      body: editorBody({ mode: "new", reportId: null, slug: null, status: "draft" }),
    })
  );
});

route("GET", "/admin/edit/:id", async (request, env, params) => {
  if (!(await isAuthed(request, env))) return redirect("/login");

  const row = await env.DB.prepare(
    `SELECT id, slug, title, status, created_at, updated_at, deleted_at
       FROM reports WHERE id = ?`
  )
    .bind(params.id)
    .first();
  if (!row) return htmlResponse(notFoundPage(), { status: 404 });

  return htmlResponse(
    layout({
      title: `ویرایش: ${row.title} — پیشخوان گزارش‌کار`,
      nav: "admin",
      body: editorBody({
        mode: "edit",
        reportId: row.id,
        slug: row.slug,
        status: row.status,
      }),
    })
  );
});

// ---------------------------------------------------------------------------
// Trash: soft-deleted reports with restore / permanent delete, plus the
// asset cleanup sweeper button.
// ---------------------------------------------------------------------------

route("GET", "/admin/trash", async (request, env) => {
  if (!(await isAuthed(request, env))) return redirect("/login");

  const { results } = await env.DB.prepare(
    `SELECT id, title, deleted_at FROM reports
      WHERE status = 'deleted' ORDER BY deleted_at DESC LIMIT 100`
  ).all();

  let listBlock;
  if (!results || results.length === 0) {
    listBlock = `<div class="card empty-state">
  <h2>سطل زباله خالی است</h2>
  <p class="muted">گزارش‌های حذف‌شده پیش از حذف همیشگی اینجا قرار می‌گیرند.</p>
</div>`;
  } else {
    const items = results
      .map(
        (r) => `<li class="card report-admin-item" id="trash-${r.id}">
  <div class="admin-item-main">
    <strong>${escapeHtml(r.title)}</strong>
    <div class="report-meta"><span>حذف‌شده: ${escapeHtml(jalaliDate(r.deleted_at))}</span></div>
  </div>
  <div class="admin-item-actions">
    <button type="button" class="btn btn-ghost btn-small btn-restore" data-id="${r.id}">بازیابی</button>
    <button type="button" class="btn btn-danger btn-small btn-purge" data-id="${r.id}"
            data-title="${escapeHtml(r.title)}">حذف همیشگی</button>
  </div>
</li>`
      )
      .join("\n");
    listBlock = `<ul class="admin-list">${items}</ul>`;
  }

  return htmlResponse(
    layout({
      title: "سطل زباله — پیشخوان گزارش‌کار",
      nav: "admin",
      body: `<section>
  <div class="page-head">
    <h1>سطل زباله</h1>
    <a class="btn btn-ghost" href="/admin">بازگشت به پیشخوان</a>
  </div>
  <p class="muted">بازیابی، گزارش را به حالت پیش‌نویس برمی‌گرداند. حذف همیشگی، گزارش و فایل‌های بی‌رفرنس آن را برای همیشه پاک می‌کند.</p>
  ${listBlock}
  <div class="card upload-box">
    <h2>پاک‌سازی فایل‌های بی‌رفرنس</h2>
    <p class="muted">فایل‌های بارگذاری‌شده‌ای که هیچ گزارشی به آن‌ها ارجاع نمی‌دهد (و بیش از یک ساعت از بارگذاری‌شان گذشته) را برای همیشه حذف می‌کند.</p>
    <button type="button" id="cleanup-btn" class="btn btn-primary">پاک‌سازی کن</button>
    <p id="cleanup-result" class="form-success" hidden></p>
  </div>
</section>
<script src="/static/js/trash.js" defer></script>`,
    })
  );
});
