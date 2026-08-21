import { z } from "zod";
import type { PortalAuthUser } from "@/middleware/auth";
import { getOperationsPool } from "@/config/operations-db";
import { TRADING_PARTNERS, getIwhiBaseUrl } from "@/integrations/iwhi/config";

const SETTINGS_SELECT =
  "id, code, name, email, language, status, phone, notification_email, deljit_email_alerts, default_currency, default_incoterm, default_payment_terms, default_facility, default_uom, default_transport_mode, default_carrier, default_response_code";

export const settingsPatchSchema = z.object({
  name: z.string().max(100).optional(),
  phone: z.string().max(100).optional(),
  notification_email: z.string().email().max(100).optional().or(z.literal("")),
  deljit_email_alerts: z.boolean().optional(),
  default_currency: z.string().max(100).optional(),
  default_incoterm: z.string().max(100).optional(),
  default_payment_terms: z.string().max(100).optional(),
  default_facility: z.string().max(100).optional(),
  default_uom: z.string().max(100).optional(),
  default_transport_mode: z.string().max(100).optional(),
  default_carrier: z.string().max(100).optional(),
  default_response_code: z.string().max(100).optional()
});

const OUTBOUND_TYPES = ["APERAK", "ORDRSP", "DESADV", "INVOIC"] as const;

const PATCHABLE_COLUMNS = [
  "name",
  "phone",
  "notification_email",
  "deljit_email_alerts",
  "default_currency",
  "default_incoterm",
  "default_payment_terms",
  "default_facility",
  "default_uom",
  "default_transport_mode",
  "default_carrier",
  "default_response_code"
] as const;

export async function getSettings(portalUser: PortalAuthUser, supplierId: string) {
  try {
    const { rows } = await getOperationsPool().query<Record<string, unknown>>(
      `SELECT ${SETTINGS_SELECT} FROM suppliers WHERE id = $1 LIMIT 1`,
      [supplierId]
    );

    const data = rows[0];
    if (!data) {
      return { status: 500 as const, body: { error: "Supplier not found" } };
    }
    return { status: 200 as const, body: { ...data, authEmail: portalUser.email ?? "" } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load settings";
    return { status: 500 as const, body: { error: message } };
  }
}

export async function patchSettings(
  portalUser: PortalAuthUser,
  supplierId: string,
  body: unknown
) {
  const parsed = settingsPatchSchema.safeParse(body);
  if (!parsed.success) {
    return { status: 400 as const, body: { error: parsed.error.flatten() } };
  }

  const updates = parsed.data;
  const setClauses: string[] = [];
  const values: unknown[] = [supplierId];
  let paramIndex = 2;

  for (const column of PATCHABLE_COLUMNS) {
    if (column in updates) {
      setClauses.push(`${column} = $${paramIndex}`);
      values.push(updates[column as keyof typeof updates]);
      paramIndex += 1;
    }
  }

  if (setClauses.length === 0) {
    return getSettings(portalUser, supplierId);
  }

  try {
    const { rows } = await getOperationsPool().query<Record<string, unknown>>(
      `UPDATE suppliers
       SET ${setClauses.join(", ")}
       WHERE id = $1
       RETURNING ${SETTINGS_SELECT}`,
      values
    );

    const data = rows[0];
    if (!data) {
      return { status: 500 as const, body: { error: "Update failed" } };
    }
    return { status: 200 as const, body: { ...data, authEmail: portalUser.email ?? "" } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Update failed";
    return { status: 500 as const, body: { error: message } };
  }
}

export function getIntegrationStatus() {
  const baseUrl = getIwhiBaseUrl();
  const iwhi_mode =
    !baseUrl || baseUrl.toLowerCase() === "mock" || baseUrl.includes("localhost") ? "mock" : "live";

  return {
    status: 200 as const,
    body: {
      iwhi_mode,
      sendgrid_configured: Boolean(process.env.SENDGRID_API_KEY?.trim()),
      webhook_secret_configured: Boolean(process.env.IWHI_WEBHOOK_SECRET?.trim()),
      iwhi_url_preview: baseUrl ? `${baseUrl.slice(0, 20)}...` : "Not set"
    }
  };
}

export function getTradingPartners() {
  const buyers = Object.entries(TRADING_PARTNERS.buyers)
    .filter(([, value]) => value.active)
    .map(([key, value]) => ({
      key,
      name: value.name,
      ediVersion: value.ediVersion,
      documentTypes: [...OUTBOUND_TYPES]
    }));

  return { status: 200 as const, body: { buyers } };
}
