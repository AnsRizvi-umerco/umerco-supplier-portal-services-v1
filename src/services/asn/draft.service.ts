import { z } from "zod";
import type { PortalAuthUser, SupplierRow } from "@/middleware/auth";
import { getOperationsPool } from "@/config/operations-db";
import { ensureAsnDraftSchema } from "@/config/operations-schema";
import { inboundPurchaseOrderSchema } from "@/schemas/inbound-po";
import { deljitMessageSchema } from "@/schemas/deljit";
import { processSubmission } from "@/services/submissions/submit-service";
import { sealTurnaround, verifyTurnaround } from "@/services/asn/checksum";
import { labelsFromShipment } from "@/services/asn/labels-zpl";
import {
  ASN_CARRIERS,
  ASN_TRANSPORT_MODES,
  applyPackagingAction,
  buildLicencePlate,
  conflictingShipTo,
  newAsnId,
  palletKind,
  palletLabelKind,
  packedQtyForRelease,
  proposalText,
  proposePackaging,
  shipmentTotals,
  validateShipment,
  type AsnAddress,
  type AsnBuyer,
  type AsnParty,
  type AsnRelease,
  type AsnShipment,
  type AsnTurnaround,
  type AsnUnitLoad,
  type PackagingAction
} from "@/services/asn/domain";

const createSchema = z.object({
  scheduleIds: z.array(z.string().uuid()).optional(),
  test: z.boolean().optional()
});

const qtyPatchSchema = z.object({
  releaseId: z.string().min(1),
  qty: z.number().nonnegative()
});

const datePatchSchema = z.object({
  releaseId: z.string().min(1),
  manufacturingDate: z.string().optional(),
  expirationDate: z.string().optional()
});

const packagingActionSchema: z.ZodType<PackagingAction> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("addPallet") }),
  z.object({ type: z.literal("removePallet"), loadId: z.string() }),
  z.object({ type: z.literal("addCarton"), loadId: z.string(), releaseId: z.string(), qty: z.number().optional() }),
  z.object({ type: z.literal("removeCarton"), loadId: z.string(), cartonId: z.string() }),
  z.object({
    type: z.literal("moveCarton"),
    fromLoadId: z.string(),
    toLoadId: z.string(),
    cartonId: z.string()
  }),
  z.object({ type: z.literal("setCartonQty"), loadId: z.string(), cartonId: z.string(), qty: z.number() }),
  z.object({ type: z.literal("markShort"), loadId: z.string(), cartonId: z.string(), short: z.boolean() }),
  z.object({
    type: z.literal("splitGroup"),
    loadId: z.string(),
    groupKey: z.string(),
    count: z.number().int().positive(),
    toReleaseId: z.string()
  })
]);

const patchSchema = z.object({
  currentStep: z.number().int().min(1).max(5).optional(),
  shipDate: z.string().optional(),
  shipTime: z.string().optional(),
  transportMode: z.string().optional(),
  carrierScac: z.string().optional(),
  trackingNo: z.string().optional(),
  bolNumber: z.string().optional(),
  qtyToShip: z.array(qtyPatchSchema).optional(),
  dateFields: z.array(datePatchSchema).optional(),
  proposePackaging: z.boolean().optional(),
  packagingAction: packagingActionSchema.optional()
});

type DraftRow = {
  id: string;
  supplier_id: string;
  company_id: string | null;
  asn_number: string;
  status: string;
  shipment: AsnShipment;
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

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(typeof value === "string" ? value.trim() : value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function compactDate(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return value;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function emptyAddress(): AsnAddress {
  return { code: "", name: "", street: "", city: "", zip: "", country: "" };
}

function flag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const raw = text(value).toLowerCase();
  return raw === "true" || raw === "1" || raw === "y" || raw === "yes";
}

function inferPack(line: Record<string, unknown>): { ppc: number; cpp: number; unitWeightKg: number } {
  const ppc = Math.max(
    1,
    Math.floor(toNumber(line.partsPerCarton ?? line.stdPackQty ?? line.packQty, 10)) || 10
  );
  const cpp = Math.max(
    1,
    Math.floor(toNumber(line.cartonsPerPallet ?? line.palletPackQty, 9)) || 9
  );
  const rawWeight = toNumber(line.unitWeight ?? line.unitWeightKg ?? line.netWeight, 0.25);
  const uom = text(line.unitWeightUom ?? line.weightUom) || "KG";
  const unitWeightKg = uom.toUpperCase() === "KG" ? rawWeight : Number((rawWeight * 0.45359237).toFixed(3));
  return { ppc, cpp, unitWeightKg: unitWeightKg > 0 ? unitWeightKg : 0.25 };
}

function headerParties(
  shipTo: AsnAddress,
  shipFrom: AsnParty,
  buyer: AsnBuyer,
  fallbackFrom: AsnParty,
  fallbackBuyer: AsnBuyer
): { shipTo: AsnAddress; shipFrom: AsnParty; buyer: AsnBuyer } {
  return {
    shipTo: shipTo.code || shipTo.name ? shipTo : emptyAddress(),
    shipFrom: shipFrom.code || shipFrom.name ? shipFrom : fallbackFrom,
    buyer: buyer.id || buyer.name ? buyer : fallbackBuyer
  };
}

function releaseFromTurnaround(params: {
  scheduleId: string;
  turnaround: AsnTurnaround;
  deliveryDate: string;
  openQty: number;
  pack: { ppc: number; cpp: number; unitWeightKg: number };
  countryOfOrigin: string;
  dateControlled: boolean;
}): AsnRelease {
  return {
    id: newAsnId(),
    scheduleId: params.scheduleId,
    turnaround: sealTurnaround(params.turnaround),
    deliveryDate: params.deliveryDate,
    openQty: params.openQty,
    qtyToShip: 0,
    partsPerCarton: params.pack.ppc,
    cartonsPerPallet: params.pack.cpp,
    unitWeightKg: params.pack.unitWeightKg,
    countryOfOrigin: params.countryOfOrigin,
    dateControlled: params.dateControlled,
    manufacturingDate: "",
    expirationDate: ""
  };
}

function testReleases(shipFrom: AsnParty, buyer: AsnBuyer): AsnRelease[] {
  const shipTo: AsnAddress = {
    code: "LC001",
    name: "Lucid Motors",
    street: "7373 Gateway Blvd",
    city: "Casa Grande",
    zip: "85122",
    country: "US"
  };
  const base = {
    shipTo,
    shipFrom,
    buyer,
    poNumber: "PO-TEST-84201",
    price: "10.00",
    uom: "EA"
  };
  return [
    releaseFromTurnaround({
      scheduleId: "test",
      turnaround: {
        ...base,
        partNo: "P11-12345-00",
        description: "Battery Cell Module",
        itemNumber: "001",
        releaseNumber: "RAN-103014"
      },
      deliveryDate: todayIso(),
      openQty: 90,
      pack: { ppc: 10, cpp: 9, unitWeightKg: 0.5 },
      countryOfOrigin: "US",
      dateControlled: false
    }),
    releaseFromTurnaround({
      scheduleId: "test",
      turnaround: {
        ...base,
        partNo: "P11-54321-00",
        description: "Inverter Housing",
        itemNumber: "002",
        releaseNumber: "RAN-203021"
      },
      deliveryDate: todayIso(),
      openQty: 20,
      pack: { ppc: 10, cpp: 10, unitWeightKg: 0.8 },
      countryOfOrigin: "US",
      dateControlled: false
    }),
    releaseFromTurnaround({
      scheduleId: "test",
      turnaround: {
        ...base,
        partNo: "P11-98765-00",
        description: "Harness Clip",
        itemNumber: "003",
        releaseNumber: "RAN-303021"
      },
      deliveryDate: todayIso(),
      openQty: 15,
      pack: { ppc: 5, cpp: 9, unitWeightKg: 0.1 },
      countryOfOrigin: "MX",
      dateControlled: true
    })
  ];
}

function releasesFromCanonical(params: {
  scheduleId: string;
  deljitRef: string;
  canonical: unknown;
  dbLines: Array<{
    part_no: string;
    description: string | null;
    qty_required: number;
    uom: string;
    deliver_by: string;
    facility: string;
  }>;
  shipFrom: AsnParty;
  fallbackBuyer: AsnBuyer;
}): AsnRelease[] {
  const poParsed = inboundPurchaseOrderSchema.safeParse(params.canonical);
  if (poParsed.success) {
    const payload = poParsed.data.payload;
    const shipToRaw = asRecord(payload.shipTo) ?? {};
    const shipTo: AsnAddress = {
      code: text(shipToRaw.id),
      name: text(shipToRaw.name) || text(payload.buyerName),
      street: text(shipToRaw.street),
      city: text(shipToRaw.city),
      zip: text(shipToRaw.postalCode),
      country: text(shipToRaw.countryCode)
    };
    const shipFrom: AsnParty = {
      code: text(payload.vendorId) || params.shipFrom.code,
      name: text(payload.vendorName) || params.shipFrom.name
    };
    const buyer: AsnBuyer = {
      id: text(payload.buyerId) || params.fallbackBuyer.id,
      name: text(payload.buyerName) || params.fallbackBuyer.name
    };
    const poNumber = text(payload.poNumber) || params.deljitRef;
    return payload.lines.map((line, index) => {
      const row = asRecord(line) ?? {};
      const lineNo = text(row.lineNo) || String(index + 1).padStart(3, "0");
      const ran =
        text(row.releaseNumber) || text(row.ran) || text(row.releaseNo) || `${poNumber}:${lineNo}`;
      const partNo = text(row.itemCode);
      const description = (text(row.description) || partNo).slice(0, 40);
      return releaseFromTurnaround({
        scheduleId: params.scheduleId,
        turnaround: {
          partNo,
          description,
          shipTo,
          shipFrom,
          buyer,
          poNumber,
          itemNumber: lineNo,
          releaseNumber: ran,
          price: text(row.unitPrice) || "0",
          uom: text(row.uom) || "EA"
        },
        deliveryDate: compactDate(text(payload.requestedDeliveryDate)) || todayIso(),
        openQty: Math.max(0, Math.round(toNumber(row.quantity))),
        pack: inferPack(row),
        countryOfOrigin: text(row.countryOfOrigin) || text(row.coo),
        dateControlled: flag(row.dateControlled) || flag(row.lotControl) || flag(row.expirationRequired)
      });
    });
  }

  const deljit = deljitMessageSchema.safeParse(params.canonical);
  const lines =
    deljit.success && deljit.data.payload.lines.length > 0
      ? deljit.data.payload.lines.map((line) => ({
          partNo: line.partNo,
          description: line.description,
          qty: line.qtyRequired,
          uom: line.uom,
          deliverBy: compactDate(String(line.deliverBy)),
          facility: line.facility
        }))
      : params.dbLines.map((line) => ({
          partNo: line.part_no,
          description: line.description ?? line.part_no,
          qty: line.qty_required,
          uom: line.uom,
          deliverBy: compactDate(line.deliver_by),
          facility: line.facility
        }));

  return lines.map((line, index) => {
    const shipTo: AsnAddress = {
      code: line.facility,
      name: line.facility,
      street: "",
      city: "",
      zip: "",
      country: ""
    };
    const ran = `${params.deljitRef}:${line.partNo}:${line.deliverBy || index + 1}`;
    return releaseFromTurnaround({
      scheduleId: params.scheduleId,
      turnaround: {
        partNo: line.partNo,
        description: (line.description || line.partNo).slice(0, 40),
        shipTo,
        shipFrom: params.shipFrom,
        buyer: params.fallbackBuyer,
        poNumber: params.deljitRef,
        itemNumber: String(index + 1).padStart(3, "0"),
        releaseNumber: ran,
        price: "0",
        uom: line.uom || "EA"
      },
      deliveryDate: line.deliverBy || todayIso(),
      openQty: Math.max(0, Math.round(line.qty)),
      pack: { ppc: 10, cpp: 9, unitWeightKg: 0.25 },
      countryOfOrigin: "",
      dateControlled: false
    });
  });
}

function syncHeaderFromReleases(shipment: AsnShipment): AsnShipment {
  const selected = shipment.releases.filter((release) => release.qtyToShip > 0);
  const source = selected[0] ?? shipment.releases[0];
  if (!source) return shipment;
  return {
    ...shipment,
    shipFrom: source.turnaround.data.shipFrom,
    shipTo: source.turnaround.data.shipTo,
    buyer: source.turnaround.data.buyer
  };
}

function checksumOk(shipment: AsnShipment): boolean {
  return shipment.releases.every((release) => verifyTurnaround(release.turnaround));
}

async function usedPlates(pool: ReturnType<typeof getOperationsPool>, exceptDraftId?: string) {
  const { rows } = await pool.query<{ plate: string }>(
    exceptDraftId
      ? `SELECT plate FROM licence_plates WHERE NOT (draft_id = $1 AND voided_at IS NULL)`
      : `SELECT plate FROM licence_plates`,
    exceptDraftId ? [exceptDraftId] : []
  );
  return new Set(rows.map((row) => row.plate));
}

async function nextAsnNumber(pool: ReturnType<typeof getOperationsPool>): Promise<string> {
  const day = todayIso().replace(/-/g, "");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const { rows } = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM asn_drafts WHERE asn_number LIKE $1`,
      [`ASN-${day}-%`]
    );
    const candidate = `ASN-${day}-${String((rows[0]?.n ?? 0) + 1 + attempt).padStart(4, "0")}`;
    const exists = await pool.query(`SELECT 1 FROM asn_drafts WHERE asn_number = $1 LIMIT 1`, [candidate]);
    if (exists.rowCount === 0) return candidate;
  }
  return `ASN-${day}-${newAsnId().replace(/-/g, "").slice(0, 8)}`;
}

async function nextSerial(
  pool: ReturnType<typeof getOperationsPool>,
  supplierId: string,
  shipFromCode: string
): Promise<number> {
  const { rows } = await pool.query<{ serial: number }>(
    `INSERT INTO licence_plate_counters (supplier_id, ship_from_code, next_serial)
     VALUES ($1, $2, 2)
     ON CONFLICT (supplier_id, ship_from_code)
     DO UPDATE SET next_serial = licence_plate_counters.next_serial + 1
     RETURNING next_serial - 1 AS serial`,
    [supplierId, shipFromCode]
  );
  return rows[0]?.serial ?? 1;
}

function draftView(shipment: AsnShipment, extras?: { issues?: ReturnType<typeof validateShipment> }) {
  const totals = shipmentTotals(shipment);
  return {
    shipment,
    proposalText: proposalText(shipment.releases),
    totals,
    carriers: ASN_CARRIERS,
    transportModes: ASN_TRANSPORT_MODES,
    shipToConflict: conflictingShipTo(shipment),
    checksumOk: checksumOk(shipment),
    labels: shipment.labelsFrozen ? labelsFromShipment(shipment) : [],
    issues: extras?.issues ?? []
  };
}

async function loadDraft(
  pool: ReturnType<typeof getOperationsPool>,
  supplierId: string,
  draftId: string
): Promise<DraftRow | null> {
  const { rows } = await pool.query<DraftRow>(
    `SELECT id, supplier_id, company_id, asn_number, status, shipment
     FROM asn_drafts
     WHERE id = $1 AND supplier_id = $2
     LIMIT 1`,
    [draftId, supplierId]
  );
  return rows[0] ?? null;
}

async function saveDraft(
  pool: ReturnType<typeof getOperationsPool>,
  draftId: string,
  shipment: AsnShipment,
  status?: string
) {
  await pool.query(
    `UPDATE asn_drafts
     SET shipment = $2::jsonb,
         status = COALESCE($3, status),
         updated_at = now()
     WHERE id = $1`,
    [draftId, JSON.stringify(shipment), status ?? null]
  );
}

function requireSupplier(supplier: SupplierRow | null | undefined): SupplierRow | null {
  return supplier ?? null;
}

export async function createDraft(
  supplier: SupplierRow | null | undefined,
  portalUser: PortalAuthUser | undefined,
  body: unknown
) {
  const authed = requireSupplier(supplier);
  if (!authed || !portalUser) {
    return { status: 401 as const, body: { error: "Not authenticated" } };
  }

  const parsed = createSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return { status: 400 as const, body: { error: parsed.error.flatten() } };
  }

  const pool = getOperationsPool();
  await ensureAsnDraftSchema(pool);

  const shipFrom: AsnParty = {
    code: (portalUser.mutually_defined_zz || authed.code || "").replace(/\s+/g, ""),
    name: authed.name
  };
  const buyer: AsnBuyer = {
    id: portalUser.company_mutually_defined_zz || portalUser.business_partner_code || "",
    name: portalUser.business_partner_name || ""
  };

  let releases: AsnRelease[] = [];
  if (parsed.data.test) {
    releases = testReleases(shipFrom, buyer);
  } else {
    const requested = parsed.data.scheduleIds ?? [];
    const { rows: schedules } = await pool.query<{
      id: string;
      deljit_ref: string;
      canonical_json: unknown;
      sent_docs: string[];
    }>(
      `SELECT ds.id,
              ds.deljit_ref,
              ds.canonical_json,
              COALESCE((
                SELECT ARRAY_AGG(DISTINCT s.doc_type)
                FROM submissions s
                WHERE s.status = 'submitted'
                  AND s.supplier_id = ds.supplier_id
                  AND s.deljit_ref = ds.deljit_ref
              ), ARRAY[]::text[]) AS sent_docs
       FROM delivery_schedules ds
       WHERE ds.supplier_id = $1
       ORDER BY ds.received_at DESC`,
      [authed.id]
    );

    const open = schedules.filter((row) => {
      const sent = (row.sent_docs ?? []).some((doc) => doc.trim().toUpperCase() === "DESADV");
      if (requested.includes(row.id)) return true;
      return !sent;
    });

    if (requested.length > 0) {
      const missing = requested.filter((id) => !schedules.some((row) => row.id === id));
      if (missing.length > 0) {
        return { status: 404 as const, body: { error: "Schedule not found" } };
      }
      const alreadySent = requested.filter((id) => {
        const row = schedules.find((item) => item.id === id);
        return (row?.sent_docs ?? []).some((doc) => doc.trim().toUpperCase() === "DESADV");
      });
      if (alreadySent.length > 0) {
        return {
          status: 409 as const,
          body: { error: "ASN already sent for the selected schedule. The shipping label is in Shipping Labels." }
        };
      }
    }

    const selectedSchedules =
      requested.length > 0 ? open.filter((row) => requested.includes(row.id) || !row.sent_docs?.includes("DESADV")) : open;

    for (const schedule of selectedSchedules) {
      const { rows: lines } = await pool.query<{
        part_no: string;
        description: string | null;
        qty_required: number;
        uom: string;
        deliver_by: string;
        facility: string;
      }>(
        `SELECT part_no, description, qty_required, uom, deliver_by, facility
         FROM schedule_lines
         WHERE schedule_id = $1`,
        [schedule.id]
      );
      releases.push(
        ...releasesFromCanonical({
          scheduleId: schedule.id,
          deljitRef: schedule.deljit_ref,
          canonical: schedule.canonical_json,
          dbLines: lines,
          shipFrom,
          fallbackBuyer: buyer
        })
      );
    }
  }

  if (releases.length === 0) {
    return { status: 400 as const, body: { error: "No open releases were found for an ASN." } };
  }

  const asnNumber = await nextAsnNumber(pool);
  const header = headerParties(
    releases[0].turnaround.data.shipTo,
    releases[0].turnaround.data.shipFrom,
    releases[0].turnaround.data.buyer,
    shipFrom,
    buyer
  );

  const shipment: AsnShipment = {
    asnNumber,
    shipDate: todayIso(),
    shipTime: nowTime(),
    transportMode: "",
    carrierScac: "",
    trackingNo: "",
    bolNumber: "",
    currentStep: 1,
    labelsFrozen: false,
    shipFrom: header.shipFrom,
    shipTo: header.shipTo,
    buyer: header.buyer,
    releases,
    unitLoads: []
  };

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO asn_drafts (supplier_id, company_id, asn_number, status, shipment)
     VALUES ($1, $2, $3, 'draft', $4::jsonb)
     RETURNING id`,
    [authed.id, portalUser.business_partner_id, asnNumber, JSON.stringify(shipment)]
  );

  return {
    status: 201 as const,
    body: { id: rows[0].id, asnNumber, ...draftView(shipment) }
  };
}

export async function getDraft(
  supplier: SupplierRow | null | undefined,
  portalUser: PortalAuthUser | undefined,
  draftId: string
) {
  const authed = requireSupplier(supplier);
  if (!authed || !portalUser) {
    return { status: 401 as const, body: { error: "Not authenticated" } };
  }
  const pool = getOperationsPool();
  await ensureAsnDraftSchema(pool);
  const draft = await loadDraft(pool, authed.id, draftId);
  if (!draft) return { status: 404 as const, body: { error: "ASN draft not found" } };
  return { status: 200 as const, body: { id: draft.id, asnNumber: draft.asn_number, status: draft.status, ...draftView(draft.shipment) } };
}

export async function patchDraft(
  supplier: SupplierRow | null | undefined,
  portalUser: PortalAuthUser | undefined,
  draftId: string,
  body: unknown
) {
  const authed = requireSupplier(supplier);
  if (!authed || !portalUser) {
    return { status: 401 as const, body: { error: "Not authenticated" } };
  }

  const parsed = patchSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return { status: 400 as const, body: { error: parsed.error.flatten() } };
  }

  const pool = getOperationsPool();
  await ensureAsnDraftSchema(pool);
  const draft = await loadDraft(pool, authed.id, draftId);
  if (!draft) return { status: 404 as const, body: { error: "ASN draft not found" } };
  if (draft.status === "submitted") {
    return { status: 409 as const, body: { error: "This ASN has already been submitted." } };
  }

  let shipment = draft.shipment;
  const patch = parsed.data;

  if (patch.shipDate != null) shipment = { ...shipment, shipDate: patch.shipDate };
  if (patch.shipTime != null) shipment = { ...shipment, shipTime: patch.shipTime };
  if (patch.transportMode != null) {
    const mode = patch.transportMode.trim().toUpperCase();
    if (mode && !ASN_TRANSPORT_MODES.includes(mode as (typeof ASN_TRANSPORT_MODES)[number])) {
      return { status: 400 as const, body: { error: "Invalid transport mode." } };
    }
    shipment = { ...shipment, transportMode: mode };
  }
  if (patch.carrierScac != null) {
    const scac = patch.carrierScac.trim().toUpperCase();
    if (scac && !ASN_CARRIERS.some((carrier) => carrier.scac === scac)) {
      return { status: 400 as const, body: { error: "Carrier must be selected from the SCAC list." } };
    }
    shipment = { ...shipment, carrierScac: scac };
  }
  if (patch.trackingNo != null) shipment = { ...shipment, trackingNo: patch.trackingNo.trim() };
  if (patch.bolNumber != null) shipment = { ...shipment, bolNumber: patch.bolNumber.trim() };

  if (patch.qtyToShip) {
    const qtyById = new Map(patch.qtyToShip.map((row) => [row.releaseId, row.qty]));
    const changed = shipment.releases.some(
      (release) => qtyById.has(release.id) && Math.floor(qtyById.get(release.id) ?? 0) !== release.qtyToShip
    );
    shipment = {
      ...shipment,
      releases: shipment.releases.map((release) =>
        qtyById.has(release.id)
          ? { ...release, qtyToShip: Math.max(0, Math.floor(qtyById.get(release.id) ?? 0)) }
          : release
      ),
      unitLoads: changed && !shipment.labelsFrozen ? [] : shipment.unitLoads
    };
  }

  if (patch.dateFields) {
    const byId = new Map(patch.dateFields.map((row) => [row.releaseId, row]));
    shipment = {
      ...shipment,
      releases: shipment.releases.map((release) => {
        const next = byId.get(release.id);
        if (!next || !release.dateControlled) return release;
        return {
          ...release,
          manufacturingDate: next.manufacturingDate ?? release.manufacturingDate,
          expirationDate: next.expirationDate ?? release.expirationDate
        };
      })
    };
  }

  shipment = syncHeaderFromReleases(shipment);

  if (patch.packagingAction) {
    if (shipment.labelsFrozen) {
      return { status: 409 as const, body: { error: "Packaging is frozen. Unlock and reprint to edit the tree." } };
    }
    shipment = applyPackagingAction(shipment, patch.packagingAction);
  }

  const enteringPackaging = (patch.currentStep ?? shipment.currentStep) === 3;
  if (!shipment.labelsFrozen && (patch.proposePackaging || (enteringPackaging && shipment.unitLoads.every((load) => load.cartons.length === 0)))) {
    shipment = { ...shipment, unitLoads: proposePackaging(shipment.releases) };
  }

  if (patch.currentStep != null) {
    if (patch.currentStep >= 3 && conflictingShipTo(shipment)) {
      return {
        status: 400 as const,
        body: { error: "Selected releases disagree on ship-to. Use one ship-to per ASN.", ...draftView(shipment) }
      };
    }
    shipment = { ...shipment, currentStep: patch.currentStep };
  }

  await saveDraft(pool, draft.id, shipment);
  return { status: 200 as const, body: { id: draft.id, asnNumber: draft.asn_number, ...draftView(shipment) } };
}

export async function allocateLabels(
  supplier: SupplierRow | null | undefined,
  portalUser: PortalAuthUser | undefined,
  draftId: string
) {
  const authed = requireSupplier(supplier);
  if (!authed || !portalUser) {
    return { status: 401 as const, body: { error: "Not authenticated" } };
  }
  const pool = getOperationsPool();
  await ensureAsnDraftSchema(pool);
  const draft = await loadDraft(pool, authed.id, draftId);
  if (!draft) return { status: 404 as const, body: { error: "ASN draft not found" } };
  if (draft.status === "submitted") {
    return { status: 409 as const, body: { error: "This ASN has already been submitted." } };
  }

  let shipment = draft.shipment;
  if (shipment.labelsFrozen) {
    return { status: 200 as const, body: { id: draft.id, asnNumber: draft.asn_number, ...draftView(shipment) } };
  }

  const shipFromCode = shipment.shipFrom.code || authed.code;
  const existing = await pool.query<{ plate: string }>(`SELECT plate FROM licence_plates`);
  const taken = new Set(existing.rows.map((row) => row.plate));

  const allocate = async (di: "1J" | "5J" | "6J"): Promise<string> => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const serial = await nextSerial(pool, authed.id, shipFromCode);
      const plate = buildLicencePlate(di, shipFromCode, serial);
      if (plate.length === 20 && !taken.has(plate)) {
        taken.add(plate);
        return plate;
      }
    }
    throw new Error("Could not allocate a unique licence plate");
  };

  const client = await pool.connect();
  try {
    const nextLoads: AsnUnitLoad[] = [];
    for (const load of shipment.unitLoads) {
      const cartons = [];
      for (const carton of load.cartons) {
        const plate =
          carton.licencePlate && carton.licencePlate.length === 20 ? carton.licencePlate : await allocate("1J");
        cartons.push({ ...carton, licencePlate: plate });
      }
      const kind = palletKind({ ...load, cartons }, shipment.releases);
      const labelKind = palletLabelKind(kind);
      let palletPlate = load.licencePlate;
      if (labelKind) {
        palletPlate =
          palletPlate && palletPlate.startsWith(labelKind) && palletPlate.length === 20
            ? palletPlate
            : await allocate(labelKind);
      } else {
        palletPlate = null;
      }
      nextLoads.push({ ...load, cartons, licencePlate: palletPlate });
    }

    shipment = {
      ...shipment,
      unitLoads: nextLoads,
      labelsFrozen: true,
      currentStep: Math.max(shipment.currentStep, 4)
    };

    await client.query("BEGIN");
    for (const load of shipment.unitLoads) {
      if (load.licencePlate) {
        const kind = palletLabelKind(palletKind(load, shipment.releases)) ?? "6J";
        await client.query(
          `INSERT INTO licence_plates (plate, supplier_id, draft_id, kind)
           VALUES ($1, $2, $3, $4)`,
          [load.licencePlate, authed.id, draft.id, kind]
        );
      }
      for (const carton of load.cartons) {
        if (!carton.licencePlate) continue;
        await client.query(
          `INSERT INTO licence_plates (plate, supplier_id, draft_id, kind)
           VALUES ($1, $2, $3, '1J')`,
          [carton.licencePlate, authed.id, draft.id]
        );
      }
    }
    await client.query(
      `UPDATE asn_drafts SET shipment = $2::jsonb, updated_at = now() WHERE id = $1`,
      [draft.id, JSON.stringify(shipment)]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    const message = error instanceof Error ? error.message : "Failed to allocate licence plates";
    return { status: 400 as const, body: { error: message } };
  } finally {
    client.release();
  }

  return { status: 200 as const, body: { id: draft.id, asnNumber: draft.asn_number, ...draftView(shipment) } };
}

export async function unlockLabels(
  supplier: SupplierRow | null | undefined,
  portalUser: PortalAuthUser | undefined,
  draftId: string
) {
  const authed = requireSupplier(supplier);
  if (!authed || !portalUser) {
    return { status: 401 as const, body: { error: "Not authenticated" } };
  }
  const pool = getOperationsPool();
  await ensureAsnDraftSchema(pool);
  const draft = await loadDraft(pool, authed.id, draftId);
  if (!draft) return { status: 404 as const, body: { error: "ASN draft not found" } };
  if (draft.status === "submitted") {
    return { status: 409 as const, body: { error: "This ASN has already been submitted." } };
  }

  await pool.query(`UPDATE licence_plates SET voided_at = now() WHERE draft_id = $1 AND voided_at IS NULL`, [
    draft.id
  ]);

  const shipment: AsnShipment = {
    ...draft.shipment,
    labelsFrozen: false,
    currentStep: 3,
    unitLoads: draft.shipment.unitLoads.map((load) => ({
      ...load,
      licencePlate: null,
      cartons: load.cartons.map((carton) => ({ ...carton, licencePlate: null }))
    }))
  };
  await saveDraft(pool, draft.id, shipment);
  return { status: 200 as const, body: { id: draft.id, asnNumber: draft.asn_number, ...draftView(shipment) } };
}

export async function submitDraft(
  supplier: SupplierRow | null | undefined,
  portalUser: PortalAuthUser | undefined,
  draftId: string
) {
  const authed = requireSupplier(supplier);
  if (!authed || !portalUser) {
    return { status: 401 as const, body: { error: "Not authenticated" } };
  }
  const pool = getOperationsPool();
  await ensureAsnDraftSchema(pool);
  const draft = await loadDraft(pool, authed.id, draftId);
  if (!draft) return { status: 404 as const, body: { error: "ASN draft not found" } };
  if (draft.status === "submitted") {
    return { status: 409 as const, body: { error: "This ASN has already been submitted." } };
  }

  const shipment = { ...draft.shipment, currentStep: 5 };
  const plates = await usedPlates(pool, draft.id);
  const issues = validateShipment(shipment, checksumOk(shipment), plates);
  const blocking = issues.filter((issue) => issue.blocking);
  if (blocking.length > 0) {
    return {
      status: 400 as const,
      body: { error: blocking[0].message, ...draftView(shipment, { issues }) }
    };
  }

  const result = await processSubmission(
    authed.id,
    {
      messageType: "DESADV",
      supplierCode: portalUser.mutually_defined_zz ?? "",
      tradingPartner: portalUser.company_mutually_defined_zz ?? "",
      payload: {
        ...shipment,
        usageIndicator: shipment.releases.every((release) => release.scheduleId === "test") ? "T" : "P"
      }
    },
    portalUser
  );

  if (result.success) {
    await saveDraft(pool, draft.id, shipment, "submitted");
    await pool.query(`UPDATE asn_drafts SET submitted_at = now() WHERE id = $1`, [draft.id]);
  }

  return {
    status: result.success ? 200 : 502,
    body: {
      ...result,
      id: draft.id,
      asnNumber: draft.asn_number,
      ...draftView(shipment, { issues })
    }
  };
}
