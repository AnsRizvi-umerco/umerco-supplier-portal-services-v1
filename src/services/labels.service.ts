import { z } from "zod";
import type { PortalAuthUser, SupplierRow } from "@/middleware/auth";
import { getOperationsPool } from "@/config/operations-db";
import { resolveDataScope, scopePredicate } from "@/utils/data-scope";

const reqSchema = z.object({
  submissionId: z.string().uuid()
});

export type ShippingLabel = {
  id: string;
  asnRef: string;
  poNumber: string;
  trackingNo: string;
  shipToName: string;
  shipToLines: string[];
  shipFromName: string;
  shipFromLines: string[];
  weight: string;
  dimensions: string;
  shipDate: string;
  remarks: string;
  barcode: string;
  zpl: string;
  createdAt: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function uniqueLines(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    lines.push(trimmed);
  }
  return lines;
}

function payloadFromCanonical(canonical: unknown): Record<string, unknown> {
  const root = asRecord(canonical);
  if (!root) return {};
  return asRecord(root.payload) ?? root;
}

function formatShipDate(value: string): string {
  const compact = value.replace(/\D/g, "");
  if (compact.length === 8) {
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return value || "—";
}

function formatWeight(value: string, uom: string): string {
  if (!value || !Number.isFinite(Number(value)) || Number(value) <= 0) return "—";
  return uom ? `${value} ${uom}` : value;
}

function formatDimensions(length: string, width: string, height: string, uom: string): string {
  if (!length && !width && !height) return "—";
  const unit = uom.trim().toLowerCase();
  const part = (value: string) => (value ? `${value}${unit}` : "—");
  return `${part(length)} x ${part(width)} x ${part(height)}`;
}

function zplText(value: string): string {
  return value.replace(/[\^~\\]/g, " ").slice(0, 80);
}

function toZpl(label: Omit<ShippingLabel, "zpl">): string {
  const shipTo = label.shipToLines.map((line, index) => `^FO40,${90 + index * 28}^A0N,22,22^FD${zplText(line)}^FS`).join("\n");
  const shipFrom = label.shipFromLines.map((line, index) => `^FO430,${90 + index * 28}^A0N,22,22^FD${zplText(line)}^FS`).join("\n");
  return `^XA
^PW812
^LL609
^FO20,20^GB380,200,3^FS
^FO420,20^GB372,200,3^FS
^FO32,32^GB150,36,36^FS
^FO42,40^A0N,22,22^FR^FDSHIP TO:^FS
${shipTo}
^FO440,40^A0N,24,24^FDFROM:^FS
${shipFrom}
^FO20,230^GB380,180,3^FS
^FO420,230^GB372,180,3^FS
^FO40,250^A0N,20,20^FDORDER ID:^FS
^FO220,250^A0N,20,20^FD${zplText(label.poNumber)}^FS
^FO40,290^A0N,20,20^FDWEIGHT:^FS
^FO220,290^A0N,20,20^FD${zplText(label.weight)}^FS
^FO40,330^A0N,20,20^FDDIMENSIONS:^FS
^FO220,330^A0N,20,20^FD${zplText(label.dimensions)}^FS
^FO40,370^A0N,20,20^FDSHIPPING DATE:^FS
^FO220,370^A0N,20,20^FD${zplText(label.shipDate)}^FS
^FO440,250^A0N,22,22^FDREMARKS:^FS
^FO440,290^A0N,20,20^FD${zplText(label.remarks)}^FS
^FO20,430^GB772,150,3^FS
^FO80,450^BY2,3,70^BCN,70,Y,N,N^FD${zplText(label.barcode)}^FS
^XZ`;
}

function mapShippingLabel(row: {
  id: string;
  ref_no: string | null;
  deljit_ref: string | null;
  canonical_json: unknown;
  submitted_at: string | null;
  created_at: string;
}): ShippingLabel {
  const payload = payloadFromCanonical(row.canonical_json);
  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  const firstLine = asRecord(lines[0]) ?? {};
  const asnRef = text(payload.asnRef) || text(row.ref_no) || "ASN";
  const trackingRaw = text(payload.trackingNo);
  const trackingNo =
    trackingRaw && trackingRaw !== "NO-TRACKING-YET" ? trackingRaw : asnRef;
  const shipToName = text(payload.shipToFacility) || text(payload.buyerCompanyName) || "Ship-to";
  const shipFromName = text(payload.supplierName) || "Supplier";
  const shipToLines = uniqueLines([
    text(payload.buyerCompanyName),
    text(payload.shipToFacility)
  ]);
  const shipFromLines = uniqueLines([shipFromName]);
  const mapped = {
    id: row.id,
    asnRef,
    poNumber: text(firstLine.poNumber) || text(row.deljit_ref) || "—",
    trackingNo,
    shipToName,
    shipToLines: shipToLines.length > 0 ? shipToLines : [shipToName],
    shipFromName,
    shipFromLines: shipFromLines.length > 0 ? shipFromLines : [shipFromName],
    weight: formatWeight(text(payload.grossWeight), text(payload.weightUom) || "LB"),
    dimensions: formatDimensions(
      text(payload.length),
      text(payload.width),
      text(payload.height),
      text(payload.dimensionUom) || "IN"
    ),
    shipDate: formatShipDate(text(payload.shipDate)),
    remarks: text(payload.notes) || "NO REMARKS",
    barcode: trackingNo.replace(/[^A-Za-z0-9-]/g, "").toUpperCase() || asnRef.toUpperCase(),
    createdAt: row.submitted_at || row.created_at
  };

  return { ...mapped, zpl: toZpl(mapped) };
}

export async function listShippingLabels(
  supplier: SupplierRow | null | undefined,
  portalUser: PortalAuthUser | undefined
) {
  const scope = resolveDataScope(portalUser, supplier);
  if (!scope) return { status: 200 as const, body: { labels: [] } };

  try {
    const { rows } = await getOperationsPool().query<{
      id: string;
      ref_no: string | null;
      deljit_ref: string | null;
      canonical_json: unknown;
      submitted_at: string | null;
      created_at: string;
    }>(
      `SELECT id, ref_no, deljit_ref, canonical_json, submitted_at, created_at
       FROM submissions
       WHERE ${scopePredicate(1, 2)}
         AND doc_type = 'DESADV'
         AND status = 'submitted'
       ORDER BY COALESCE(submitted_at, created_at) DESC`,
      [scope.companyId, scope.supplierId]
    );

    return { status: 200 as const, body: { labels: rows.map(mapShippingLabel) } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load shipping labels";
    return { status: 400 as const, body: { labels: [], error: message } };
  }
}

export async function generateLabels(body: unknown) {
  const parsed = reqSchema.safeParse(body);
  if (!parsed.success) return { status: 400 as const, body: { labels: [] } };

  const { rows } = await getOperationsPool().query<{
    id: string;
    ref_no: string | null;
    deljit_ref: string | null;
    canonical_json: unknown;
    submitted_at: string | null;
    created_at: string;
    doc_type: string;
    status: string;
  }>(
    `SELECT id, ref_no, deljit_ref, canonical_json, submitted_at, created_at, doc_type, status
     FROM submissions
     WHERE id = $1
     LIMIT 1`,
    [parsed.data.submissionId]
  );

  const row = rows[0];
  if (!row || row.doc_type !== "DESADV" || row.status !== "submitted") {
    return { status: 200 as const, body: { labels: [] } };
  }

  const label = mapShippingLabel(row);
  return { status: 200 as const, body: { labels: [label.zpl], label } };
}
