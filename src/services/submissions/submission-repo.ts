import { getOperationsPool } from "@/config/operations-db";
import { ensureScheduleStatusConstraint } from "@/config/operations-schema";
import type { SubmitMessage } from "@/schemas";

export async function createSubmission(params: {
  supplierId: string;
  companyId: string;
  message: SubmitMessage;
  refNo: string;
  deljitRef?: string;
}) {
  const { rows } = await getOperationsPool().query<{ id: string }>(
    `INSERT INTO submissions (
       supplier_id, company_id, doc_type, ref_no, deljit_ref, status, canonical_json
     )
     VALUES ($1, $2, $3, $4, $5, 'pending', $6)
     RETURNING id`,
    [
      params.supplierId,
      params.companyId,
      params.message.messageType,
      params.refNo,
      params.deljitRef ?? null,
      params.message
    ]
  );
  return rows[0] ?? null;
}

export async function finalizeSubmission(params: {
  submissionId?: string;
  ok: boolean;
  response?: unknown;
  error?: string;
  iwhiTransactionId?: string;
}) {
  if (!params.submissionId) return;

  await getOperationsPool().query(
    `UPDATE submissions
     SET status = $2,
         iwhi_response = $3,
         error_message = $4,
         iwhi_transaction_id = $5,
         submitted_at = $6
     WHERE id = $1`,
    [
      params.submissionId,
      params.ok ? "submitted" : "error",
      params.response ?? null,
      params.ok ? null : (params.error ?? "IWHI request failed"),
      params.iwhiTransactionId ?? null,
      params.ok ? new Date().toISOString() : null
    ]
  );
}

export async function markScheduleOutboundSent(params: {
  supplierId: string;
  companyId: string;
  poReference: string;
  docType: SubmitMessage["messageType"];
}): Promise<Array<{ id: string; supplier_id: string; company_id: string | null }>> {
  const poReference = params.poReference.trim();
  if (!poReference) return [];

  try {
    const pool = getOperationsPool();
    await ensureScheduleStatusConstraint(pool);

    const { rows } = await pool.query<{
      id: string;
      supplier_id: string;
      company_id: string | null;
    }>(
      `UPDATE delivery_schedules
       SET status = CASE
         WHEN $4 = 'INVOIC' THEN 'invoice_sent'
         WHEN $4 IN ('ORDRSP', 'APERAK') AND status NOT IN ('invoice_sent', 'completed')
           THEN 'acknowledged'
         ELSE status
       END
       WHERE deljit_ref = $1
         AND (
           supplier_id = $2
           OR company_id = $3
         )
       RETURNING id, supplier_id, company_id`,
      [poReference, params.supplierId, params.companyId, params.docType]
    );

    return rows;
  } catch (error) {
    console.error("Failed to mark schedule outbound sent:", error);
    return [];
  }
}

export async function markScheduleInvoiceSent(params: {
  supplierId: string;
  companyId: string;
  poReference: string;
}): Promise<Array<{ id: string; supplier_id: string; company_id: string | null }>> {
  return markScheduleOutboundSent({ ...params, docType: "INVOIC" });
}

export async function writeSubmissionAudit(params: {
  supplierId: string;
  docType: string;
  docRef: string;
  request: unknown;
  response: unknown;
}) {
  await getOperationsPool().query(
    `INSERT INTO audit_log (supplier_id, action, doc_ref, doc_type, details)
     VALUES ($1, 'submission_sent', $2, $3, $4)`,
    [
      params.supplierId,
      params.docRef,
      params.docType,
      {
        request: params.request,
        response: params.response
      }
    ]
  );
}
