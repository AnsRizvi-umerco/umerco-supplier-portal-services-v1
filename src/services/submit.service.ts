import type { SupplierRow } from "@/middleware/auth";
import { submitMessageSchema } from "@/schemas/index";
import { processSubmission } from "@/services/submissions/submit-service";
import {
  getDeljitRefFromSubmitMessage,
  validateTradingPartnerAgainstSchedule
} from "@/services/submissions/validate-trading-partner";

export async function submitDocument(supplier: SupplierRow, body: unknown) {
  const parsed = submitMessageSchema.safeParse(body);
  if (!parsed.success) {
    return { status: 400 as const, body: { success: false, error: parsed.error.flatten() } };
  }

  if (parsed.data.supplierCode !== supplier.code) {
    return { status: 403 as const, body: { success: false, error: "Supplier code mismatch" } };
  }

  const deljitRef = getDeljitRefFromSubmitMessage(parsed.data);
  if (deljitRef) {
    const partnerCheck = await validateTradingPartnerAgainstSchedule(
      supplier.id,
      parsed.data.tradingPartner,
      deljitRef
    );
    if (!partnerCheck.ok) {
      return { status: 403 as const, body: { success: false, error: partnerCheck.error } };
    }
  }

  const result = await processSubmission(supplier.id, parsed.data);
  return { status: result.success ? 200 : 502, body: result };
}
