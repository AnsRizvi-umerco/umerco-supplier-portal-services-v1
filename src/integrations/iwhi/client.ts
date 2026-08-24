import tls from "node:tls";
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

type ChannelHttpResponse = {
  status: number;
  text: string;
};

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function decodeChunkedBody(body: string): string {
  let remaining = body;
  let out = "";
  while (remaining.length) {
    const lineEnd = remaining.indexOf("\r\n");
    if (lineEnd < 0) break;
    const size = parseInt(remaining.slice(0, lineEnd), 16);
    if (!Number.isFinite(size) || size <= 0) break;
    const start = lineEnd + 2;
    out += remaining.slice(start, start + size);
    remaining = remaining.slice(start + size + 2);
  }
  return out;
}

function parseHttpResponse(raw: string): ChannelHttpResponse {
  const split = raw.includes("\r\n\r\n") ? raw.indexOf("\r\n\r\n") : raw.indexOf("\n\n");
  const headerPart = split >= 0 ? raw.slice(0, split) : raw;
  const bodyPart = split >= 0 ? raw.slice(split + (raw.includes("\r\n\r\n") ? 4 : 2)) : "";
  const status = Number((headerPart.split(/\r?\n/)[0] ?? "").split(" ")[1] || 0);
  const text = /transfer-encoding:\s*chunked/i.test(headerPart)
    ? decodeChunkedBody(bodyPart)
    : bodyPart;
  return { status, text };
}

function postChannel(
  url: string,
  body: string,
  headers: Record<string, string>
): Promise<ChannelHttpResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = Buffer.from(body, "utf8");
    const host = parsed.hostname;
    const path = `${parsed.pathname}${parsed.search}`;
    // HTTP/1.1 bytes so IBM receives `messageType` exactly — HTTP/2 would lowercase it.
    const head = [
      `POST ${path} HTTP/1.1`,
      `Host: ${host}`,
      "Content-Type: text/plain",
      `messageType: ${headers.messageType}`,
      `Authorization: ${headers.Authorization}`,
      `Content-Length: ${payload.length}`,
      "Connection: close",
      "",
      ""
    ].join("\r\n");

    const socket = tls.connect(
      {
        host,
        port: Number(parsed.port || 443),
        servername: host,
        ALPNProtocols: ["http/1.1"]
      },
      () => {
        socket.write(head);
        socket.write(payload);
      }
    );

    const chunks: Buffer[] = [];
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("end", () => {
      resolve(parseHttpResponse(Buffer.concat(chunks).toString("utf8")));
    });
    socket.on("error", reject);
    socket.setTimeout(IWHI_CONFIG.timeout, () => {
      const timeout = new Error("The operation was aborted");
      timeout.name = "AbortError";
      socket.destroy(timeout);
    });
  });
}

async function postWithRetry(
  url: string,
  body: string,
  headers: Record<string, string>,
  attempt: number = 1
): Promise<ChannelHttpResponse> {
  try {
    return await postChannel(url, body, headers);
  } catch (error) {
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
      "Content-Type": headers["Content-Type"] ?? "text/plain",
      messageType: headers.messageType,
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

function channelMessageTypeHeader(messageType: DocumentType): string {
  if (messageType === "DESADV") return "ASN";
  if (messageType === "ORDRSP" || messageType === "APERAK") return "ACK";
  return messageType;
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
    messageType: channelMessageTypeHeader(envelope.messageType),
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
    const responseBody = response.text;

    let parsed: Record<string, unknown> = {};
    try {
      parsed = responseBody ? JSON.parse(responseBody) : {};
    } catch {
      // Response might not be JSON
    }

    if (response.status >= 200 && response.status < 300) {
      return {
        success: true,
        messageId: (parsed.messageId as string | undefined) || undefined,
        statusCode: response.status,
        retryable: false,
        channelRequest
      };
    }

    const retryable = response.status >= 500 || response.status === 429;
    const snippet = responseBody.replace(/\s+/g, " ").trim().slice(0, 240);
    return {
      success: false,
      error:
        (parsed.error as string | undefined) ||
        (parsed.message as string | undefined) ||
        `Channel returned ${response.status}${snippet ? `: ${snippet}` : ""}`,
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
