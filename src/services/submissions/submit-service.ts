import type { SubmitMessage } from "@/schemas";
import { sendToIwhi } from "@/integrations/iwhi";
import { createSubmission, finalizeSubmission, writeSubmissionAudit } from "@/services/submissions/submission-repo";

function getReference(message: SubmitMessage) {
  switch (message.messageType) {
    case "DESADV":
      return { refNo: message.payload.asnRef, deljitRef: undefined };
    case "INVOIC":
      return { refNo: message.payload.invoiceNo, deljitRef: undefined };
    case "ORDRSP":
      return { refNo: message.payload.poReference, deljitRef: undefined };
    case "APERAK":
      return { refNo: message.payload.deljitReference, deljitRef: message.payload.deljitReference };
  }
}

export async function processSubmission(supplierId: string, message: SubmitMessage) {
  const ref = getReference(message);
  const created = await createSubmission({
    supplierId,
    message,
    refNo: ref.refNo,
    deljitRef: ref.deljitRef
  });

  const result = await sendToIwhi({
    messageType: message.messageType,
    supplierCode: message.supplierCode,
    tradingPartner: message.tradingPartner,
    payload: message.payload as Record<string, unknown>
  });

  const responsePayload = result.success
    ? { messageId: result.messageId, statusCode: result.statusCode }
    : { error: result.error, statusCode: result.statusCode, retryable: result.retryable };

  await finalizeSubmission({
    submissionId: created?.id,
    ok: result.success,
    response: responsePayload,
    error: result.error,
    iwhiTransactionId: created?.id
  });

  await writeSubmissionAudit({
    supplierId,
    docType: message.messageType,
    docRef: ref.refNo,
    request: message,
    response: responsePayload
  });

  return {
    success: result.success,
    submissionId: created?.id ?? null,
    messageId: result.messageId ?? null,
    error: result.success ? null : result.error
  };
}
