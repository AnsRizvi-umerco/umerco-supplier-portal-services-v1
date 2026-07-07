import { IWHI_CONFIG, verifyWebhookSignature } from "@/integrations/iwhi/index";
import { handleDeljit } from "@/integrations/webhooks/handle-deljit";
import { handleStatusCallback } from "@/integrations/webhooks/handle-status-callback";

export async function processIwhiWebhook(rawBody: string, signature: string | undefined) {
  if (IWHI_CONFIG.webhook.secret) {
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
    if (
      payload &&
      typeof payload === "object" &&
      "messageType" in payload &&
      (payload as { messageType: string }).messageType === "DELJIT"
    ) {
      const result = await handleDeljit(payload);
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
