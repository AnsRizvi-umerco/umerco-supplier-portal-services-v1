import type { SubmitMessage } from "@/schemas";
import type { PortalAuthUser } from "@/middleware/auth";
import { sendToIwhi } from "@/integrations/iwhi";
import { createScheduleNotification } from "@/services/notifications.service";
import {
  createSubmission,
  finalizeSubmission,
  markScheduleOutboundSent,
  writeSubmissionAudit
} from "@/services/submissions/submission-repo";

function uniqueRefs(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const refs: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    refs.push(trimmed);
  }
  return refs;
}

function getReference(message: SubmitMessage) {
  switch (message.messageType) {
    case "DESADV":
      return {
        refNo: message.payload.asnRef,
        deljitRefs: uniqueRefs(message.payload.lines.map((line) => line.poNumber))
      };
    case "INVOIC":
      return { refNo: message.payload.invoiceNo, deljitRefs: uniqueRefs([message.payload.poReference]) };
    case "ORDRSP":
      return { refNo: message.payload.poReference, deljitRefs: uniqueRefs([message.payload.poReference]) };
    case "APERAK":
      return {
        refNo: message.payload.deljitReference,
        deljitRefs: uniqueRefs([message.payload.deljitReference])
      };
  }
}

function outboundNotice(messageType: SubmitMessage["messageType"], refNo: string, poRef: string) {
  if (messageType === "ORDRSP") {
    return {
      title: "PO Ack sent",
      body: `PO acknowledgement ${refNo} was sent for PO ${poRef}.`,
      tone: "success" as const
    };
  }
  if (messageType === "APERAK") {
    return {
      title: "Schedule Ack sent",
      body: `Schedule acknowledgement was sent for PO ${poRef}.`,
      tone: "success" as const
    };
  }
  if (messageType === "DESADV") {
    return {
      title: "ASN sent",
      body: `ASN ${refNo} was sent for PO ${poRef}.`,
      tone: "success" as const
    };
  }
  return {
    title: "Invoice sent",
    body: `Invoice ${refNo} was sent for PO ${poRef}.`,
    tone: "success" as const
  };
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
  const primaryPo = ref.deljitRefs[0];
  const created = await createSubmission({
    supplierId,
    companyId: portalUser.business_partner_id,
    message,
    refNo: ref.refNo,
    deljitRef: primaryPo
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

  if (result.success && ref.deljitRefs.length > 0) {
    const updatedById = new Map<string, { id: string; supplier_id: string; company_id: string | null }>();
    for (const poReference of ref.deljitRefs) {
      const updated = await markScheduleOutboundSent({
        supplierId,
        companyId: portalUser.business_partner_id,
        poReference,
        docType: message.messageType
      });
      for (const schedule of updated) {
        updatedById.set(schedule.id, schedule);
      }
    }

    const notice = outboundNotice(message.messageType, ref.refNo, primaryPo ?? ref.deljitRefs[0]);
    const updated = [...updatedById.values()];

    for (const schedule of updated) {
      await createScheduleNotification({
        supplierId: schedule.supplier_id,
        companyId: schedule.company_id ?? portalUser.business_partner_id,
        title: notice.title,
        body: notice.body,
        docRef: ref.refNo,
        docType: message.messageType,
        scheduleId: schedule.id,
        tone: notice.tone
      });
    }

    if (updated.length === 0) {
      await createScheduleNotification({
        supplierId,
        companyId: portalUser.business_partner_id,
        title: notice.title,
        body: notice.body,
        docRef: ref.refNo,
        docType: message.messageType,
        tone: notice.tone
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
