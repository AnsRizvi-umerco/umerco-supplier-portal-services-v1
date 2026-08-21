import type { PortalAuthUser, SupplierRow } from "@/middleware/auth";
import { getOperationsPool } from "@/config/operations-db";
import { deljitMessageSchema } from "@/schemas/index";
import type { DeljitMessage } from "@/schemas/deljit";
import {
  inboundPurchaseOrderSchema,
  type InboundPurchaseOrder
} from "@/schemas/inbound-po";
import { linesConsistentWithMessage, type ScheduleLineRow } from "@/utils/deljit/schedule-detail";
import { parseDateRange, toIsoDate } from "@/utils/date-range";
import { resolveDataScope } from "@/utils/data-scope";

export type ScheduleDateBasis = "period" | "received" | "release";

const VALID_BASIS = new Set<string>(["period", "received", "release"]);

function scopePredicateForSchedules(companyParam: number, supplierParam: number): string {
  return `(
    ($${supplierParam}::uuid IS NULL AND (
      ds.company_id = $${companyParam}
      OR ds.supplier_id IN (SELECT id FROM suppliers WHERE company_id = $${companyParam})
    ))
    OR (
      $${supplierParam}::uuid IS NOT NULL
      AND ds.supplier_id = $${supplierParam}
    )
  )`;
}

function parseBasis(searchParams: URLSearchParams): ScheduleDateBasis {
  const raw = (searchParams.get("basis") || "period").toLowerCase();
  return (VALID_BASIS.has(raw) ? raw : "period") as ScheduleDateBasis;
}

export async function listSchedules(
  supplier: SupplierRow | null | undefined,
  portalUser: PortalAuthUser | undefined,
  queryString: string
) {
  const scope = resolveDataScope(portalUser, supplier);
  if (!scope) return { status: 200 as const, body: { schedules: [] } };

  const searchParams = new URLSearchParams(queryString);
  const basis = parseBasis(searchParams);
  const { range, from, to } = parseDateRange(searchParams, "all");

  if (range === "custom" && (!from || !to)) {
    return {
      status: 400 as const,
      body: { schedules: [], error: "Choose both From and To dates for a custom range." }
    };
  }

  const params: unknown[] = [scope.companyId, scope.supplierId];
  const filters: string[] = [scopePredicateForSchedules(1, 2)];

  if (range !== "all" && from && to) {
    if (basis === "received") {
      params.push(from.toISOString(), to.toISOString());
      filters.push(`ds.received_at >= $${params.length - 1} AND ds.received_at <= $${params.length}`);
    } else if (basis === "period") {
      params.push(toIsoDate(to), toIsoDate(from));
      filters.push(`ds.period_end >= $${params.length - 1} AND ds.period_start <= $${params.length}`);
    } else {
      params.push(toIsoDate(from), toIsoDate(to));
      filters.push(
        `ds.release_date IS NOT NULL AND ds.release_date >= $${params.length - 1} AND ds.release_date <= $${params.length}`
      );
    }
  }

  const deljitRef = searchParams.get("deljitRef")?.trim() ?? "";
  if (deljitRef) {
    params.push(`%${deljitRef}%`);
    filters.push(`ds.deljit_ref ILIKE $${params.length}`);
  }

  try {
    const { rows } = await getOperationsPool().query(
      `SELECT ds.id,
              ds.deljit_ref,
              ds.release_date,
              ds.period_start,
              ds.period_end,
              ds.status,
              ds.received_at,
              sup.name AS supplier_name,
              sup.code AS supplier_code,
              sup.email AS supplier_email
       FROM delivery_schedules ds
       LEFT JOIN suppliers sup ON sup.id = ds.supplier_id
       WHERE ${filters.join(" AND ")}
       ORDER BY ds.received_at DESC`,
      params
    );
    return { status: 200 as const, body: { schedules: rows } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load schedules";
    return { status: 400 as const, body: { schedules: [], error: message } };
  }
}

export async function getScheduleById(
  supplier: SupplierRow | null | undefined,
  portalUser: PortalAuthUser | undefined,
  id: string
) {
  const scope = resolveDataScope(portalUser, supplier);
  if (!scope) {
    return { status: 404 as const, body: { schedule: null, lines: [], message: null, purchaseOrder: null } };
  }

  const pool = getOperationsPool();

  try {
    const { rows: scheduleRows } = await pool.query<{
      id: string;
      deljit_ref: string;
      release_date: string | null;
      period_start: string;
      period_end: string;
      status: string;
      received_at: string;
      canonical_json: unknown;
      supplier_name: string | null;
      supplier_code: string | null;
      supplier_email: string | null;
    }>(
      `SELECT ds.id,
              ds.deljit_ref,
              ds.release_date,
              ds.period_start,
              ds.period_end,
              ds.status,
              ds.received_at,
              ds.canonical_json,
              sup.name AS supplier_name,
              sup.code AS supplier_code,
              sup.email AS supplier_email
       FROM delivery_schedules ds
       LEFT JOIN suppliers sup ON sup.id = ds.supplier_id
       WHERE ds.id = $1 AND ${scopePredicateForSchedules(2, 3)}
       LIMIT 1`,
      [id, scope.companyId, scope.supplierId]
    );

    const data = scheduleRows[0];
    if (!data) {
      return { status: 404 as const, body: { schedule: null, lines: [], message: null, purchaseOrder: null } };
    }

    const { rows: lines } = await pool.query<ScheduleLineRow>(
      `SELECT id, part_no, description, qty_required, uom, deliver_by, facility
       FROM schedule_lines
       WHERE schedule_id = $1`,
      [data.id]
    );

    const rawCanonical = data.canonical_json;
    const poParsed = inboundPurchaseOrderSchema.safeParse(rawCanonical);
    const parsed = deljitMessageSchema.safeParse(rawCanonical);

    let purchaseOrder: InboundPurchaseOrder | null = null;
    let message: DeljitMessage | null = null;
    let canonical_parse_error: string | null = null;

    if (poParsed.success) {
      purchaseOrder = poParsed.data;
    } else if (parsed.success) {
      message = parsed.data;
    } else {
      canonical_parse_error = JSON.stringify(parsed.error.flatten());
    }

    const lines_consistent_with_message =
      message === null ? null : linesConsistentWithMessage(message, lines);

    const rawRecord =
      rawCanonical && typeof rawCanonical === "object"
        ? (rawCanonical as Record<string, unknown>)
        : null;
    const trading_partner =
      purchaseOrder?.payload.buyerName ||
      message?.tradingPartner ||
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
          trading_partner,
          supplier_name: data.supplier_name,
          supplier_code: data.supplier_code,
          supplier_email: data.supplier_email
        },
        lines,
        message,
        purchaseOrder,
        canonical_parse_error,
        canonical_json_raw: rawCanonical,
        lines_consistent_with_message
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load schedule";
    return {
      status: 400 as const,
      body: { schedule: null, lines: [], message: null, purchaseOrder: null, error: message }
    };
  }
}
