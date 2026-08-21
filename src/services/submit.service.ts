import type { PortalAuthUser, SupplierRow } from "@/middleware/auth";
import { submitMessageSchema } from "@/schemas/index";
import { processSubmission } from "@/services/submissions/submit-service";
import {
  getDeljitRefFromSubmitMessage,
  validateTradingPartnerAgainstSchedule
} from "@/services/submissions/validate-trading-partner";

function missingFieldError(field: string) {
  return {
    status: 400 as const,
    body: { success: false, error: `${field} is required to send to the channel URL.` }
  };
}

export async function submitDocument(
  supplier: SupplierRow,
  portalUser: PortalAuthUser,
  body: unknown
) {
  const parsed = submitMessageSchema.safeParse(body);
  if (!parsed.success) {
    return { status: 400 as const, body: { success: false, error: parsed.error.flatten() } };
  }

  if (portalUser.actor === "supplier" && portalUser.document_types.length > 0) {
    const allowed = portalUser.document_types ?? [];
    if (!allowed.includes(parsed.data.messageType)) {
      return {
        status: 403 as const,
        body: {
          success: false,
          error: `${parsed.data.messageType} is not enabled for this supplier.`
        }
      };
    }
  }

  if (!portalUser.channel_url?.trim()) {
    return missingFieldError("Channel URL");
  }
  if (!portalUser.comms_username?.trim() || !portalUser.comms_password?.trim()) {
    return missingFieldError("Communication credentials");
  }
  if (!portalUser.mutually_defined_zz?.trim()) {
    return missingFieldError("Supplier Mutually Defined");
  }
  if (!portalUser.company_mutually_defined_zz?.trim()) {
    return missingFieldError("Company Mutually Defined");
  }

  const deljitRef = getDeljitRefFromSubmitMessage(parsed.data);
  if (deljitRef && deljitRef !== "DELJIT-TEST") {
    const partnerCheck = await validateTradingPartnerAgainstSchedule(
      supplier.id,
      parsed.data.tradingPartner,
      deljitRef
    );
    if (!partnerCheck.ok) {
      return { status: 403 as const, body: { success: false, error: partnerCheck.error } };
    }
  }

  const result = await processSubmission(supplier.id, parsed.data, portalUser);
  return { status: result.success ? 200 : 502, body: result };
}
