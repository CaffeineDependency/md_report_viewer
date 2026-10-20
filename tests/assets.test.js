// Unit tests for asset validation helpers.
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  contentDisposition,
  fileContentType,
  filenameExt,
  fileUrl,
  imageKey,
  imageUrl,
  sanitizeFilename,
  sniffImage,
  encodeRFC5987,
} from "../src/lib/assets.js";

function bytes(arr) {
  return new Uint8Array(arr);
}

// ---------------------------------------------------------------- sniffing

test("magic bytes: PNG accepted", () => {
  const s = sniffImage(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
  assert.equal(s.contentType, "image/png");
  assert.equal(s.ext, "png");
});

test("magic bytes: JPEG accepted", () => {
  const s = sniffImage(bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]));
  assert.equal(s.contentType, "image/jpeg");
});

test("magic bytes: GIF87a and GIF89a accepted", () => {
  assert.equal(sniffImage(bytes([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0, 0, 0, 0, 0, 0])).contentType, "image/gif");
  assert.equal(sniffImage(bytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0])).contentType, "image/gif");
});

test("magic bytes: WebP (RIFF/WEBP) accepted", () => {
  const s = sniffImage(bytes([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]));
  assert.equal(s.contentType, "image/webp");
});

test("magic bytes: SVG content rejected (script risk)", () => {
  const s = sniffImage(new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
  assert.equal(s, null);
});

test("magic bytes: BMP/PNG-renamed/HTML rejected", () => {
  assert.equal(sniffImage(bytes([0x42, 0x4d, 0x36, 0x00, 0, 0, 0, 0, 0, 0, 0, 0])), null); // "BM..." BMP
  assert.equal(sniffImage(new TextEncoder().encode("<html><script>alert(1)</script>")), null);
  assert.equal(sniffImage(new Uint8Array(0)), null);
});

// ------------------------------------------------------------ extensions

test("file extension extraction is lowercase and tolerant", () => {
  assert.equal(filenameExt("REPORT.PDSprj"), "pdsprj");
  assert.equal(filenameExt("noext"), "");
  assert.equal(filenameExt("trail."), "");
});

test("content types: never HTML-like, code served as text", () => {
  assert.equal(fileContentType("pdf"), "application/pdf");
  assert.equal(fileContentType("zip"), "application/zip");
  assert.equal(fileContentType("c"), "text/plain; charset=utf-8");
  assert.equal(fileContentType("exe"), "application/octet-stream");
  assert.equal(fileContentType("html"), "application/octet-stream");
  assert.equal(fileContentType("pdsprj"), "application/octet-stream");
});

// ------------------------------------------------------------- filenames

test("sanitizer keeps only the safest basename, strips control chars and quotes", () => {
  assert.equal(sanitizeFilename("../../etc/passwd\u0000evil").includes("/"), false);
  assert.equal(sanitizeFilename("a../../b\\c"), "c"); // basename only
  assert.equal(sanitizeFilename('bad"quote<name>').includes('"'), false);
  assert.equal(sanitizeFilename(".."), "file");
  assert.equal(sanitizeFilename("   گزارش نهایی.PDF "), "گزارش نهایی.PDF");
});

test("sanitizer caps overly long names preserving extension", () => {
  const long = "x".repeat(200) + ".pdsprj";
  const out = sanitizeFilename(long);
  assert.equal(out.length, 120);
  assert.equal(filenameExt(out), "pdsprj");
});

// ----------------------------------------------------------- dispositions

test("RFC 5987 disposition encodes unicode and quotes safely", () => {
  const out = contentDisposition("attachment", "گزارش آزمایش.pdf", "pdf");
  assert.equal(out.startsWith("attachment; filename=\"download.pdf\";"), true);
  assert.equal(out.includes("گزارش"), false); // raw unicode not in header
  assert.equal(encodeRFC5987("a'b*c"), "a%27b%2Ac");
});

// ------------------------------------------------------------------- URLs

test("generated URLs match serving route patterns", () => {
  const id = "11111111-2222-4333-8444-555555555555";
  assert.equal(imageUrl(id, "image/png"), `/images/${id}.png`);
  assert.equal(imageUrl(id, "image/jpeg"), `/images/${id}.jpg`);
  assert.equal(imageKey(id, "webp"), `images/${id}.webp`);
  assert.equal(fileUrl(id, "project.pdsprj"), `/files/${id}/project.pdsprj`);
  assert.equal(fileUrl(id, "گزارش.pdf").startsWith(`/files/${id}/`), true);
});
