/** Resolve base URL: prefer IWHI_BASE_URL; fall back to https://IWHI_HOST for migration from legacy env. */
export function getIwhiBaseUrl(): string {
  const explicit = process.env.IWHI_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const host = process.env.IWHI_HOST?.trim();
  if (host) {
    const h = host.replace(/^https?:\/\//, "");
    return `https://${h}`;
  }
  return "";
}

/** Override keys: `docType:partner`, `docType`, or `partner` → path. */
export const CHANNEL_ROUTES: Record<string, string> = {
  INVOIC: process.env.IWHI_INVOIC_CHANNEL_PATH?.trim() || "",
  APERAK: process.env.IWHI_APERAK_CHANNEL_PATH?.trim() || "",
  ORDRSP: process.env.IWHI_ORDRSP_CHANNEL_PATH?.trim() || "",
  DESADV: process.env.IWHI_DESADV_CHANNEL_PATH?.trim() || "",
  DELJIT: process.env.IWHI_DELJIT_CHANNEL_PATH?.trim() || ""
};

export const IWHI_CONFIG = {
  get baseUrl() {
    return getIwhiBaseUrl();
  },
  get authType() {
    return (process.env.IWHI_AUTH_TYPE?.trim().toLowerCase() || "bearer") as
      | "basic"
      | "bearer"
      | "certificate"
      | "none";
  },
  get timeout() {
    return parseInt(process.env.IWHI_TIMEOUT_MS || "15000", 10);
  },
  retry: {
    get attempts() {
      return parseInt(process.env.IWHI_RETRY_ATTEMPTS || "3", 10);
    },
    get delayMs() {
      return parseInt(process.env.IWHI_RETRY_DELAY_MS || "2000", 10);
    }
  },
  webhook: {
    get secret() {
      return process.env.IWHI_WEBHOOK_SECRET?.trim() ?? "";
    },
    get signatureHeader() {
      return process.env.IWHI_WEBHOOK_SIGNATURE_HEADER?.trim() || "X-IWHI-Signature";
    }
  }
} as const;

export type DocumentType = "INVOIC" | "DESADV" | "ORDRSP" | "APERAK" | "DELJIT";

export const TRADING_PARTNERS = {
  buyers: {
    "Demo-Partner": { name: "Demo Partner", ediVersion: "D96A", active: true },
    "Haroon-Motors": { name: "Haroon Motors", ediVersion: "D96A", active: true }
  },
  suppliers: {
    "XYZ-PARTS": { name: "XYZ Parts", active: true }
  }
} as const;

export function getChannelPath(docType: string, tradingPartner: string): string {
  const routes = CHANNEL_ROUTES;
  const specificRoute = routes[`${docType}:${tradingPartner}`];
  const docRoute = routes[docType];
  const partnerRoute = routes[tradingPartner];
  const resolvedRoute = specificRoute || docRoute || partnerRoute;
  if (!resolvedRoute) {
    throw new Error(
      `Missing IWHI channel mapping for docType="${docType}" tradingPartner="${tradingPartner}". ` +
        "Set a document-specific env var (for example IWHI_INVOIC_CHANNEL_PATH) or a CHANNEL_ROUTES override."
    );
  }
  return resolvedRoute;
}
