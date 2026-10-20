// Public (unauthenticated) pages: homepage (list/search/filter), login, and
// the server-rendered report page.

import { route } from "../router.js";
import { escapeHtml, htmlResponse, layout, notFoundPage } from "../lib/html.js";
import { faNum, jalaliDate } from "../lib/persian.js";
import { markdownExcerpt, renderMarkdown } from "../lib/renderer.js";

const PAGE_SIZE = 100;

function escapeLike(input) {
  return input.replace(/[\\%_]/g, (m) => "\\" + m);
}

route("GET", "/", async (request, env) => {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
  const category = (url.searchParams.get("category") || "").trim().slice(0, 60);
  const filtered = q !== "" || category !== "";

  // Cheap single-table queries only; no full-text machinery.
  let articles;
  {
    let sql = `SELECT id, slug, title, category, tags, created_at
                 FROM reports
                WHERE status = 'published'`;
    const binds = [];
    if (q !== "") {
      const pattern = `%${escapeLike(q)}%`;
      sql += ` AND (title LIKE ? ESCAPE '\\' OR (tags IS NOT NULL AND tags LIKE ? ESCAPE '\\'))`;
      binds.push(pattern, pattern);
    }
    if (category !== "") {
      sql += ` AND category = ?`;
      binds.push(category);
    }
    sql += ` ORDER BY created_at DESC LIMIT ${PAGE_SIZE}`;
    articles = (await env.DB.prepare(sql).bind(...binds).all()).results || [];
  }

  const categories = (
    await env.DB.prepare(
      `SELECT category, COUNT(*) AS c
         FROM reports
        WHERE status = 'published' AND category IS NOT NULL AND category != ''
        GROUP BY category
        ORDER BY c DESC
        LIMIT 20`
    ).all()
  ).results || [];

  // ----- filter UI -----------------------------------------------------------

  const chips = categories
    .map((c) => {
      const active = category === c.category;
      const label = `${escapeHtml(c.category)} (${faNum(c.c)})`;
      return active
        ? `<span class="chip chip-active" aria-current="true">${label}</span>`
        : `<a class="chip" href="/?category=${encodeURIComponent(c.category)}">${label}</a>`;
    })
    .join(" ");

  const filterBar =
    (q !== "" || categories.length > 0
      ? `<div class="filter-bar">
  <form class="search-form" method="get" action="/">
    <input type="search" name="q" placeholder="جستجو در عنوان و برچسب‌ها…"
           value="${escapeHtml(q)}" maxlength="100" aria-label="جستجو">
    ${category !== "" ? `<input type="hidden" name="category" value="${escapeHtml(category)}">` : ""}
    <button type="submit" class="btn btn-primary btn-small">جستجو</button>
  </form>
  ${chips ? `<div class="chips-row">${chips}</div>` : ""}
</div>`
      : "");

  const clearLink =
    filtered && (q || category)
      ? `<p class="muted clear-filters"><a href="/">حذف فیلترها</a></p>`
      : "";

  // ----- results -------------------------------------------------------------

  let listBlock;
  if (articles.length === 0) {
    listBlock = filtered
      ? `<div class="card empty-state">
  <h2>نتیجه‌ای یافت نشد</h2>
  <p class="muted">عبارت یا دسته‌بندی دیگری را امتحان کنید.</p>
</div>`
      : `<div class="card empty-state">
  <h1>هنوز گزارشی منتشر نشده است</h1>
  <p class="muted">گزارش‌های آزمایش پس از انتشار در همین صفحه فهرست می‌شوند.</p>
</div>`;
  } else {
    const items = articles
      .map(
        (r) => `<li class="card report-item">
  <a href="/reports/${encodeURIComponent(r.slug)}">${escapeHtml(r.title)}</a>
  <div class="report-meta">
    <span>${escapeHtml(jalaliDate(r.created_at))}</span>
    ${r.category ? `<a class="chip" href="/?category=${encodeURIComponent(r.category)}">${escapeHtml(r.category)}</a>` : ""}
  </div>
</li>`
      )
      .join("\n");
    listBlock = `<ul class="report-list">${items}</ul>`;
  }

  return htmlResponse(
    layout({
      title:
        q !== ""
          ? `جستجو: ${q} — گزارش‌کار`
          : "گزارش‌کار — فهرست گزارش‌های آزمایش",
      body: `<section>
  <h1>فهرست گزارش‌های آزمایش</h1>
  ${filterBar}
  ${clearLink}
  ${listBlock}
</section>`,
    })
  );
});

route("GET", "/login", async () => {
  return htmlResponse(
    layout({
      title: "ورود مدیر — گزارش‌کار",
      body: `<section class="card auth-card">
  <h1>ورود مدیر</h1>
  <p class="muted">برای مدیریت گزارش‌ها و بارگذاری فایل‌ها وارد شوید.</p>
  <form id="login-form" novalidate>
    <label for="password">رمز عبور</label>
    <input type="password" id="password" name="password" dir="ltr"
           autocomplete="current-password" required>
    <button type="submit" class="btn btn-primary">ورود</button>
    <p id="login-error" class="form-error" hidden></p>
  </form>
</section>
<script src="/static/js/login.js" defer></script>`,
    })
  );
});

// ---------------------------------------------------------------------------
// Server-rendered report page. Only published reports are public; drafts and
// deleted reports 404 here.
// ---------------------------------------------------------------------------

route("GET", "/reports/:slug", async (request, env, params) => {
  const row = await env.DB.prepare(
    `SELECT id, slug, title, markdown, category, tags, created_at, updated_at
       FROM reports
      WHERE slug = ? AND status = 'published'`
  )
    .bind(params.slug)
    .first();

  if (!row) return htmlResponse(notFoundPage(), { status: 404 });

  const html = renderMarkdown(row.markdown);
  const origin = new URL(request.url).origin;
  const canUrl = `${origin}/reports/${encodeURIComponent(row.slug)}`;
  const excerpt = escapeHtml(markdownExcerpt(row.markdown));

  const head = `<meta property="og:title" content="${escapeHtml(row.title)}">
<meta property="og:type" content="article">
<meta property="og:url" content="${escapeHtml(canUrl)}">
<meta property="og:description" content="${excerpt}">
<meta name="description" content="${excerpt}">`;

  const tags = (row.tags || "")
    .split(",")
    .filter(Boolean)
    .map((t) => `<span class="chip">${escapeHtml(t)}</span>`)
    .join(" ");

  const body = `<article class="markdown-body" dir="rtl">
  <div class="report-toolbar">
    <nav class="crumbs"><a href="/">بازگشت به فهرست گزارش‌ها</a></nav>
    <button type="button" id="print-report" class="btn btn-ghost btn-small" aria-label="چاپ یا ذخیره به‌صورت PDF">چاپ / PDF</button>
  </div>
  <h1>${escapeHtml(row.title)}</h1>
  <div class="report-meta report-head-meta">
    <span>${escapeHtml(jalaliDate(row.created_at))}</span>
    ${row.category ? `<a class="chip" href="/?category=${encodeURIComponent(row.category)}">${escapeHtml(row.category)}</a>` : ""}
    ${tags}
  </div>
  ${html}
</article>
<script src="/static/js/report.js" defer></script>`;

  return htmlResponse(layout({ title: `${row.title} — گزارش‌کار`, body, head }));
});
