import { IWHI_CONFIG, getChannelPath, type DocumentType } from "./config";
import { stringifyPayloadDeep } from "@/integrations/iwhi/stringify-payload";

export interface IwhiEnvelope {
  messageType: DocumentType;
  supplierCode: string;
  tradingPartner: string;
  payload: Record<string, unknown>;
}

export interface IwhiResponse {
  success: boolean;
  messageId?: string;
  error?: string;
  statusCode: number;
  retryable: boolean;
}

function getAuthHeaders(): Record<string, string> {
  switch (IWHI_CONFIG.authType) {
    case "basic": {
      const username = process.env.IWHI_AUTH_USERNAME ?? "";
      const password = process.env.IWHI_AUTH_PASSWORD ?? "";
      const encoded = Buffer.from(`${username}:${password}`).toString("base64");
      return { Authorization: `Basic ${encoded}` };
    }
    case "bearer": {
      const token =
        process.env.IWHI_AUTH_TOKEN?.trim() ||
        process.env.IWHI_API_KEY?.trim() ||
        process.env.IWHI_AUTH_USERNAME?.trim();
      if (!token) return {};
      return { Authorization: `Bearer ${token}` };
    }
    case "certificate":
      return {};
    case "none":
      return {};
    default:
      return {};
  }
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

function isMockMode(): boolean {
  const base = IWHI_CONFIG.baseUrl;
  return !base || base.includes("localhost:3001") || base === "mock";
}

function mockResponse(): IwhiResponse {
  return {
    success: true,
    messageId: `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    statusCode: 200,
    retryable: false
  };
}

/**
 * Send a canonical JSON envelope to IWHI.
 * Handles auth, retries, timeouts, mock mode, and error classification.
 */
export async function sendToIwhi(envelope: IwhiEnvelope): Promise<IwhiResponse> {
  if (isMockMode()) {
    console.log("[IWHI Mock] Would send:", envelope.messageType, envelope.supplierCode);
    return mockResponse();
  }

  const channelPath = getChannelPath(envelope.messageType, envelope.tradingPartner);
  const url = `${IWHI_CONFIG.baseUrl}${channelPath}`;
  const instanceApiKey = process.env.IWHI_INSTANCE_API_KEY?.trim();
  const needsInstanceApiKey =
    envelope.messageType === "INVOIC" || envelope.messageType === "DESADV";

  if (needsInstanceApiKey && !instanceApiKey) {
    return {
      success: false,
      error: "Missing IWHI_INSTANCE_API_KEY for INVOIC or DESADV (ASN) submission",
      statusCode: 400,
      retryable: false
    };
  }

  const wireEnvelope: IwhiEnvelope = {
    ...envelope,
    payload: stringifyPayloadDeep(envelope.payload) as Record<string, unknown>
  };
  const body = JSON.stringify(wireEnvelope);

  const headers: Record<string, string> = {
    "Content-Type": "text/plain",
    ...getAuthHeaders(),
    ...(needsInstanceApiKey && instanceApiKey ? { "X-INSTANCE-API-KEY": instanceApiKey } : {})
  };

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
        messageId:
          (parsed.messageId as string | undefined) || response.headers.get("X-Message-Id") || undefined,
        statusCode: response.status,
        retryable: false
      };
    }

    const retryable = response.status >= 500 || response.status === 429;
    return {
      success: false,
      error:
        (parsed.error as string | undefined) ||
        (parsed.message as string | undefined) ||
        `IWHI returned ${response.status}`,
      statusCode: response.status,
      retryable
    };
  } catch (error) {
    const timedOut = isAbortError(error);
    return {
      success: false,
      error: timedOut
        ? `IWHI timeout after ${IWHI_CONFIG.timeout}ms`
        : `IWHI connection failed: ${error instanceof Error ? error.message : String(error)}`,
      statusCode: 0,
      retryable: true
    };
  }
}
