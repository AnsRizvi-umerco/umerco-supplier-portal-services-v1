import { stringifyPayloadDeep } from "@/integrations/iwhi/stringify-payload";

type InvoiceLineIn = {
  poLine?: unknown;
  partNo?: unknown;
  description?: unknown;
  qty?: unknown;
  uom?: unknown;
  lineTotal?: unknown;
};

function asString(value: unknown, fallback = ""): string {
  if (value == null) return fallback;
  return String(value).trim();
}

function money(value: unknown): string {
  const n = Number(asString(value, "0"));
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

function invoiceTypeCode(invoiceType: string): string {
  const value = invoiceType.trim().toUpperCase();
  if (value === "CREDIT" || value === "381") return "381";
  if (value === "DEBIT" || value === "383") return "383";
  if (/^\d{3}$/.test(value)) return value;
  return "380";
}

function mapUom(uom: string): string {
  const value = uom.trim().toUpperCase();
  if (value === "EA" || value === "EACH") return "PCE";
  return value || "PCE";
}

function padControlNo(value: string): string {
  const digits = value.replace(/\D/g, "").slice(-9);
  return digits.padStart(9, "0") || "000000001";
}

function interchangeStamp(documentDate: string): { date: string; time: string } {
  const now = new Date();
  const yymmdd =
    /^\d{8}$/.test(documentDate) ? documentDate.slice(2) : now.toISOString().slice(2, 10).replace(/-/g, "");
  const time = `${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}`;
  return { date: yymmdd, time };
}

function lineTaxAmount(lineAmount: string, taxRate: string): string {
  const amount = Number(lineAmount);
  const rate = Number(taxRate);
  if (!Number.isFinite(amount) || !Number.isFinite(rate)) return "0.00";
  return ((amount * rate) / 100).toFixed(2);
}

export function buildInvoicChannelBody(input: {
  senderId: string;
  receiverId: string;
  buyerId: string;
  supplierPartyId: string;
  controlNo?: string;
  payload: Record<string, unknown>;
}): Record<string, unknown> {
  const payload = input.payload;
  const documentDate = asString(payload.invoiceDate);
  const stamp = interchangeStamp(documentDate);
  const taxRate = asString(payload.taxRate, "0");
  const rawLines = Array.isArray(payload.lines) ? (payload.lines as InvoiceLineIn[]) : [];

  const lines = rawLines.map((line, index) => {
    const lineAmount = money(line.lineTotal);
    return {
      lineNo: asString(line.poLine, String(index + 1)),
      itemCode: asString(line.partNo),
      description: asString(line.description),
      quantity: asString(line.qty),
      uom: mapUom(asString(line.uom, "PCE")),
      lineAmount,
      taxType: "VAT",
      taxRate,
      taxAmount: lineTaxAmount(lineAmount, taxRate)
    };
  });

  const body = {
    interchange: {
      senderId: input.senderId,
      senderQualifier: "ZZ",
      receiverId: input.receiverId,
      receiverQualifier: "ZZ",
      interchangeDate: stamp.date,
      interchangeTime: stamp.time,
      interchangeControlNo: padControlNo(input.controlNo ?? String(Date.now()))
    },
    message: {
      messageReference: "1",
      messageType: "INVOIC",
      version: "D",
      release: "96A",
      agency: "UN"
    },
    payload: {
      invoiceTypeCode: invoiceTypeCode(asString(payload.invoiceType, "STANDARD")),
      invoiceNumber: asString(payload.invoiceNo),
      functionCode: "9",
      documentDate,
      poReference: asString(payload.poReference),
      buyerId: input.buyerId,
      buyerName: asString(payload.buyerCompanyName),
      supplierId: input.supplierPartyId,
      supplierName: asString(payload.supplierName),
      lines,
      summary: {
        lineCount: String(lines.length),
        invoiceTotal: money(payload.totalAmount),
        lineItemsTotal: money(payload.subtotal),
        taxTotal: money(payload.taxAmount)
      }
    }
  };

  return stringifyPayloadDeep(body) as Record<string, unknown>;
}
