import type { SubmitMessage } from "@/schemas";
import type { PortalAuthUser } from "@/middleware/auth";
import { sendToIwhi } from "@/integrations/iwhi";
import { createScheduleNotification } from "@/services/notifications.service";
import {
  createSubmission,
  finalizeSubmission,
  markScheduleInvoiceSent,
  writeSubmissionAudit
} from "@/services/submissions/submission-repo";

function getReference(message: SubmitMessage) {
  switch (message.messageType) {
    case "DESADV":
      return { refNo: message.payload.asnRef, deljitRef: undefined };
    case "INVOIC":
      return { refNo: message.payload.invoiceNo, deljitRef: message.payload.poReference };
    case "ORDRSP":
      return { refNo: message.payload.poReference, deljitRef: undefined };
    case "APERAK":
      return { refNo: message.payload.deljitReference, deljitRef: message.payload.deljitReference };
  }
}

function required(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export async function processSubmission(
  supplierId: string,
  message: SubmitMessage,
  portalUser: PortalAuthUser
) {
  const ref = getReference(message);
  const created = await createSubmission({
    supplierId,
    companyId: portalUser.business_partner_id,
    message,
    refNo: ref.refNo,
    deljitRef: ref.deljitRef
  });

  const supplierCode = required(portalUser.mutually_defined_zz);
  const tradingPartner = required(portalUser.company_mutually_defined_zz);
  const channelUrl = required(portalUser.channel_url);
  const commsUsername = required(portalUser.comms_username);
  const commsPassword = required(portalUser.comms_password);

  const result = await sendToIwhi({
    messageType: message.messageType,
    supplierCode,
    tradingPartner,
    payload: { ...(message.payload as Record<string, unknown>) },
    channelUrl,
    commsUsername,
    commsPassword,
    buyerId: required(portalUser.company_duns) || tradingPartner,
    supplierPartyId: required(portalUser.duns) || supplierCode,
    controlNo: created?.id
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
    request: {
      messageType: message.messageType,
      supplierCode,
      tradingPartner,
      payload: message.payload
    },
    response: responsePayload
  });

  if (result.success && message.messageType === "INVOIC" && ref.deljitRef) {
    const updated = await markScheduleInvoiceSent({
      supplierId,
      companyId: portalUser.business_partner_id,
      poReference: ref.deljitRef
    });

    for (const schedule of updated) {
      await createScheduleNotification({
        supplierId: schedule.supplier_id,
        companyId: schedule.company_id ?? portalUser.business_partner_id,
        title: "Invoice sent",
        body: `Invoice ${ref.refNo} was sent for PO ${ref.deljitRef}.`,
        docRef: ref.refNo,
        docType: "INVOIC",
        scheduleId: schedule.id,
        tone: "success"
      });
    }

    if (updated.length === 0) {
      await createScheduleNotification({
        supplierId,
        companyId: portalUser.business_partner_id,
        title: "Invoice sent",
        body: `Invoice ${ref.refNo} was sent for PO ${ref.deljitRef}.`,
        docRef: ref.refNo,
        docType: "INVOIC",
        tone: "success"
      });
    }
  }

  return {
    success: result.success,
    submissionId: created?.id ?? null,
    messageId: result.messageId ?? null,
    error: result.success ? null : result.error,
    channelRequest: result.channelRequest ?? null
  };
}
