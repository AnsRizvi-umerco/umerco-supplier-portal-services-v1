import { statusCallbackSchema } from "@/schemas";
import { getOperationsPool } from "@/config/operations-db";

export async function handleStatusCallback(body: unknown) {
  const parsed = statusCallbackSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: "Invalid status callback payload" };
  }

  const callback = parsed.data;
  const pool = getOperationsPool();
  const updateValues = [
    callback.status,
    callback,
    callback.status === "error" ? (callback.errorDetail ?? "IWHI submission failed") : null,
    callback.messageId ?? null,
    new Date().toISOString()
  ];

  let submission: { id: string; supplier_id: string } | undefined;

  const primary = await pool.query<{ id: string; supplier_id: string }>(
    `UPDATE submissions
     SET status = $2,
         iwhi_response = $3,
         error_message = $4,
         iwhi_message_id = $5,
         last_callback_at = $6
     WHERE id = $1
     RETURNING id, supplier_id`,
    [callback.transactionId, ...updateValues]
  );

  submission = primary.rows[0];

  if (!submission) {
    const fallback = await pool.query<{ id: string; supplier_id: string }>(
      `UPDATE submissions
       SET status = $2,
           iwhi_response = $3,
           error_message = $4,
           iwhi_message_id = $5,
           last_callback_at = $6
       WHERE iwhi_transaction_id = $1
       RETURNING id, supplier_id`,
      [callback.transactionId, ...updateValues]
    );
    submission = fallback.rows[0];
  }

  if (submission) {
    await pool.query(
      `INSERT INTO audit_log (supplier_id, action, doc_ref, doc_type, details)
       VALUES ($1, 'status_callback_received', $2, NULL, $3)`,
      [submission.supplier_id, submission.id, callback]
    );
  }

  return { ok: true, status: 200 };
}
