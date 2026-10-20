// End-to-end smoke test against a running `wrangler dev` server.
// Usage: npm run smoke   (expects BASE_URL or http://localhost:8787)
//
// Covers: Persian pages, auth (failure/lockout is NOT included here to keep
// the dev DB clean — see unit tests), CSRF rejection, report lifecycle,
// preview, uploads, serving headers, trash/restore/permanent delete, cleanup.

const BASE = (process.env.BASE_URL || "http://localhost:8787").replace(/\/$/, "");

const DEV_PASSWORD = process.env.SMOKE_PASSWORD || "gk-dev-1234";

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Minimal JSON POST helper carrying session + CSRF headers. */
function api(method, path, cookie, body) {
  return fetch(BASE + path, {
    method,
    headers: {
      "content-type": "application/json",
      "x-requested-with": "fetch",
      origin: BASE,
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function jsonOf(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

async function login() {
  const res = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-requested-with": "fetch",
      origin: BASE,
    },
    body: JSON.stringify({ password: DEV_PASSWORD }),
  });
  const raw = res.headers.get("set-cookie") || "";
  const m = raw.match(/gk_session=([^;]+)/);
  return { res, cookie: m ? `gk_session=${m[1]}` : null };
}

// 1x1 transparent PNG
const PNG_BYTES = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0)
);

async function upload(cookie, form) {
  return fetch(BASE + "/api/assets", {
    method: "POST",
    headers: { "x-requested-with": "fetch", origin: BASE, ...(cookie ? { cookie } : {}) },
    body: form,
  });
}

console.log(`smoke: ${BASE}`);

// ---------------------------------------------------------------- home HTML
{
  const res = await fetch(BASE + "/");
  const text = await res.text();
  check("home 200 + dir=rtl", res.status === 200 && text.includes('dir="rtl"'));
  const homeCsp = res.headers.get("content-security-policy") || "";
  check(
    "home CSP: remote images allowed, scripts locked",
    homeCsp.includes("default-src 'none'") &&
      homeCsp.includes("img-src 'self' https: http:") &&
      homeCsp.includes("script-src 'self'")
  );
  check("home Persian content", text.includes("فهرست گزارش‌های آزمایش"));
}

// ------------------------------------------------------------------- login
{
  const bad = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-requested-with": "fetch", origin: BASE },
    body: JSON.stringify({ password: "wrong-password" }),
  });
  const body = await jsonOf(bad);
  check("wrong password 401 + Persian", bad.status === 401 && /رمز/.test(body.error || ""));

  const ok = await login();
  check("login sets gk_session cookie", Boolean(ok.cookie));

  var COOKIE = ok.cookie;
}

// CSRF / auth rejections
{
  const noCsrf = await fetch(BASE + "/api/reports", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: COOKIE, origin: BASE },
    body: JSON.stringify({ title: "x", markdown: "x" }),
  });
  check("missing CSRF header -> 403", noCsrf.status === 403);

  const badOrigin = await fetch(BASE + "/api/reports", {
    method: "POST",
    headers: { "content-type": "application/json", "x-requested-with": "fetch", origin: "https://evil.example" },
    body: JSON.stringify({ title: "x", markdown: "x" }),
  });
  check("foreign Origin -> 403", badOrigin.status === 403);

  const unauth = await fetch(BASE + "/api/assets", {
    method: "POST",
    headers: { "x-requested-with": "fetch", origin: BASE },
    body: new FormData(),
  });
  check("unauthenticated asset upload -> 401", unauth.status === 401);
}

// ------------------------------------------------------------ report CRUD
let REPORT_ID;
let SLUG;
{
  const created = await api("POST", "/api/reports", COOKIE, {
    title: "گزارش آزمایش دود",
    markdown: "# آزمایش دود\n\nمورد اول مقدمه است.",
    category: "شیمی",
    tags: "دود,آزمایش",
  });
  const createBody = await jsonOf(created);
  REPORT_ID = createBody.id;
  SLUG = createBody.slug;
  check(
    "create report -> 201 + id/slug",
    created.status === 201 && REPORT_ID &&     /^[abcdefghjkmnpqrstuvwxyz23456789]{12}$/.test(SLUG || ""),
    JSON.stringify({ status: created.status, body: createBody })
  );

  const pub404 = await fetch(`${BASE}/reports/${SLUG}`);
  check("draft report 404 publicly", pub404.status === 404);

  const preview = await api("POST", "/api/preview", COOKIE, { markdown: "# سلام\n\n<div>تزریق</div>" });
  const pv = await jsonOf(preview);
  check("preview renders + escapes raw HTML", preview.status === 200 && pv.html.includes("<h1>") && pv.html.includes("&lt;div&gt;"));
}

// ------------------------------------------------------------- image upload
let IMG_URL;
{
  const form = new FormData();
  form.append("kind", "image");
  form.append("file", new Blob([PNG_BYTES], { type: "image/png" }), "smoke.png");
  const up = await upload(COOKIE, form);
  const body = await jsonOf(up);
  IMG_URL = body.url;
  check("png upload -> 201 + /images/ url", up.status === 201 && /^\/images\//.test(IMG_URL || ""));

  const serve = await fetch(BASE + IMG_URL);
  check(
    "image serve headers",
    serve.status === 200 &&
      (serve.headers.get("content-type") || "").startsWith("image/png") &&
      !(serve.headers.get("content-disposition") || "").includes("attachment")
  );

  const evil = new FormData();
  evil.append("kind", "image");
  evil.append("file", new Blob([PNG_BYTES], { type: "image/png" }), "smoke.exe.png");
  const up2 = await upload(COOKIE, evil);
  check("double-extension exe disguise -> 201 png", up2.status === 201); // .png extension kept

  const exe = new FormData();
  exe.append("kind", "file");
  exe.append("file", new Blob([PNG_BYTES], { type: "application/octet-stream" }), "virus.exe");
  const up3 = await upload(COOKIE, exe);
  const exeBody = await jsonOf(up3);
  check(".exe accepted as a downloadable file", up3.status === 201 && /^\/files\//.test(exeBody.url || ""));
  if (exeBody.id) {
    const exeServe = await fetch(BASE + exeBody.url);
    check(
      ".exe served as octet-stream attachment + nosniff",
      exeServe.status === 200 &&
        exeServe.headers.get("content-type") === "application/octet-stream" &&
        (exeServe.headers.get("content-disposition") || "").includes("attachment") &&
        exeServe.headers.get("x-content-type-options") === "nosniff"
    );
    await api("DELETE", "/api/assets/" + exeBody.id, COOKIE, undefined);
  }

  const big = new FormData();
  big.append("kind", "image");
  big.append("file", new Blob([new Uint8Array(11 * 1024 * 1024)], { type: "image/png" }), "big.png");
  const up4 = await upload(COOKIE, big);
  check(">10MB image rejected", up4.status === 400);
}

// ------------------------------------------------------------- file upload
let FILE_URL;
{
  const form = new FormData();
  form.append("kind", "file");
  form.append("file", new Blob(["madar-data\n"], { type: "text/plain" }), "natayej.txt");
  const up = await upload(COOKIE, form);
  const body = await jsonOf(up);
  FILE_URL = body.url;
  check("file upload -> 201 + /files/ url", up.status === 201 && /^\/files\//.test(FILE_URL || ""));

  const serve = await fetch(BASE + FILE_URL);
  check(
    "file serve attachment",
    serve.status === 200 && (serve.headers.get("content-disposition") || "").includes("attachment")
  );

  // Extensionless upload (previously rejected by the allowlist).
  const noext = new FormData();
  noext.append("kind", "file");
  noext.append("file", new Blob(["all:\n"], { type: "text/plain" }), "Makefile");
  const noextUp = await upload(COOKIE, noext);
  const noextBody = await jsonOf(noextUp);
  check(
    "extensionless file accepted",
    noextUp.status === 201 && /^\/files\//.test(noextBody.url || "")
  );
  if (noextBody.id) {
    const noextServe = await fetch(BASE + noextBody.url);
    check(
      "extensionless file serves as attachment",
      noextServe.status === 200 &&
        (noextServe.headers.get("content-disposition") || "").includes("attachment") &&
        noextServe.headers.get("content-type") === "application/octet-stream"
    );
    await api("DELETE", "/api/assets/" + noextBody.id, COOKIE, undefined);
  }

  // An uploaded HTML file must never be served as HTML.
  const htmlForm = new FormData();
  htmlForm.append("kind", "file");
  htmlForm.append("file", new Blob(["<script>alert(1)</script>"], { type: "text/html" }), "evil.html");
  const htmlUp = await upload(COOKIE, htmlForm);
  const htmlBody = await jsonOf(htmlUp);
  check(
    "html upload stored as generic download",
    htmlUp.status === 201 && htmlBody.content_type === "application/octet-stream"
  );
  if (htmlBody.id) {
    const htmlServe = await fetch(BASE + htmlBody.url);
    check(
      "html download headers are inert",
      htmlServe.status === 200 &&
        htmlServe.headers.get("content-type") === "application/octet-stream" &&
        (htmlServe.headers.get("content-disposition") || "").includes("attachment") &&
        htmlServe.headers.get("x-content-type-options") === "nosniff"
    );
    await api("DELETE", "/api/assets/" + htmlBody.id, COOKIE, undefined);
  }
}

// ---------------------------------------- publish + public page + edit path
{
  const save = await api("PUT", `/api/reports/${REPORT_ID}`, COOKIE, {
    title: "گزارش آزمایش دود",
    markdown: `# آزمایش دود\n\n![شکل](${IMG_URL})\n\n[فایل نتایج](${FILE_URL})\n\n\`\`\`c\nprintf("x");\n\`\`\`\n`,
    category: "شیمی",
    tags: "دود,آزمایش",
  });
  check("save markdown referencing assets -> 200", save.status === 200);

  const pub = await api("POST", `/api/reports/${REPORT_ID}/publish`, COOKIE, undefined);
  check("publish -> 200", pub.status === 200);

  const page = await fetch(`${BASE}/reports/${SLUG}`);
  const html = await page.text();
  check(
    "public page: image ref + code + attachment link",
    page.status === 200 && html.includes(IMG_URL) && html.includes(FILE_URL) && html.includes("code-block")
  );
  check("public page og meta", html.includes("og:title"));
  check(
    "public page: print/PDF button + highlighted code",
    html.includes('id="print-report"') &&
      html.includes('class="hljs language-c"') &&
      html.includes('<span class="hljs-')
  );
  const printCss = await (await fetch(BASE + "/static/css/base.css")).text();
  check(
    "print stylesheet: A4 @page + print media",
    printCss.includes("@page") && printCss.includes("size: A4") && printCss.includes("@media print")
  );

  const edited = await api("PUT", `/api/reports/${REPORT_ID}`, COOKIE, {
    title: "گزارش آزمایش دود (نسخه دوم)",
    // references intentionally kept: assets must survive until permanent delete
    markdown: `# آزمایش دود\n\n![شکل](${IMG_URL})\n\n[فایل نتایج](${FILE_URL})\n\nمتن ویرایش‌شده.`,
    category: "شیمی",
    tags: "دود",
  });
  const editedBody = await jsonOf(edited);
  const afterEdit = await jsonOf(await api("GET", `/api/reports/${REPORT_ID}`, COOKIE, undefined));
  check(
    "edit keeps slug -> 200",
    edited.status === 200 && editedBody.ok && afterEdit.report?.slug === SLUG,
    JSON.stringify({ status: edited.status, slugNow: afterEdit.report?.slug })
  );

  const page2 = await fetch(`${BASE}/reports/${SLUG}`);
  const html2 = await page2.text();
  check("public page shows edited title", html2.includes("نسخه دوم"));

  // search + filter
  const found = await fetch(`${BASE}/?q=${encodeURIComponent("دود")}`);
  check("home search finds report", found.status === 200 && (await found.text()).includes(SLUG));

  // unpublish/unpublish cycle
  await api("POST", `/api/reports/${REPORT_ID}/unpublish`, COOKIE, undefined);
  check("unpublished -> public 404", (await fetch(`${BASE}/reports/${SLUG}`)).status === 404);
  await api("POST", `/api/reports/${REPORT_ID}/publish`, COOKIE, undefined);
}

// --------------------------------------------------- trash / permanent card
{
  // permanent while published -> 409 (must trash first)
  const early = await api("DELETE", `/api/reports/${REPORT_ID}/permanent`, COOKIE, undefined);
  check("permanent while published -> 409", early.status === 409);

  const del = await api("DELETE", `/api/reports/${REPORT_ID}`, COOKIE, undefined);
  check("soft delete -> 200", del.status === 200);
  check("trashed -> public 404", (await fetch(`${BASE}/reports/${SLUG}`)).status === 404);

  const restored = await api("POST", `/api/reports/${REPORT_ID}/restore`, COOKIE, undefined);
  check("restore -> 200 draft", restored.status === 200);
  check("restored-draft -> public 404", (await fetch(`${BASE}/reports/${SLUG}`)).status === 404);

  await api("POST", `/api/reports/${REPORT_ID}/publish`, COOKIE, undefined);
  await api("DELETE", `/api/reports/${REPORT_ID}`, COOKIE, undefined);

  const perm = await api("DELETE", `/api/reports/${REPORT_ID}/permanent`, COOKIE, undefined);
  check("permanent delete after trash -> 200", perm.status === 200);

  // Reporting + assets are gone: further lifecycle calls must 404, not fake ok.
  const restore2 = await api("POST", `/api/reports/${REPORT_ID}/restore`, COOKIE, undefined);
  check("restore after permanent -> 404", restore2.status === 404);
  const status2 = await api("POST", `/api/reports/${REPORT_ID}/publish`, COOKIE, undefined);
  check("publish after permanent -> 404", status2.status === 404);

  // The referenced image/file bytes were purged with the report.
  const imgGone = await fetch(BASE + IMG_URL);
  check("purged image 404 (reference removed)", imgGone.status === 404);

  const fileGone = await fetch(BASE + FILE_URL);
  check("purged file 404", fileGone.status === 404);
}

// ------------------------------------------------------------ admin pages
{
  const dash = await fetch(BASE + "/admin", { headers: { cookie: COOKIE } });
  const dashHtml = await dash.text();
  check("dashboard 200 + RTL", dash.status === 200 && dashHtml.includes('<html lang="fa" dir="rtl"'));
  check("dashboard loads admin.js (delete/logout handlers)", dashHtml.includes("/static/js/admin.js"));

  const assetsPage = await fetch(BASE + "/admin/assets", { headers: { cookie: COOKIE } });
  check("asset library 200", assetsPage.status === 200);

  const trashPage = await fetch(BASE + "/admin/trash", { headers: { cookie: COOKIE } });
  check("trash page 200", trashPage.status === 200);

  const unauthed = await fetch(BASE + "/admin", { redirect: "manual" });
  check("/admin redirects to /login when unauth", [301, 302].includes(unauthed.status) && (unauthed.headers.get("location") || "").startsWith("/login"));
}

// --------------------------------------------------------------- cleanup
{
  const res = await api("POST", "/api/cleanup", COOKIE, undefined);
  check("cleanup sweep -> 200", res.status === 200);
}

// ----------------------------------------------------------- logout + after
{
  const out = await fetch(BASE + "/api/auth/logout", {
    method: "POST",
    headers: { "x-requested-with": "fetch", origin: BASE, cookie: COOKIE },
  });
  check("logout -> 200 clears cookie", out.status === 200 && /Max-Age=0/.test(out.headers.get("set-cookie") || ""));

  // Sessions are stateless (signed HMAC cookie, approved design): the server
  // cannot revoke a copied cookie on logout; rotation of SESSION_SECRET is the
  // documented revocation mechanism. Login must work again after logout.
  const again = await login();
  check("login again after logout -> 200", again.res.status === 200 && Boolean(again.cookie));
}

console.log(`\nsmoke: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
