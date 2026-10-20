// Shared HTML building blocks: layout shell, escaping, and secure responses.
// UI text is Persian; code/comments stay English. No inline scripts or styles.

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https: http:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
};

export function htmlResponse(body, { status = 200 } = {}) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...SECURITY_HEADERS },
  });
}

export function json(data, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

export function redirect(location) {
  return new Response(null, { status: 302, headers: { Location: location } });
}

/**
 * Full document shell. `<html lang="fa" dir="rtl">`; all layout is CSS logical
 * properties (see public/static/css/base.css).
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} opts.body
 * @param {string} [opts.head] extra raw <head> tags (og meta, etc.)
 * @param {"public"|"admin"} [opts.nav] public shows the login link, admin
 *   shows dashboard link + logout button (wired by /static/js/admin.js)
 */
export function layout({ title, body, head = "", nav = "public" }) {
  const navItems =
    nav === "admin"
      ? `<a href="/">خانه</a>
      <a href="/admin">پیشخوان</a>
      <button type="button" id="theme-toggle" class="nav-btn" aria-label="تغییر پوسته">روشن</button>
      <button type="button" id="logout-btn" class="nav-btn">خروج</button>`
      : `<a href="/">خانه</a>
      <button type="button" id="theme-toggle" class="nav-btn" aria-label="تغییر پوسته">روشن</button>`;
  // Admin pages always get the shared admin.js (logout button + dashboard
  // delete buttons). Pages with extra scripts append those themselves.
  const adminScript =
    nav === "admin" ? `\n<script src="/static/js/admin.js" defer></script>` : "";
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0b1215">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/static/css/base.css">
<script src="/static/js/theme.js"></script>
${head}
</head>
<body>
<header class="site-header">
  <div class="container header-row">
    <a class="brand" href="/">گزارش‌کار</a>
    <span class="brand-sub">مخزن گزارش‌های آزمایشگاه</span>
    <nav class="site-nav">${navItems}</nav>
  </div>
</header>
<main class="container">${body}</main>
<footer class="site-footer">
  <div class="container">گزارش‌کار — فضای انتشار گزارش‌های آزمایشگاهی</div>
</footer>${adminScript}
</body>
</html>`;
}

export function notFoundPage() {
  return layout({
    title: "صفحه پیدا نشد — گزارش‌کار",
    body: `<div class="card empty-state">
  <h1>۴۰۴ — صفحه پیدا نشد</h1>
  <p class="muted">نشانی واردشده در این وب‌سایت وجود ندارد.</p>
  <p><a class="btn btn-primary" href="/">بازگشت به خانه</a></p>
</div>`,
  });
}
