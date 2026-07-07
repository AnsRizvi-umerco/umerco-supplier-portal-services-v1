import type { SupabaseClient, User } from "@supabase/supabase-js";
import { z } from "zod";
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

export async function getSettings(user: User, supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("suppliers")
    .select(SETTINGS_SELECT)
    .eq("auth_user_id", user.id)
    .single();

  if (error || !data) {
    return { status: 500 as const, body: { error: error?.message ?? "Supplier not found" } };
  }
  return { status: 200 as const, body: { ...data, authEmail: user.email ?? "" } };
}

export async function patchSettings(user: User, supabase: SupabaseClient, body: unknown) {
  const parsed = settingsPatchSchema.safeParse(body);
  if (!parsed.success) {
    return { status: 400 as const, body: { error: parsed.error.flatten() } };
  }

  const { data, error } = await supabase
    .from("suppliers")
    .update(parsed.data)
    .eq("auth_user_id", user.id)
    .select(SETTINGS_SELECT)
    .single();

  if (error || !data) {
    return { status: 500 as const, body: { error: error?.message ?? "Update failed" } };
  }
  return { status: 200 as const, body: { ...data, authEmail: user.email ?? "" } };
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
