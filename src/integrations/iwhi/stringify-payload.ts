/**
 * Recursively stringify number and boolean leaves so IWHI JSON bodies use string scalars.
 * Strings, arrays, and plain objects are preserved structurally; null is left as null.
 */
export function stringifyPayloadDeep(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(stringifyPayloadDeep);
  if (typeof value === "object" && value !== null) {
    const o = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(o)) {
      out[key] = stringifyPayloadDeep(o[key]);
    }
    return out;
  }
  return value;
}
