// Asset validation helpers: magic-byte image sniffing, file-extension
// allowlist, filename sanitizing, and safe download headers.
//
// Security rules (enforced SERVER-side; client checks are only UX):
//   - Images are identified by magic bytes only; browser MIME/extension are
//     never trusted. SVG is rejected in v1 (script execution risk).
//   - Downloadable files are allowlisted by extension; anything unlisted is
//     rejected. Uploaded files are NEVER served as HTML and always get
//     Content-Disposition: attachment + X-Content-Type-Options: nosniff.
//   - R2 object keys are always generated server-side from random UUIDs.

export class AssetError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "AssetError";
    this.statusCode = statusCode;
  }
}

// ------------------------------------------------------------- image sniff

const IMAGE_SIGNATURES = [
  { bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], contentType: "image/png", ext: "png" },
  { bytes: [0xff, 0xd8, 0xff], contentType: "image/jpeg", ext: "jpg" },
  { bytes: [0x47, 0x49, 0x46, 0x38], contentType: "image/gif", ext: "gif" }, // GIF87a/89a
];

/**
 * Detect raster image type from leading bytes.
 * @param {Uint8Array} bytes
 * @returns {{contentType: string, ext: string}|null}
 */
export function sniffImage(bytes) {
  if (!bytes || bytes.length < 12) return null;
  for (const sig of IMAGE_SIGNATURES) {
    if (sig.bytes.every((b, i) => bytes[i] === b)) {
      return { contentType: sig.contentType, ext: sig.ext };
    }
  }
  // WebP: "RIFF" at offset 0, "WEBP" at offset 8
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return { contentType: "image/webp", ext: "webp" };
  }
  return null;
}

// ------------------------------------------------------------ file types

// Any file extension (or none) is accepted. The content type is still
// chosen safely below: known text/code extensions are served as text/plain,
// everything else as application/octet-stream — never HTML.

/** Safe content type for serving; never HTML-like. */
export function fileContentType(ext) {
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "zip":
      return "application/zip";
    case "txt":
    case "md":
    case "csv":
    case "json":
    case "c":
    case "h":
    case "cpp":
    case "cc":
    case "cxx":
    case "hpp":
    case "py":
    case "sh":
    case "bash":
    case "asm":
    case "v":
    case "sv":
    case "vhd":
    case "vhdl":
    case "hex":
    case "cfg":
    case "ino":
    case "s":
    case "dsn":
    case "ops":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

/** ext for a filename (lowercase, no dot); "" when none present. */
export function filenameExt(name) {
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

// ------------------------------------------------------------- filenames

/**
 * Sanitize an uploaded filename for display and download headers.
 * Keeps unicode (Persian) names, strips path separators, control chars and
 * quote characters; caps length; never empty.
 * @param {string} name
 * @returns {string}
 */
export function sanitizeFilename(name) {
  let base = String(name || "").split(/[\\/\0]/).pop() || "";
  base = base
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/["'<>`$|;*?]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  if (base.length > 120) {
    const ext = filenameExt(base);
    base = base.slice(0, 120 - (ext ? ext.length + 1 : 0));
    if (ext) base += "." + ext;
  }
  return base || "file";
}

/**
 * RFC 5987 encoding for Content-Disposition filename*.
 * @param {string} name
 * @returns {string}
 */
export function encodeRFC5987(name) {
  return encodeURIComponent(name)
    .replace(/[*'()!]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/**
 * Full Content-Disposition header value.
 * @param {"attachment"|"inline"} type
 */
export function contentDisposition(type, name, fallbackExt = "") {
  const fallback = "download" + (fallbackExt ? "." + fallbackExt : "");
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeRFC5987(name)}`;
}

// ------------------------------------------------------------- keys / URLs

/** R2 object key for an image: images/<uuid>.<ext> */
export function imageKey(uuid, ext) {
  return `images/${uuid}.${ext}`;
}

/** R2 object key for a downloadable file: files/<uuid>/<name> */
export function fileKey(uuid, filename) {
  return `files/${uuid}/${filename}`;
}

/** Public URL for a stored image asset. */
export function imageUrl(id, contentType) {
  const ext = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" }[contentType] || "png";
  return `/images/${id}.${ext}`;
}

/** Public URL for a stored file asset. */
export function fileUrl(id, filename) {
  return `/files/${id}/${encodeURIComponent(filename)}`;
}
