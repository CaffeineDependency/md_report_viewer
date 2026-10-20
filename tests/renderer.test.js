// Unit tests for the Markdown renderer: URL validation, asset-reference
// scanning, and security-critical rendering behavior.
// Run with: node --test tests/

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isAllowedUrl,
  extractReportAssetRefs,
  renderMarkdown,
  markdownExcerpt,
} from "../src/lib/renderer.js";

// ---------------------------------------------------------------- URLs

test("URL validation allows http/https/mailto", () => {
  assert.equal(isAllowedUrl("https://example.com/a"), true);
  assert.equal(isAllowedUrl("http://example.com"), true);
  assert.equal(isAllowedUrl("mailto:me@example.com"), true);
  assert.equal(isAllowedUrl("HTTPS://EXAMPLE.COM"), true);
});

test("URL validation allows same-site relative paths and anchors", () => {
  assert.equal(isAllowedUrl("/images/abc.png"), true);
  assert.equal(isAllowedUrl("/files/9a2f40f0-1e2d-4c3b-8a90-123456789abc/report.pdf"), true);
  assert.equal(isAllowedUrl("#section"), true);
});

test("URL validation rejects dangerous schemes", () => {
  assert.equal(isAllowedUrl("javascript:alert(1)"), false);
  assert.equal(isAllowedUrl("JaVaScRiPt:alert(1)"), false);
  assert.equal(isAllowedUrl("vbscript:msgbox(1)"), false);
  assert.equal(isAllowedUrl("data:text/html,<script>alert(1)</script>"), false);
  assert.equal(isAllowedUrl("file:///etc/passwd"), false);
  assert.equal(isAllowedUrl("ftp://example.com/file"), false);
});

test("URL validation rejects protocol-relative and malformed inputs", () => {
  assert.equal(isAllowedUrl("//evil.com/x"), false);
  assert.equal(isAllowedUrl("/\\evil.com"), false);
  assert.equal(isAllowedUrl("foo/bar"), false);
  assert.equal(isAllowedUrl(""), false);
  assert.equal(isAllowedUrl(null), false);
});

// ------------------------------------------------------- asset ref scanning

const U1 = "11111111-2222-4333-8444-555555555555";
const U2 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

test("extractReportAssetRefs finds image and file references", () => {
  const mdText = [
    "![شماتیک](/images/" + U1 + ".png)",
    "[دانلود](/files/" + U2 + "/report.pdf)",
  ].join("\n");
  const refs = extractReportAssetRefs(mdText);
  assert.deepEqual(refs, [U1, U2]);
});

test("extractReportAssetRefs deduplicates and ignores foreign URLs", () => {
  const mdText = [
    "![a](/images/" + U1 + "/x.png)",
    "![b](/images/" + U1 + "/y.png)",
    "![external](https://example.com/images/" + U2 + "/z.png)",
  ].join("\n");
  assert.deepEqual(extractReportAssetRefs(mdText), [U1]);
});

// ---------------------------------------------------------------- rendering

test("raw HTML is escaped with html:false", () => {
  const out = renderMarkdown("سلام <script>alert(1)</script> و <b>متن</b>");
  assert.equal(out.includes("<script>"), false);
  assert.equal(out.includes("&lt;script&gt;"), true);
});

test("clickable javascript link is dropped to plain text", () => {
  const out = renderMarkdown("[کلیک](javascript:alert(1))");
  assert.equal(out.includes("<a "), false);
  assert.equal(out.includes('href="javascript'), false);
});

test("image with data: URL is not rendered as an element", () => {
  const out = renderMarkdown("![t](data:image/png;base64,iVBOR)");
  assert.equal(out.includes("<img"), false);
});

test("fenced code block becomes LTR figure with escaped content", () => {
  const out = renderMarkdown("```c\n#include <stdio.h>\n```");
  assert.equal(out.includes("<figure class=\"code-block\" dir=\"ltr\">"), true);
  assert.equal(out.includes("&lt;stdio.h&gt;"), true);
  assert.equal(out.includes('class="language-c"'), true);
});

test("indented code block also wrapped in code-block figure", () => {
  const out = renderMarkdown("    int x = 0;\n");
  assert.equal(out.includes('class="code-block"'), true);
});

test("tables are wrapped in a scroll container and escape HTML cells", () => {
  const out = renderMarkdown("| الف | ب |\n| --- | --- |\n| <i>x</i> | ۲ |");
  assert.equal(out.includes('class="table-wrap"'), true);
  assert.equal(out.includes("<i>"), false);
});

test("external https links get noopener and LTR direction", () => {
  const out = renderMarkdown("[سایت](https://example.com)");
  assert.equal(out.includes('rel="noopener noreferrer"'), true);
  assert.equal(out.includes('target="_blank"'), true);
});

test("onerror injection via image title never becomes an attribute", () => {
  const out = renderMarkdown('![a](https://x/y.png "onerror=alert(1)")');
  // Our custom image renderer only emits src/alt/class/loading/dir; markdown
  // title text must not surface as an attribute anywhere.
  assert.equal(out.includes(" onerror="), false);
  assert.equal(out.includes("alert(1)"), false);
});

// ---------------------------------------------------------------- excerpt

test("markdownExcerpt strips markdown noise", () => {
  const out = markdownExcerpt("# عنوان\n\n**سلام** این آزمایش است.\n\n```js\ncode()\n```", 40);
  assert.equal(out.includes("#"), false);
  assert.equal(out.includes("code()"), false);
  assert.equal(out.includes("سلام"), true);
});
