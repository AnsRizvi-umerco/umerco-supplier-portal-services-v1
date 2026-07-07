import { supabaseAdmin } from "@/integrations/supabase/admin";
import type { SubmitMessage } from "@/schemas";

export async function createSubmission(params: {
  supplierId: string;
  message: SubmitMessage;
  refNo: string;
  deljitRef?: string;
}) {
  const { data } = await supabaseAdmin
    .from("submissions")
    .insert({
      supplier_id: params.supplierId,
      doc_type: params.message.messageType,
      ref_no: params.refNo,
      deljit_ref: params.deljitRef ?? null,
      status: "pending",
      canonical_json: params.message
    })
    .select("id")
    .single();
  return data;
}

export async function finalizeSubmission(params: {
  submissionId?: string;
  ok: boolean;
  response?: unknown;
  error?: string;
  iwhiTransactionId?: string;
}) {
  if (!params.submissionId) return;
  await supabaseAdmin
    .from("submissions")
    .update({
      status: params.ok ? "submitted" : "error",
      iwhi_response: params.response ?? null,
      error_message: params.ok ? null : (params.error ?? "IWHI request failed"),
      iwhi_transaction_id: params.iwhiTransactionId ?? null,
      submitted_at: params.ok ? new Date().toISOString() : null
    })
    .eq("id", params.submissionId);
}

export async function writeSubmissionAudit(params: {
  supplierId: string;
  docType: string;
  docRef: string;
  request: unknown;
  response: unknown;
}) {
  await supabaseAdmin.from("audit_log").insert({
    supplier_id: params.supplierId,
    action: "submission_sent",
    doc_ref: params.docRef,
    doc_type: params.docType,
    details: {
      request: params.request,
      response: params.response
    }
  });
}
