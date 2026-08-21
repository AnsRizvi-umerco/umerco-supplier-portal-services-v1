import type { SubmitMessage } from "@/schemas";
import { getOperationsPool } from "@/config/operations-db";

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
  try {
    const { rows } = await getOperationsPool().query<{ canonical_json: unknown }>(
      `SELECT canonical_json
       FROM delivery_schedules
       WHERE deljit_ref = $1 AND supplier_id = $2
       LIMIT 1`,
      [deljitRef, supplierId]
    );

    const schedule = rows[0];
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
  } catch {
    return { ok: false, error: "Could not verify trading partner against schedule" };
  }
}
