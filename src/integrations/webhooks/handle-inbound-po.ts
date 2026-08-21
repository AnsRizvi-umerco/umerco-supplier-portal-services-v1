import { inboundPurchaseOrderSchema } from "@/schemas/inbound-po";
import { getOperationsPool } from "@/config/operations-db";
import { ensureOperationsScopeSchema } from "@/config/operations-schema";
import { createScheduleNotification } from "@/services/notifications.service";

function toSqlDate(value: string): string {
  const trimmed = value.trim();
  if (/^\d{8}$/.test(trimmed)) {
    return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
  }
  return trimmed;
}

function toPositiveInt(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.max(1, Math.round(parsed));
}

export async function handleInboundPurchaseOrder(
  body: unknown,
  scope?: { companyId: string; supplierId: string }
): Promise<{ ok: boolean; status: 200 | 400; error?: string; ref?: string }> {
  const parsed = inboundPurchaseOrderSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400 as const, error: "Invalid 850 purchase order payload" };
  }

  const supplierId = scope?.supplierId;
  const companyId = scope?.companyId;
  if (!supplierId) {
    return { ok: false, status: 400 as const, error: "Supplier is required to store this order" };
  }

  const { payload } = parsed.data;
  const pool = getOperationsPool();
  await ensureOperationsScopeSchema(pool);

  const poDate = toSqlDate(payload.poDate);
  const deliveryDate = toSqlDate(payload.requestedDeliveryDate);
  const facility =
    payload.shipTo?.name?.trim() ||
    payload.shipTo?.id?.trim() ||
    payload.shipTo?.city?.trim() ||
    "SHIP-TO";

  const { rows: scheduleRows } = await pool.query<{ id: string }>(
    `INSERT INTO delivery_schedules (
       deljit_ref, supplier_id, company_id, period_start, period_end, release_date, status, canonical_json
     )
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
     ON CONFLICT (supplier_id, deljit_ref) DO UPDATE SET
       company_id = EXCLUDED.company_id,
       period_start = EXCLUDED.period_start,
       period_end = EXCLUDED.period_end,
       release_date = EXCLUDED.release_date,
       status = 'pending',
       canonical_json = EXCLUDED.canonical_json,
       received_at = now()
     RETURNING id`,
    [payload.poNumber, supplierId, companyId ?? null, poDate, deliveryDate, poDate, body]
  );

  const schedule = scheduleRows[0];
  if (schedule) {
    await pool.query("DELETE FROM schedule_lines WHERE schedule_id = $1", [schedule.id]);

    for (const line of payload.lines) {
      await pool.query(
        `INSERT INTO schedule_lines (
           schedule_id, part_no, description, qty_required, uom, deliver_by, facility
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          schedule.id,
          line.itemCode,
          line.description,
          toPositiveInt(line.quantity),
          line.uom,
          deliveryDate,
          facility
        ]
      );
    }
  }

  await pool.query(
    `INSERT INTO audit_log (supplier_id, action, doc_ref, doc_type, details)
     VALUES ($1, 'webhook_received', $2, '850', $3)`,
    [supplierId, payload.poNumber, { message: body }]
  );

  await createScheduleNotification({
    pool,
    supplierId,
    companyId,
    title: "Purchase order received",
    body: payload.buyerName
      ? `PO ${payload.poNumber} from ${payload.buyerName} is ready to review.`
      : `PO ${payload.poNumber} is ready to review.`,
    docRef: payload.poNumber,
    docType: "850",
    scheduleId: schedule?.id
  });

  return { ok: true, status: 200 as const, ref: payload.poNumber };
}
