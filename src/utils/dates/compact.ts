/** True if `s` is eight digits and a real calendar date (YYYYMMDD). */
export function isYyyymmddValid(s: string): boolean {
  if (!/^\d{8}$/.test(s)) return false;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6));
  const d = Number(s.slice(6, 8));
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/**
 * Convert HTML date input value (YYYY-MM-DD) or existing YYYYMMDD to compact YYYYMMDD.
 * Returns "" for empty/whitespace input.
 */
export function toCompactYyyymmdd(value: string): string {
  const t = value.trim();
  if (!t) return "";
  if (/^\d{8}$/.test(t)) return t;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t.replace(/-/g, "");
  return t;
}

/** Local calendar today as YYYYMMDD (for defaulting date inputs via value=YYYY-MM-DD). */
export function todayLocalIsoDateInput(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
