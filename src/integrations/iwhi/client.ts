import { IWHI_CONFIG, type DocumentType } from "./config";
import { stringifyPayloadDeep } from "@/integrations/iwhi/stringify-payload";
import { buildInvoicChannelBody } from "@/integrations/iwhi/invoic-channel-body";
import { buildDesadvChannelBody } from "@/integrations/iwhi/desadv-channel-body";
import { buildAck855ChannelBody } from "@/integrations/iwhi/ack-855-channel-body";

export interface IwhiEnvelope {
  messageType: DocumentType;
  supplierCode: string;
  tradingPartner: string;
  payload: Record<string, unknown>;
  channelUrl: string;
  commsUsername: string;
  commsPassword: string;
  buyerId?: string;
  supplierPartyId?: string;
  controlNo?: string;
}

export interface IwhiResponse {
  success: boolean;
  messageId?: string;
  error?: string;
  statusCode: number;
  retryable: boolean;
  channelRequest?: {
    url: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
  };
}

function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function postWithRetry(
  url: string,
  body: string,
  headers: Record<string, string>,
  attempt: number = 1
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), IWHI_CONFIG.timeout);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);

    const shouldRetry = attempt < IWHI_CONFIG.retry.attempts;

    if (shouldRetry && isAbortError(error)) {
      await new Promise((r) => setTimeout(r, IWHI_CONFIG.retry.delayMs * attempt));
      return postWithRetry(url, body, headers, attempt + 1);
    }

    throw error;
  }
}

function isMockChannel(channelUrl: string): boolean {
  if (process.env.IWHI_MOCK?.trim().toLowerCase() === "true") return true;
  const value = channelUrl.trim().toLowerCase();
  return value === "mock" || value === "http://mock" || value === "https://mock";
}

function channelRequestPreview(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>
): NonNullable<IwhiResponse["channelRequest"]> {
  return {
    url,
    headers: {
      ...headers,
      Authorization: "Basic ***"
    },
    body
  };
}

function resolveChannelUrl(channelUrl: string): string | null {
  const stored = channelUrl.trim();
  if (!stored) return null;
  if (/^https:\/\//i.test(stored)) return stored;
  if (/^http:\/\//i.test(stored)) return `https://${stored.slice("http://".length)}`;
  return null;
}

/**
 * HTTPS POST the envelope to the supplier channel URL as text/plain.
 * Auth is HTTP Basic using communication credentials.
 */
export async function sendToIwhi(envelope: IwhiEnvelope): Promise<IwhiResponse> {
  const url = resolveChannelUrl(envelope.channelUrl);
  if (!url) {
    return {
      success: false,
      error: "Channel URL is missing or is not an absolute https URL.",
      statusCode: 400,
      retryable: false
    };
  }

  if (!envelope.commsUsername.trim() || !envelope.commsPassword.trim()) {
    return {
      success: false,
      error: "Communication credentials are required to send to the channel URL.",
      statusCode: 400,
      retryable: false
    };
  }

  const partyIds = {
    senderId: envelope.supplierCode,
    receiverId: envelope.tradingPartner,
    buyerId: envelope.buyerId?.trim() || envelope.tradingPartner,
    supplierPartyId: envelope.supplierPartyId?.trim() || envelope.supplierCode,
    controlNo: envelope.controlNo,
    payload: envelope.payload
  };

  const wireEnvelope =
    envelope.messageType === "INVOIC"
      ? buildInvoicChannelBody(partyIds)
      : envelope.messageType === "DESADV"
        ? buildDesadvChannelBody(partyIds)
        : envelope.messageType === "ORDRSP"
          ? buildAck855ChannelBody({ ...partyIds, includeSchedules: false })
          : envelope.messageType === "APERAK"
            ? buildAck855ChannelBody({ ...partyIds, includeSchedules: true })
            : {
                messageType: envelope.messageType,
                supplierCode: envelope.supplierCode,
                tradingPartner: envelope.tradingPartner,
                payload: stringifyPayloadDeep(envelope.payload) as Record<string, unknown>
              };
  const body = JSON.stringify(wireEnvelope);

  const headers: Record<string, string> = {
    "Content-Type": "text/plain",
    Authorization: basicAuthHeader(
      envelope.commsUsername.trim(),
      envelope.commsPassword.trim()
    )
  };

  const channelRequest = channelRequestPreview(url, headers, wireEnvelope);

  if (isMockChannel(url)) {
    console.log("[IWHI Mock] Would send:", {
      url: channelRequest.url,
      messageType: envelope.messageType,
      supplierCode: envelope.supplierCode,
      tradingPartner: envelope.tradingPartner
    });
    return {
      success: true,
      statusCode: 200,
      retryable: false,
      channelRequest
    };
  }

  try {
    const response = await postWithRetry(url, body, headers);
    const responseBody = await response.text();

    let parsed: Record<string, unknown> = {};
    try {
      parsed = responseBody ? JSON.parse(responseBody) : {};
    } catch {
      // Response might not be JSON
    }

    if (response.ok) {
      return {
        success: true,
        messageId: (parsed.messageId as string | undefined) || undefined,
        statusCode: response.status,
        retryable: false,
        channelRequest
      };
    }

    const retryable = response.status >= 500 || response.status === 429;
    return {
      success: false,
      error:
        (parsed.error as string | undefined) ||
        (parsed.message as string | undefined) ||
        `Channel returned ${response.status}`,
      statusCode: response.status,
      retryable,
      channelRequest
    };
  } catch (error) {
    const timedOut = isAbortError(error);
    return {
      success: false,
      error: timedOut
        ? `Channel timeout after ${IWHI_CONFIG.timeout}ms`
        : `Channel connection failed: ${error instanceof Error ? error.message : String(error)}`,
      statusCode: 0,
      retryable: true,
      channelRequest
    };
  }
}
