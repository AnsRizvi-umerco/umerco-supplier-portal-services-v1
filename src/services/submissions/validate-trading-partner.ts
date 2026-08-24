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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value != null ? String(value).trim() : "";
}

/** Partner codes stored on DELJIT or inbound 850 schedules. */
function partnerIdsFromCanonical(canonical: unknown): string[] {
  const root = asRecord(canonical);
  if (!root) return [];

  const interchange = asRecord(root.interchange) ?? {};
  const payload = asRecord(root.payload) ?? {};
  const ids = [
    text(root.tradingPartner),
    text(interchange.senderId),
    text(interchange.receiverId),
    text(payload.buyerId),
    text(payload.vendorId)
  ].filter(Boolean);

  return [...new Set(ids)];
}

export async function validateTradingPartnerAgainstSchedule(
  supplierId: string,
  tradingPartner: string,
  deljitRef: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const submitted = tradingPartner.trim();
  if (!submitted) {
    return { ok: false, error: "Trading partner is required" };
  }

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

    const expected = partnerIdsFromCanonical(schedule.canonical_json);
    // Inbound 850s have no top-level tradingPartner; skip if we cannot compare.
    if (expected.length === 0) return { ok: true };

    const submittedLower = submitted.toLowerCase();
    if (expected.some((id) => id.toLowerCase() === submittedLower)) {
      return { ok: true };
    }

    return { ok: false, error: "Trading partner mismatch" };
  } catch {
    return { ok: false, error: "Could not verify trading partner against schedule" };
  }
}
