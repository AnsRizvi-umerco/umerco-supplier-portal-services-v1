const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function parseAllowedOrigins(): string[] {
  const raw = process.env.CORS_ORIGIN?.trim();
  if (!raw) return [];
  return raw.split(",").map((o) => o.trim()).filter(Boolean);
}

export function isCorsOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  const allowed = parseAllowedOrigins();
  if (allowed.includes(origin)) return true;
  if (process.env.NODE_ENV !== "production" && LOCALHOST_ORIGIN.test(origin)) {
    return true;
  }
  return false;
}

export function corsOrigin(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void
) {
  callback(null, isCorsOriginAllowed(origin));
}
