// Persian display helpers: Jalali dates and Persian digits via Intl only.
// No date libraries. D1 stores UTC ISO strings; conversion happens at render.

const jalaliFormatter = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const numberFormatter = new Intl.NumberFormat("fa-IR");

/** "2026-10-19T08:30:00Z" -> "۲۸ مهر ۱۴۰۵" */
export function jalaliDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return jalaliFormatter.format(d);
}

/** Numbers with Persian digits. */
export function faNum(value) {
  return numberFormatter.format(value);
}

/** Bytes -> "۱٫۲ مگابایت" */
export function faBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${faNum(n)} بایت`;
  if (n < 1024 * 1024) {
    return `${faNum(Number((n / 1024).toFixed(1)))} کیلوبایت`;
  }
  return `${faNum(Number((n / (1024 * 1024)).toFixed(1)))} مگابایت`;
}
