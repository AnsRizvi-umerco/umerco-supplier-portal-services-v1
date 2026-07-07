import type { SupabaseClient } from "@supabase/supabase-js";
import type { SupplierRow } from "@/middleware/auth";
import { deljitMessageSchema } from "@/schemas/index";
import type { DeljitMessage } from "@/schemas/deljit";
import { linesConsistentWithMessage, type ScheduleLineRow } from "@/utils/deljit/schedule-detail";
import { parseDateRange, toIsoDate } from "@/utils/date-range";

export type ScheduleDateBasis = "period" | "received" | "release";

const VALID_BASIS = new Set<string>(["period", "received", "release"]);

function parseBasis(searchParams: URLSearchParams): ScheduleDateBasis {
  const raw = (searchParams.get("basis") || "period").toLowerCase();
  return (VALID_BASIS.has(raw) ? raw : "period") as ScheduleDateBasis;
}

export async function listSchedules(
  supplier: SupplierRow | null | undefined,
  supabase: SupabaseClient | undefined,
  queryString: string
) {
  if (!supplier || !supabase) return { status: 200 as const, body: { schedules: [] } };

  const searchParams = new URLSearchParams(queryString);
  const basis = parseBasis(searchParams);
  const { range, from, to } = parseDateRange(searchParams, "all");

  if (range === "custom" && (!from || !to)) {
    return {
      status: 400 as const,
      body: { schedules: [], error: "Choose both From and To dates for a custom range." }
    };
  }

  let query = supabase
    .from("delivery_schedules")
    .select("id, deljit_ref, release_date, period_start, period_end, status, received_at")
    .eq("supplier_id", supplier.id)
    .order("received_at", { ascending: false });

  if (range !== "all" && from && to) {
    if (basis === "received") {
      query = query.gte("received_at", from.toISOString()).lte("received_at", to.toISOString());
    } else if (basis === "period") {
      query = query.gte("period_end", toIsoDate(from)).lte("period_start", toIsoDate(to));
    } else {
      query = query
        .not("release_date", "is", null)
        .gte("release_date", toIsoDate(from))
        .lte("release_date", toIsoDate(to));
    }
  }

  const deljitRef = searchParams.get("deljitRef")?.trim() ?? "";
  if (deljitRef) query = query.ilike("deljit_ref", `%${deljitRef}%`);

  const { data, error } = await query;
  if (error) return { status: 400 as const, body: { schedules: [], error: error.message } };
  return { status: 200 as const, body: { schedules: data } };
}

export async function getScheduleById(
  supplier: SupplierRow | null | undefined,
  supabase: SupabaseClient | undefined,
  id: string
) {
  if (!supplier || !supabase) {
    return { status: 404 as const, body: { schedule: null, lines: [], message: null } };
  }

  const { data, error } = await supabase
    .from("delivery_schedules")
    .select(
      "id, deljit_ref, release_date, period_start, period_end, status, received_at, canonical_json, schedule_lines(id, part_no, description, qty_required, uom, deliver_by, facility)"
    )
    .eq("id", id)
    .eq("supplier_id", supplier.id)
    .maybeSingle();

  if (error) {
    return {
      status: 400 as const,
      body: { schedule: null, lines: [], message: null, error: error.message }
    };
  }
  if (!data) {
    return { status: 404 as const, body: { schedule: null, lines: [], message: null } };
  }

  const lines = (data.schedule_lines ?? []) as ScheduleLineRow[];
  const rawCanonical = data.canonical_json;
  const parsed = deljitMessageSchema.safeParse(rawCanonical);

  let message: DeljitMessage | null = null;
  let canonical_parse_error: string | null = null;
  if (parsed.success) message = parsed.data;
  else canonical_parse_error = JSON.stringify(parsed.error.flatten());

  const lines_consistent_with_message =
    message === null ? null : linesConsistentWithMessage(message, lines);

  const rawRecord =
    rawCanonical && typeof rawCanonical === "object"
      ? (rawCanonical as Record<string, unknown>)
      : null;
  const trading_partner =
    message?.tradingPartner ??
    (typeof rawRecord?.tradingPartner === "string" ? rawRecord.tradingPartner : null);

  return {
    status: 200 as const,
    body: {
      schedule: {
        id: data.id,
        deljit_ref: data.deljit_ref,
        release_date: data.release_date,
        period_start: data.period_start,
        period_end: data.period_end,
        status: data.status,
        received_at: data.received_at,
        trading_partner
      },
      lines,
      message,
      canonical_parse_error,
      canonical_json_raw: rawCanonical,
      lines_consistent_with_message
    }
  };
}
