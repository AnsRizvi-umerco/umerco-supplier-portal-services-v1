import type { SupabaseClient } from "@supabase/supabase-js";
import type { SupplierRow } from "@/middleware/auth";
import { resolveDateRangeBounds, toIsoDate } from "@/utils/date-range";

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

export async function getDashboard(
  supplier: SupplierRow | null | undefined,
  supabase: SupabaseClient | undefined,
  queryString: string
) {
  const { range, groupBy, from, to } = parseRange(new URLSearchParams(queryString));

  if (!supplier || !supabase) {
    return { status: 200 as const, body: { kpis: EMPTY_KPIS, trend: [], docMix: [] } };
  }
  if (range === "custom" && (!from || !to)) {
    return { status: 200 as const, body: { kpis: EMPTY_KPIS, trend: [], docMix: [] } };
  }

  const submissionSelect =
    "doc_type,status,created_at,submitted_at,trading_partner:canonical_json->>tradingPartner";
  const mtdSubmissionSelect = "status, created_at";

  const buildWindowedSubmissionsQuery = () => {
    let q = supabase
      .from("submissions")
      .select(submissionSelect)
      .eq("supplier_id", supplier.id)
      .order("created_at", { ascending: true });
    if (range !== "all" && from && to) {
      q = q.gte("created_at", from.toISOString()).lte("created_at", to.toISOString());
    }
    return q;
  };

  const buildWindowedSchedulesQuery = () => {
    let q = supabase
      .from("delivery_schedules")
      .select("received_at")
      .eq("supplier_id", supplier.id)
      .order("received_at", { ascending: true });
    if (range !== "all" && from && to) {
      q = q.gte("received_at", from.toISOString()).lte("received_at", to.toISOString());
    }
    return q;
  };

  const now = new Date();
  const mtdFrom = startOfCurrentUtcMonth();

  const mtdSubmissionsQuery = supabase
    .from("submissions")
    .select(mtdSubmissionSelect)
    .eq("supplier_id", supplier.id)
    .gte("created_at", mtdFrom.toISOString())
    .lte("created_at", now.toISOString());

  const mtdSchedulesQuery = supabase
    .from("delivery_schedules")
    .select("received_at")
    .eq("supplier_id", supplier.id)
    .gte("received_at", mtdFrom.toISOString())
    .lte("received_at", now.toISOString());

  let submissionRows: SubmissionRow[] = [];
  let scheduleRows: ScheduleRow[] = [];
  let mtdSubmissionRows: Pick<SubmissionRow, "status" | "created_at">[] = [];
  let mtdScheduleRows: ScheduleRow[] = [];

  if (range === "all") {
    const [subRes, mtdSubRes, mtdSchedRes] = await Promise.all([
      buildWindowedSubmissionsQuery(),
      mtdSubmissionsQuery,
      mtdSchedulesQuery
    ]);
    if (subRes.error) return { status: 400 as const, body: { error: subRes.error.message } };
    if (mtdSubRes.error) return { status: 400 as const, body: { error: mtdSubRes.error.message } };
    if (mtdSchedRes.error) return { status: 400 as const, body: { error: mtdSchedRes.error.message } };
    submissionRows = (subRes.data ?? []) as SubmissionRow[];
    mtdSubmissionRows = (mtdSubRes.data ?? []) as Pick<SubmissionRow, "status" | "created_at">[];
    mtdScheduleRows = (mtdSchedRes.data ?? []) as ScheduleRow[];
  } else {
    const [subRes, schedRes, mtdSubRes, mtdSchedRes] = await Promise.all([
      buildWindowedSubmissionsQuery(),
      buildWindowedSchedulesQuery(),
      mtdSubmissionsQuery,
      mtdSchedulesQuery
    ]);
    if (subRes.error) return { status: 400 as const, body: { error: subRes.error.message } };
    if (schedRes.error) return { status: 400 as const, body: { error: schedRes.error.message } };
    if (mtdSubRes.error) return { status: 400 as const, body: { error: mtdSubRes.error.message } };
    if (mtdSchedRes.error) return { status: 400 as const, body: { error: mtdSchedRes.error.message } };
    submissionRows = (subRes.data ?? []) as SubmissionRow[];
    scheduleRows = (schedRes.data ?? []) as ScheduleRow[];
    mtdSubmissionRows = (mtdSubRes.data ?? []) as Pick<SubmissionRow, "status" | "created_at">[];
    mtdScheduleRows = (mtdSchedRes.data ?? []) as ScheduleRow[];
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
        activeTradingPartners: tradingPartners.size,
        errorsExceptions,
        avgProcessingTimeMinutes
      },
      trend,
      docMix
    }
  };
}
