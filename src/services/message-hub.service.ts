import type { PortalAuthUser, SupplierRow } from "@/middleware/auth";
import { getOperationsPool } from "@/config/operations-db";
import { resolveDataScope, scopePredicateAliased, type DataScope } from "@/utils/data-scope";

type Direction = "IN" | "OUT";
type FaStatus = "Accepted" | "Rejected" | "Pending";
type DocStatus = "Accepted" | "Rejected" | "In process";
type ExceptionKind = "business" | "supplier" | "technical";

type LogRow = {
  id: string;
  dir: Direction;
  doc_type: string;
  occurred_at: string;
  ref_no: string;
  ship_from: string | null;
  ship_to: string | null;
  sender: string | null;
  receiver: string | null;
  status: string;
  counterparty: string | null;
  error_message: string | null;
  href: string | null;
  supplier_name: string | null;
  master_supplier_id: string | null;
};

function inboundDocStatus(status: string): { fa: FaStatus; docStatus: DocStatus } {
  if (status === "invoice_sent" || status === "acknowledged" || status === "completed") {
    return { fa: "Accepted", docStatus: "Accepted" };
  }
  return { fa: "Accepted", docStatus: "In process" };
}

function outboundDocStatus(status: string): { fa: FaStatus; docStatus: DocStatus } {
  const value = status.toLowerCase();
  if (value === "submitted") return { fa: "Accepted", docStatus: "Accepted" };
  if (value === "error") return { fa: "Rejected", docStatus: "Rejected" };
  return { fa: "Pending", docStatus: "In process" };
}

function exceptionKind(errorMessage: string | null): ExceptionKind {
  const text = (errorMessage ?? "").toLowerCase();
  if (/timeout|network|econn|socket|502|503|channel|iwhi/.test(text)) return "technical";
  if (/partner|mismatch|unknown po|line/.test(text)) return "supplier";
  return "business";
}

function resubmitHref(docType: string): string | null {
  if (docType === "INVOIC") return "/submit/invoice";
  if (docType === "DESADV") return "/submit/asn";
  if (docType === "ORDRSP") return "/submit/poack";
  if (docType === "APERAK") return "/submit/scheduleack";
  return null;
}

async function resolveAdminSupplierFilter(
  companyId: string,
  masterSupplierId: string | undefined
): Promise<string | null | "missing"> {
  const trimmed = masterSupplierId?.trim();
  if (!trimmed) return null;

  const { rows } = await getOperationsPool().query<{ id: string }>(
    `SELECT id
     FROM suppliers
     WHERE company_id = $1 AND master_supplier_id = $2
     LIMIT 1`,
    [companyId, trimmed]
  );

  return rows[0]?.id ?? "missing";
}

function applySupplierFilter(scope: DataScope, filterSupplierId: string | null | "missing"): DataScope | null {
  if (filterSupplierId === "missing") return null;
  if (!filterSupplierId) return scope;
  return { companyId: scope.companyId, supplierId: filterSupplierId };
}

export async function listMessageHub(
  supplier: SupplierRow | null | undefined,
  portalUser: PortalAuthUser | undefined,
  queryString = ""
) {
  const baseScope = resolveDataScope(portalUser, supplier);
  if (!baseScope) {
    return { status: 200 as const, body: { transactions: [], exceptions: [] } };
  }

  const searchParams = new URLSearchParams(queryString);
  const masterSupplierId =
    portalUser?.actor === "partner_admin" ? searchParams.get("supplierId") ?? undefined : undefined;
  const filterSupplierId =
    portalUser?.actor === "partner_admin"
      ? await resolveAdminSupplierFilter(baseScope.companyId, masterSupplierId)
      : null;
  const scope = applySupplierFilter(baseScope, filterSupplierId);
  if (!scope) {
    return { status: 200 as const, body: { transactions: [], exceptions: [] } };
  }

  try {
    const pool = getOperationsPool();
    const scheduleScope = scopePredicateAliased("ds", 1, 2);
    const submissionScope = scopePredicateAliased("s", 1, 2);

    const { rows } = await pool.query<LogRow>(
      `SELECT * FROM (
         SELECT
           ds.id::text AS id,
           'IN'::text AS dir,
           CASE
             WHEN NULLIF(ds.canonical_json->'message'->>'messageType', '') IS NOT NULL
               THEN ds.canonical_json->'message'->>'messageType'
             WHEN (ds.canonical_json::jsonb) ? 'interchange' THEN '850'
             ELSE 'DELJIT'
           END AS doc_type,
           ds.received_at AS occurred_at,
           ds.deljit_ref AS ref_no,
           COALESCE(
             NULLIF(ds.canonical_json->'payload'->'shipFrom'->>'name', ''),
             NULLIF(ds.canonical_json->'payload'->'shipment'->'shipFrom'->>'name', ''),
             NULLIF(ds.canonical_json->'payload'->>'shipFromName', ''),
             ''
           ) AS ship_from,
           COALESCE(
             NULLIF((SELECT sl.facility FROM schedule_lines sl WHERE sl.schedule_id = ds.id LIMIT 1), ''),
             NULLIF(ds.canonical_json->'payload'->'shipTo'->>'name', ''),
             NULLIF(ds.canonical_json->'payload'->>'shipToFacility', ''),
             NULLIF(ds.canonical_json->'payload'->>'facility', ''),
             ''
           ) AS ship_to,
           COALESCE(
             NULLIF(ds.canonical_json->'payload'->>'buyerName', ''),
             NULLIF(ds.canonical_json->'payload'->>'buyerCompanyName', ''),
             ''
           ) AS sender,
           COALESCE(
             NULLIF(ds.canonical_json->'payload'->>'vendorName', ''),
             NULLIF(sup.name, ''),
             ''
           ) AS receiver,
           ds.status,
           COALESCE(
             NULLIF(ds.canonical_json->'payload'->>'buyerName', ''),
             NULLIF(ds.canonical_json->>'tradingPartner', ''),
             NULLIF(ds.canonical_json->'interchange'->>'senderId', ''),
             ''
           ) AS counterparty,
           NULL::text AS error_message,
           '/schedules?schedule=' || ds.id::text AS href,
           sup.name AS supplier_name,
           sup.master_supplier_id::text AS master_supplier_id
         FROM delivery_schedules ds
         INNER JOIN suppliers sup ON sup.id = ds.supplier_id
         WHERE ${scheduleScope}

         UNION ALL

         SELECT
           s.id::text AS id,
           'OUT'::text AS dir,
           s.doc_type,
           COALESCE(s.submitted_at, s.created_at) AS occurred_at,
           s.ref_no,
           COALESCE(
             NULLIF(s.canonical_json->'payload'->'shipFrom'->>'name', ''),
             NULLIF(s.canonical_json->'payload'->'shipment'->'shipFrom'->>'name', ''),
             NULLIF(s.canonical_json->'payload'->>'shipFromName', ''),
             ''
           ) AS ship_from,
           COALESCE(
             NULLIF(s.canonical_json->'payload'->>'shipToFacility', ''),
             NULLIF(s.canonical_json->'payload'->'shipTo'->>'name', ''),
             NULLIF(s.canonical_json->'payload'->>'facility', ''),
             ''
           ) AS ship_to,
           COALESCE(
             NULLIF(s.canonical_json->'payload'->>'supplierName', ''),
             NULLIF(sup.name, ''),
             ''
           ) AS sender,
           COALESCE(
             NULLIF(s.canonical_json->'payload'->>'buyerCompanyName', ''),
             NULLIF(s.canonical_json->'payload'->>'buyerName', ''),
             ''
           ) AS receiver,
           s.status,
           COALESCE(
             NULLIF(s.canonical_json->'payload'->>'buyerCompanyName', ''),
             NULLIF(s.canonical_json->>'tradingPartner', ''),
             ''
           ) AS counterparty,
           s.error_message,
           NULL::text AS href,
           sup.name AS supplier_name,
           sup.master_supplier_id::text AS master_supplier_id
         FROM submissions s
         INNER JOIN suppliers sup ON sup.id = s.supplier_id
         WHERE ${submissionScope}
       ) tx
       ORDER BY occurred_at DESC
       LIMIT 250`,
      [scope.companyId, scope.supplierId]
    );

    const companyName = portalUser?.business_partner_name?.trim() || "";

    const partyName = (row: LogRow, side: "sender" | "receiver"): string => {
      const stored = (side === "sender" ? row.sender : row.receiver)?.trim() || "";
      if (stored) return stored;
      if (row.dir === "OUT" && side === "receiver") return companyName || "—";
      if (row.dir === "IN" && side === "sender") return companyName || "—";
      if (row.dir === "OUT" && side === "sender") return row.supplier_name?.trim() || "—";
      if (row.dir === "IN" && side === "receiver") return row.supplier_name?.trim() || "—";
      return "—";
    };

    const transactions = rows.map((row) => {
      const mapped = row.dir === "IN" ? inboundDocStatus(row.status) : outboundDocStatus(row.status);
      return {
        id: `${row.dir}-${row.id}`,
        dir: row.dir,
        docType: row.doc_type || "UNKNOWN",
        date: row.occurred_at,
        refNo: row.ref_no,
        shipFrom: row.ship_from?.trim() || "",
        shipTo: row.ship_to?.trim() || "—",
        sender: partyName(row, "sender"),
        receiver: partyName(row, "receiver"),
        fa: mapped.fa,
        docStatus: mapped.docStatus,
        counterparty: row.counterparty?.trim() || "—",
        href: row.href,
        supplierName: row.supplier_name?.trim() || "—",
        supplierId: row.master_supplier_id
      };
    });

    const exceptions = rows
      .filter((row) => row.dir === "OUT" && row.status.toLowerCase() === "error")
      .map((row) => {
        const kind = exceptionKind(row.error_message);
        return {
          id: `ex-${row.id}`,
          kind,
          title: `${row.doc_type} failed`,
          meta: `${row.doc_type} · ${row.ref_no}`,
          description: row.error_message?.trim() || "The outbound document was not accepted.",
          fix:
            kind === "technical"
              ? "Check channel connectivity and resubmit the document."
              : "Review the document against the purchase order, then resubmit.",
          href: resubmitHref(row.doc_type),
          docType: row.doc_type || "UNKNOWN",
          refNo: row.ref_no,
          date: row.occurred_at,
          shipFrom: row.ship_from?.trim() || "",
          shipTo: row.ship_to?.trim() || "—",
          sender: partyName(row, "sender"),
          receiver: partyName(row, "receiver"),
          counterparty: row.counterparty?.trim() || "—",
          supplierName: row.supplier_name?.trim() || "—",
          supplierId: row.master_supplier_id
        };
      });

    return { status: 200 as const, body: { transactions, exceptions } };
  } catch (error) {
    console.error("Failed to load message hub:", error);
    const message = error instanceof Error ? error.message : "Failed to load transactions";
    return { status: 400 as const, body: { transactions: [], exceptions: [], error: message } };
  }
}
