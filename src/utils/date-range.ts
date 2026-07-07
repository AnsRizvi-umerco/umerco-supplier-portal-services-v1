const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export type DateRangeValue = "24h" | "7d" | "30d" | "12m" | "all" | "custom";

export type ParsedDateRange = {
  range: DateRangeValue;
  from: Date | null;
  to: Date | null;
};

export function toIsoDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function resolveDateRangeBounds(
  range: DateRangeValue,
  fromRaw: string | null,
  toRaw: string | null,
  now = new Date()
): { from: Date | null; to: Date | null } {
  if (range === "all") return { from: null, to: null };

  if (range === "custom") {
    const from = fromRaw ? new Date(`${fromRaw}T00:00:00.000Z`) : null;
    const to = toRaw ? new Date(`${toRaw}T23:59:59.999Z`) : null;
    return {
      from: from && !Number.isNaN(from.getTime()) ? from : null,
      to: to && !Number.isNaN(to.getTime()) ? to : null
    };
  }

  const to = now;
  let from = new Date(now.getTime() - 30 * ONE_DAY_MS);
  if (range === "24h") from = new Date(now.getTime() - ONE_DAY_MS);
  if (range === "7d") from = new Date(now.getTime() - 7 * ONE_DAY_MS);
  if (range === "12m") from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  return { from, to };
}

const VALID_RANGES = new Set<string>(["24h", "7d", "30d", "12m", "all", "custom"]);

export function parseDateRange(
  searchParams: URLSearchParams,
  defaultRange: DateRangeValue = "all"
): ParsedDateRange {
  const raw = (searchParams.get("range") || defaultRange).toLowerCase();
  const range = (VALID_RANGES.has(raw) ? raw : defaultRange) as DateRangeValue;
  const { from, to } = resolveDateRangeBounds(range, searchParams.get("from"), searchParams.get("to"));
  return { range, from, to };
}
