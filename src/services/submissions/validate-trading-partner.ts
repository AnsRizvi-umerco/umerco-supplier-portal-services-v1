import type { SubmitMessage } from "@/schemas";
import { supabaseAdmin } from "@/integrations/supabase/admin";

export function getDeljitRefFromSubmitMessage(message: SubmitMessage): string | undefined {
  switch (message.messageType) {
    case "APERAK": {
      const ref = message.payload.deljitReference.trim();
      return ref || undefined;
    }
    case "INVOIC": {
      const ref = message.payload.deljitReference.trim();
      return ref || undefined;
    }
    default:
      return undefined;
  }
}

export async function validateTradingPartnerAgainstSchedule(
  supplierId: string,
  tradingPartner: string,
  deljitRef: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: schedule, error } = await supabaseAdmin
    .from("delivery_schedules")
    .select("canonical_json")
    .eq("deljit_ref", deljitRef)
    .eq("supplier_id", supplierId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: "Could not verify trading partner against schedule" };
  }
  if (!schedule) {
    return { ok: false, error: "Schedule not found for deljit reference" };
  }

  const canonical = schedule.canonical_json;
  const expectedPartner =
    canonical && typeof canonical === "object" && "tradingPartner" in canonical
      ? String((canonical as { tradingPartner: unknown }).tradingPartner ?? "")
      : "";

  if (!expectedPartner || tradingPartner !== expectedPartner) {
    return { ok: false, error: "Trading partner mismatch" };
  }

  return { ok: true };
}
