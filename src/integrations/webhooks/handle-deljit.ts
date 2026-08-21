import { deljitMessageSchema } from "@/schemas";
import { getOperationsPool } from "@/config/operations-db";
import { ensureOperationsScopeSchema } from "@/config/operations-schema";
import { createScheduleNotification } from "@/services/notifications.service";

export async function handleDeljit(
  body: unknown,
  scope?: { companyId: string; supplierId: string }
) {
  const parsed = deljitMessageSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: "Invalid DELJIT payload" };
  }

  const { supplierCode, payload } = parsed.data;
  const pool = getOperationsPool();
  await ensureOperationsScopeSchema(pool);

  let supplierId = scope?.supplierId;
  let companyId = scope?.companyId;

  if (!supplierId) {
    const { rows: supplierRows } = await pool.query<{ id: string; company_id: string | null }>(
      "SELECT id, company_id FROM suppliers WHERE code = $1 LIMIT 1",
      [supplierCode]
    );
    supplierId = supplierRows[0]?.id;
    companyId = companyId || supplierRows[0]?.company_id || undefined;
  }

  if (!supplierId) {
    return { ok: true, status: 200 };
  }

  if (!companyId) {
    const { rows } = await pool.query<{ company_id: string | null }>(
      "SELECT company_id FROM suppliers WHERE id = $1 LIMIT 1",
      [supplierId]
    );
    companyId = rows[0]?.company_id ?? undefined;
  }

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
    [
      payload.deljitRef,
      supplierId,
      companyId ?? null,
      payload.periodStart,
      payload.periodEnd,
      payload.releaseDate ?? null,
      parsed.data
    ]
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
          line.partNo,
          line.description,
          line.qtyRequired,
          line.uom,
          line.deliverBy,
          line.facility
        ]
      );
    }
  }

  await pool.query(
    `INSERT INTO audit_log (supplier_id, action, doc_ref, doc_type, details)
     VALUES ($1, 'webhook_received', $2, 'DELJIT', $3)`,
    [supplierId, payload.deljitRef, { message: parsed.data }]
  );

  await createScheduleNotification({
    pool,
    supplierId,
    companyId,
    title: "Delivery schedule received",
    body: `DELJIT ${payload.deljitRef} is ready to review.`,
    docRef: payload.deljitRef,
    docType: "DELJIT",
    scheduleId: schedule?.id
  });

  return { ok: true, status: 200 };
}
