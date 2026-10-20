// Shared Markdown pipeline — the SINGLE renderer used by the public report
// pages, the admin preview endpoint (/api/preview), and asset-reference
// scanning. Security model:
//   - html: false  => raw HTML in markdown is escaped, never executed
//   - validateLink => only http:, https:, mailto:, same-site "/..." paths and
//     in-page "#..." anchors are allowed; javascript:, data:, vbscript:,
//     file:, //host, and scheme-less relative URLs are rejected
//   - content stays server-controlled; responses carry a strict CSP as backstop

import MarkdownIt from "markdown-it";
import hljs from "highlight.js/lib/core";
import langC from "highlight.js/lib/languages/c";
import langCpp from "highlight.js/lib/languages/cpp";
import langArduino from "highlight.js/lib/languages/arduino";
import langPython from "highlight.js/lib/languages/python";
import langBash from "highlight.js/lib/languages/bash";
import langShell from "highlight.js/lib/languages/shell";
import langVerilog from "highlight.js/lib/languages/verilog";
import langVhdl from "highlight.js/lib/languages/vhdl";
import langMatlab from "highlight.js/lib/languages/matlab";
import langJson from "highlight.js/lib/languages/json";
import langJavascript from "highlight.js/lib/languages/javascript";
import langSql from "highlight.js/lib/languages/sql";
import langMakefile from "highlight.js/lib/languages/makefile";
import langDiff from "highlight.js/lib/languages/diff";
import langYaml from "highlight.js/lib/languages/yaml";
import langXml from "highlight.js/lib/languages/xml";
import langPlaintext from "highlight.js/lib/languages/plaintext";

// Only the languages used by lab reports are bundled; everything else stays
// plain text. Grammars are class-based (no inline styles), so the strict CSP
// is unchanged and themes live in CSS.
for (const [name, grammar] of [
  ["c", langC],
  ["cpp", langCpp],
  ["arduino", langArduino],
  ["python", langPython],
  ["bash", langBash],
  ["shell", langShell],
  ["verilog", langVerilog],
  ["vhdl", langVhdl],
  ["matlab", langMatlab],
  ["json", langJson],
  ["javascript", langJavascript],
  ["sql", langSql],
  ["makefile", langMakefile],
  ["diff", langDiff],
  ["yaml", langYaml],
  ["xml", langXml],
  ["plaintext", langPlaintext],
]) {
  hljs.registerLanguage(name, grammar);
}

/**
 * Highlight a fenced code block. Returns HTML that is safe to inject: the
 * highlighter escapes text, and unknown languages fall back to plain escaping.
 * @param {string} content
 * @param {string} language already sanitized (empty = no language)
 * @returns {string}
 */
function highlightCode(content, language) {
  if (!language) return md.utils.escapeHtml(content);
  try {
    if (!hljs.getLanguage(language)) return md.utils.escapeHtml(content);
    return hljs.highlight(content, {
      language,
      ignoreIllegals: true,
    }).value;
  } catch {
    return md.utils.escapeHtml(content);
  }
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * Replacement for markdown-it's default validateLink.
 * @param {string} url
 * @returns {boolean}
 */
export function isAllowedUrl(url) {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  if (trimmed === "") return false;

  // Same-site relative URL: leading single slash, no "//" and no backslashes.
  if (/^\/(?!\/)[^\\]*$/.test(trimmed)) return true;

  // In-page anchor.
  if (/^#[^\s]*$/.test(trimmed)) return true;

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  return ALLOWED_PROTOCOLS.has(parsed.protocol);
}

function makeRenderer() {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: false,
  });
  md.validateLink = isAllowedUrl;

  // --- fenced and indented code blocks: LTR <figure> with language + copy hook
  const renderCode = (content, lang) => {
    const highlighted = highlightCode(content, lang);
    const safeLang = md.utils.escapeHtml(lang);
    const langLabel = lang
      ? `<span class="code-lang">${safeLang}</span>`
      : `<span class="code-lang" dir="rtl">کد</span>`;
    return (
      `<figure class="code-block" dir="ltr">\n` +
      `<figcaption class="code-block-head">${langLabel}` +
      `<button type="button" class="copy-code-btn" data-copy-code="1">کپی</button>` +
      `</figcaption>\n` +
      `<pre><code class="hljs language-${lang || "text"}">${highlighted}</code></pre>\n` +
      `</figure>\n`
    );
  };

  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const info = token.info.trim().split(/\s+/)[0] || "";
    // Info strings are user input: only plain language identifiers reach the
    // class attribute / highlighter.
    const lang = /^[A-Za-z0-9#+._-]{1,32}$/.test(info) ? info : "";
    return renderCode(token.content, lang);
  };
  md.renderer.rules.code_block = (tokens, idx) =>
    renderCode(tokens[idx].content, "");

  // --- images: responsive, lazy-loaded, LTR-isolated src
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const src = token.attrGet("src") || "";
    const alt = md.utils.escapeHtml(
      self.renderInlineAsText(token.children || [], options, env)
    );
    return (
      `<img src="${md.utils.escapeHtml(src)}" alt="${alt}" ` +
      `class="report-img" loading="lazy" referrerpolicy="no-referrer" dir="ltr">`
    );
  };

  // --- inline code: LTR-isolated
  md.renderer.rules.code_inline = (tokens, idx) => {
    const token = tokens[idx];
    return `<code dir="ltr">${md.utils.escapeHtml(token.content)}</code>`;
  };

  // --- tables: wrapped in a horizontal-scroll container (RTL table headings)
  md.renderer.rules.table_open = () => `<div class="table-wrap"><table>`;
  md.renderer.rules.table_close = () => `</table></div>`;

  // External links: add rel attributes (renderer is the only place links exist).
  const defaultLinkOpen =
    md.renderer.rules.link_open ||
    ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const href = tokens[idx].attrGet("href") || "";
    const proto = (() => {
      try {
        return new URL(href).protocol;
      } catch {
        return null; // relative URL
      }
    })();
    if (proto === "http:" || proto === "https:") {
      tokens[idx].attrSet("target", "_blank");
      tokens[idx].attrSet("rel", "noopener noreferrer");
      tokens[idx].attrSet("dir", "ltr");
    } else {
      tokens[idx].attrSet("dir", "ltr");
    }
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  return md;
}

const md = makeRenderer();

/**
 * @param {string} markdown
 * @returns {string} rendered HTML fragment (safe to inject server-side)
 */
export function renderMarkdown(markdown) {
  return md.render(String(markdown ?? ""));
}

/**
 * Collect IDs of this site's asset URLs referenced in markdown
 * (`/images/<id>...` or `/files/<id>/...`).
 * @param {string} markdown
 * @returns {string[]} unique UUIDs, insertion order preserved
 */
export function extractReportAssetRefs(markdown) {
  const re = /\]\(\s*\/(?:images|files)\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/g;
  const ids = new Set();
  for (const m of String(markdown ?? "").matchAll(re)) {
    ids.add(m[1].toLowerCase());
  }
  return [...ids];
}

/**
 * Short plain-text excerpt for link previews / og:description.
 * @param {string} markdown
 * @param {number} [maxLength=160]
 * @returns {string}
 */
export function markdownExcerpt(markdown, maxLength = 160) {
  const plain = String(markdown ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_>#~[\]()!-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > maxLength ? plain.slice(0, maxLength - 1).trimEnd() + "…" : plain;
}
