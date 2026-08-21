import type { PortalAuthUser, SupplierRow } from "@/middleware/auth";
import { getOperationsPool } from "@/config/operations-db";
import { resolveDateRangeBounds, toIsoDate } from "@/utils/date-range";
import { resolveDataScope, scopePredicate, type DataScope } from "@/utils/data-scope";

type SubmissionRow = {
  doc_type: string | null;
  status: string | null;
  created_at: string | null;
  submitted_at: string | null;
  trading_partner: string | null;
};

type ScheduleRow = { received_at: string | null };

type TrendPoint = {
  bucketKey: string;
  label: string;
  inbound: number;
  outbound: number;
};

type DocMixPoint = { name: string; value: number };

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

type RangeValue = "24h" | "7d" | "30d" | "12m" | "all" | "custom";
type GroupByValue = "hour" | "day" | "month" | "year";

const EMPTY_KPIS = {
  inboundTransactionsMtd: 0,
  outboundTransactionsMtd: 0,
  activeTradingPartners: 0,
  errorsExceptions: 0,
  avgProcessingTimeMinutes: 0
};

function formatLabel(date: Date, groupBy: GroupByValue): string {
  if (groupBy === "hour") return `${String(date.getUTCHours()).padStart(2, "0")}:00`;
  if (groupBy === "day") {
    return date.toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  }
  if (groupBy === "month") {
    return date.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  }
  return String(date.getUTCFullYear());
}

function getBucketStart(date: Date, groupBy: GroupByValue): Date {
  if (groupBy === "hour") {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours()));
  }
  if (groupBy === "day") {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }
  if (groupBy === "month") {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  }
  return new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
}

function getBucketKey(date: Date, groupBy: GroupByValue): string {
  if (groupBy === "hour") {
    const h = String(date.getUTCHours()).padStart(2, "0");
    return `${toIsoDate(date)}T${h}`;
  }
  if (groupBy === "day") return toIsoDate(date);
  if (groupBy === "month") {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  return String(date.getUTCFullYear());
}

function addStep(date: Date, groupBy: GroupByValue): Date {
  if (groupBy === "hour") return new Date(date.getTime() + ONE_HOUR_MS);
  if (groupBy === "day") return new Date(date.getTime() + ONE_DAY_MS);
  if (groupBy === "month") return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return new Date(Date.UTC(date.getUTCFullYear() + 1, 0, 1));
}

function parseRange(searchParams: URLSearchParams) {
  const range = (searchParams.get("range") || "30d").toLowerCase() as RangeValue;
  const rawGroupBy = (searchParams.get("groupBy") || "").toLowerCase() as GroupByValue;
  const fromRaw = searchParams.get("from");
  const toRaw = searchParams.get("to");
  const now = new Date();

  let groupBy: GroupByValue = "day";
  if (range === "24h") groupBy = "hour";
  else if (range === "all") groupBy = rawGroupBy === "month" ? "month" : "year";
  else if (range === "12m") groupBy = rawGroupBy === "year" ? "year" : "month";
  else groupBy = rawGroupBy === "month" ? "month" : "day";

  if (range === "custom") {
    const { from, to } = resolveDateRangeBounds(range, fromRaw, toRaw, now);
    return { range, groupBy: rawGroupBy || "day", from, to };
  }

  const { from, to } = resolveDateRangeBounds(range, fromRaw, toRaw, now);
  return { range, groupBy, from, to };
}

function isWithin(date: Date, from: Date | null, to: Date | null): boolean {
  const t = date.getTime();
  if (from && t < from.getTime()) return false;
  if (to && t > to.getTime()) return false;
  return true;
}

function startOfCurrentUtcMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

function incrementTrendBucket(
  trendMap: Map<string, TrendPoint>,
  date: Date,
  groupBy: GroupByValue,
  field: "inbound" | "outbound"
) {
  const bucketStart = getBucketStart(date, groupBy);
  const key = getBucketKey(bucketStart, groupBy);
  const point = trendMap.get(key) || {
    bucketKey: key,
    label: formatLabel(bucketStart, groupBy),
    inbound: 0,
    outbound: 0
  };
  point[field] += 1;
  trendMap.set(key, point);
}

async function fetchSubmissions(
  scope: DataScope,
  from: Date | null,
  to: Date | null,
  range: RangeValue
): Promise<SubmissionRow[]> {
  const pool = getOperationsPool();
  const params: unknown[] = [scope.companyId, scope.supplierId];
  let dateFilter = "";

  if (range !== "all" && from && to) {
    params.push(from.toISOString(), to.toISOString());
    dateFilter = " AND created_at >= $3 AND created_at <= $4";
  }

  const { rows } = await pool.query<SubmissionRow>(
    `SELECT doc_type, status, created_at, submitted_at,
            canonical_json->>'tradingPartner' AS trading_partner
     FROM submissions
     WHERE ${scopePredicate(1, 2)}${dateFilter}
     ORDER BY created_at ASC`,
    params
  );
  return rows;
}

async function fetchSchedules(
  scope: DataScope,
  from: Date | null,
  to: Date | null,
  range: RangeValue
): Promise<ScheduleRow[]> {
  const pool = getOperationsPool();
  const params: unknown[] = [scope.companyId, scope.supplierId];
  let dateFilter = "";

  if (range !== "all" && from && to) {
    params.push(from.toISOString(), to.toISOString());
    dateFilter = " AND received_at >= $3 AND received_at <= $4";
  }

  const { rows } = await pool.query<ScheduleRow>(
    `SELECT received_at
     FROM delivery_schedules
     WHERE ${scopePredicate(1, 2)}${dateFilter}
     ORDER BY received_at ASC`,
    params
  );
  return rows;
}

async function fetchMtdSubmissions(
  scope: DataScope,
  mtdFrom: Date,
  now: Date
): Promise<Pick<SubmissionRow, "status" | "created_at">[]> {
  const { rows } = await getOperationsPool().query<Pick<SubmissionRow, "status" | "created_at">>(
    `SELECT status, created_at
     FROM submissions
     WHERE ${scopePredicate(1, 2)}
       AND created_at >= $3
       AND created_at <= $4`,
    [scope.companyId, scope.supplierId, mtdFrom.toISOString(), now.toISOString()]
  );
  return rows;
}

async function fetchMtdSchedules(
  scope: DataScope,
  mtdFrom: Date,
  now: Date
): Promise<ScheduleRow[]> {
  const { rows } = await getOperationsPool().query<ScheduleRow>(
    `SELECT received_at
     FROM delivery_schedules
     WHERE ${scopePredicate(1, 2)}
       AND received_at >= $3
       AND received_at <= $4`,
    [scope.companyId, scope.supplierId, mtdFrom.toISOString(), now.toISOString()]
  );
  return rows;
}

export async function getDashboard(
  supplier: SupplierRow | null | undefined,
  portalUser: PortalAuthUser | undefined,
  queryString: string
) {
  const { range, groupBy, from, to } = parseRange(new URLSearchParams(queryString));
  const scope = resolveDataScope(portalUser, supplier);

  if (!scope) {
    return { status: 200 as const, body: { kpis: EMPTY_KPIS, trend: [], docMix: [] } };
  }
  if (range === "custom" && (!from || !to)) {
    return { status: 200 as const, body: { kpis: EMPTY_KPIS, trend: [], docMix: [] } };
  }

  const now = new Date();
  const mtdFrom = startOfCurrentUtcMonth();

  let submissionRows: SubmissionRow[] = [];
  let scheduleRows: ScheduleRow[] = [];
  let mtdSubmissionRows: Pick<SubmissionRow, "status" | "created_at">[] = [];
  let mtdScheduleRows: ScheduleRow[] = [];

  try {
    if (range === "all") {
      [submissionRows, mtdSubmissionRows, mtdScheduleRows] = await Promise.all([
        fetchSubmissions(scope, from, to, range),
        fetchMtdSubmissions(scope, mtdFrom, now),
        fetchMtdSchedules(scope, mtdFrom, now)
      ]);
    } else {
      [submissionRows, scheduleRows, mtdSubmissionRows, mtdScheduleRows] = await Promise.all([
        fetchSubmissions(scope, from, to, range),
        fetchSchedules(scope, from, to, range),
        fetchMtdSubmissions(scope, mtdFrom, now),
        fetchMtdSchedules(scope, mtdFrom, now)
      ]);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load dashboard";
    return { status: 400 as const, body: { error: message } };
  }

  const trendMap = new Map<string, TrendPoint>();
  if (range !== "all" && from && to) {
    let cursor = getBucketStart(from, groupBy);
    const end = getBucketStart(to, groupBy);
    while (cursor.getTime() <= end.getTime()) {
      const key = getBucketKey(cursor, groupBy);
      trendMap.set(key, {
        bucketKey: key,
        label: formatLabel(cursor, groupBy),
        inbound: 0,
        outbound: 0
      });
      cursor = addStep(cursor, groupBy);
    }
  }

  const inboundTransactionsMtd = mtdScheduleRows.length;
  const outboundTransactionsMtd = mtdSubmissionRows.length;
  let errorsExceptions = 0;
  for (const row of mtdSubmissionRows) {
    if (row.status?.toLowerCase() === "error") errorsExceptions += 1;
  }

  const docMixCounts = new Map<string, number>();
  const tradingPartners = new Set<string>();
  let processingMinutesSum = 0;
  let processingCount = 0;

  for (const row of scheduleRows) {
    const received = row.received_at ? new Date(row.received_at) : null;
    if (received && !Number.isNaN(received.getTime()) && isWithin(received, from, to)) {
      incrementTrendBucket(trendMap, received, groupBy, "inbound");
    }
  }

  for (const row of submissionRows) {
    const created = row.created_at ? new Date(row.created_at) : null;
    if (created && !Number.isNaN(created.getTime()) && isWithin(created, from, to)) {
      incrementTrendBucket(trendMap, created, groupBy, "outbound");
    }

    const docType = (row.doc_type || "UNKNOWN").toUpperCase();
    docMixCounts.set(docType, (docMixCounts.get(docType) || 0) + 1);

    const partner = row.trading_partner?.trim();
    if (partner) tradingPartners.add(partner);

    if (row.created_at && row.submitted_at) {
      const started = new Date(row.created_at).getTime();
      const finished = new Date(row.submitted_at).getTime();
      if (!Number.isNaN(started) && !Number.isNaN(finished) && finished >= started) {
        processingMinutesSum += (finished - started) / 60000;
        processingCount += 1;
      }
    }
  }

  const avgProcessingTimeMinutes =
    processingCount > 0 ? Number((processingMinutesSum / processingCount).toFixed(1)) : 0;
  const trend = Array.from(trendMap.values()).sort((a, b) => a.bucketKey.localeCompare(b.bucketKey));
  const docMix = Array.from(docMixCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, value]): DocMixPoint => ({ name, value }));

  return {
    status: 200 as const,
    body: {
      kpis: {
        inboundTransactionsMtd,
        outboundTransactionsMtd,
        activeTradingPartners:
          portalUser?.actor === "partner_admin" ? tradingPartners.size : 0,
        errorsExceptions,
        avgProcessingTimeMinutes
      },
      trend,
      docMix
    }
  };
}
