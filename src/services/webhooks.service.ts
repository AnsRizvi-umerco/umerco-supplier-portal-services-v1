import { IWHI_CONFIG, verifyWebhookSignature } from "@/integrations/iwhi/index";
import { handleDeljit } from "@/integrations/webhooks/handle-deljit";
import { handleInboundPurchaseOrder } from "@/integrations/webhooks/handle-inbound-po";
import { handleStatusCallback } from "@/integrations/webhooks/handle-status-callback";
import { isInboundPurchaseOrder } from "@/schemas/inbound-po";

export async function processIwhiWebhook(
  rawBody: string,
  signature: string | undefined,
  options?: { skipSignature?: boolean; companyId?: string; supplierId?: string }
) {
  if (!options?.skipSignature && IWHI_CONFIG.webhook.secret) {
    if (!verifyWebhookSignature(rawBody, signature ?? null)) {
      return { status: 401 as const, body: { error: "Invalid signature" } };
    }
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 200 as const, body: { received: true, error: "Invalid JSON" } };
  }

  try {
    if (isInboundPurchaseOrder(payload)) {
      const result = await handleInboundPurchaseOrder(
        payload,
        options?.companyId && options?.supplierId
          ? { companyId: options.companyId, supplierId: options.supplierId }
          : undefined
      );
      return {
        status: result.ok ? (200 as const) : (400 as const),
        body: { received: result.ok, ok: result.ok, error: result.error ?? null, ref: result.ref ?? null }
      };
    }

    if (
      payload &&
      typeof payload === "object" &&
      "messageType" in payload &&
      (payload as { messageType: string }).messageType === "DELJIT"
    ) {
      const result = await handleDeljit(
        payload,
        options?.companyId && options?.supplierId
          ? { companyId: options.companyId, supplierId: options.supplierId }
          : undefined
      );
      return {
        status: 200 as const,
        body: { received: true, ok: result.ok, error: result.error ?? null }
      };
    }

    const callbackResult = await handleStatusCallback(payload);
    return {
      status: 200 as const,
      body: { received: true, ok: callbackResult.ok, error: callbackResult.error ?? null }
    };
  } catch (error) {
    console.error("[Webhook Error]", error);
    return { status: 200 as const, body: { received: true, error: "Processing failed" } };
  }
}
