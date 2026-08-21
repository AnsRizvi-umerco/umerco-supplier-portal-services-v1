import { stringifyPayloadDeep } from "@/integrations/iwhi/stringify-payload";

type AckLineIn = {
  poLine?: unknown;
  lineNo?: unknown;
  partNo?: unknown;
  description?: unknown;
  qtyOrdered?: unknown;
  qtyConfirmed?: unknown;
  qtyRequested?: unknown;
  qtyAccepted?: unknown;
  promisedDate?: unknown;
  responseCode?: unknown;
  uom?: unknown;
  unitPrice?: unknown;
};

type ScheduleOut = {
  statusCode: string;
  quantity: string;
  uom: string;
  dateQualifier: string;
  date: string;
};

type LineOut = {
  lineNo: string;
  buyerLineNo: string;
  itemCode: string;
  itemCodeQualifier: string;
  description: string;
  quantityOrdered: string;
  uom: string;
  unitPrice: string;
  schedules?: ScheduleOut[];
};

function asString(value: unknown, fallback = ""): string {
  if (value == null) return fallback;
  return String(value).trim();
}

function padControlNo(value: string): string {
  const digits = value.replace(/\D/g, "").slice(-9);
  return digits.padStart(9, "0") || "000000001";
}

function compactDate(value: string, fallback: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 8) return digits.slice(0, 8);
  if (digits.length === 6) return `20${digits}`;
  return fallback;
}

function interchangeDate(documentDate: string): string {
  if (/^\d{8}$/.test(documentDate)) return documentDate.slice(2);
  return new Date().toISOString().slice(2, 10).replace(/-/g, "");
}

function interchangeTime(): string {
  const now = new Date();
  return `${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}`;
}

function mapUom(uom: string): string {
  const value = uom.trim().toUpperCase();
  if (value === "EA" || value === "EACH" || value === "PCS") return "PC";
  return value || "PC";
}

function money(value: unknown): string {
  const n = Number(asString(value, "0"));
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

function qty(value: unknown): number {
  const n = parseInt(asString(value, "0"), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function buyerLineNo(value: string, index: number): string {
  const digits = value.replace(/\D/g, "");
  if (digits) return String(parseInt(digits, 10));
  return String(index + 1);
}

function ackType(codes: string[]): string {
  if (codes.length > 0 && codes.every((code) => code === "RJ")) return "RJ";
  return "AC";
}

function lineStatus(line: AckLineIn, headerCode: string): string {
  const code = asString(line.responseCode, headerCode).toUpperCase();
  if (code === "RJ" || code === "IR") return "RJ";
  if (code === "IB" || code === "IC") return "IB";
  return "AC";
}

function buildSchedules(line: AckLineIn, headerCode: string, fallbackDate: string): ScheduleOut[] {
  const ordered = qty(line.qtyOrdered ?? line.qtyRequested);
  const confirmed = qty(line.qtyConfirmed ?? line.qtyAccepted);
  const uom = mapUom(asString(line.uom, "PC"));
  const date = compactDate(asString(line.promisedDate), fallbackDate);
  const status = lineStatus(line, headerCode);

  if (status === "RJ" || confirmed <= 0) {
    return [
      {
        statusCode: "IR",
        quantity: String(Math.max(ordered, 0)),
        uom,
        dateQualifier: "068",
        date
      }
    ];
  }

  if (confirmed >= ordered) {
    return [
      {
        statusCode: status === "IB" ? "IC" : "IA",
        quantity: String(confirmed),
        uom,
        dateQualifier: "068",
        date
      }
    ];
  }

  return [
    {
      statusCode: "IA",
      quantity: String(confirmed),
      uom,
      dateQualifier: "068",
      date
    },
    {
      statusCode: "IB",
      quantity: String(ordered - confirmed),
      uom,
      dateQualifier: "068",
      date
    }
  ];
}

function groupKey(line: AckLineIn, index: number): string {
  const item = asString(line.partNo);
  const buyerLine = buyerLineNo(asString(line.poLine || line.lineNo), index);
  return `${item}::${buyerLine}`;
}

export function buildAck855ChannelBody(input: {
  senderId: string;
  receiverId: string;
  buyerId: string;
  supplierPartyId: string;
  controlNo?: string;
  payload: Record<string, unknown>;
  includeSchedules: boolean;
}): Record<string, unknown> {
  const payload = input.payload;
  const ackDate = compactDate(
    asString(payload.responseDate || payload.acknowledgmentDate),
    new Date().toISOString().slice(0, 10).replace(/-/g, "")
  );
  const poNumber = asString(payload.poNumber || payload.poReference || payload.deljitReference);
  const poDate = compactDate(asString(payload.poDate), ackDate);
  const controlNo = padControlNo(input.controlNo ?? String(Date.now()));
  const groupControlNo = String(parseInt(controlNo, 10) || 1);
  const senderId = asString(input.senderId);
  const receiverId = asString(input.receiverId);
  const rawLines = Array.isArray(payload.lines) ? (payload.lines as AckLineIn[]) : [];
  const headerCode = asString(payload.responseCode, "AC").toUpperCase();

  const grouped = new Map<
    string,
    { line: AckLineIn; index: number; quantityOrdered: number; schedules: ScheduleOut[] }
  >();

  rawLines.forEach((line, index) => {
    const itemCode = asString(line.partNo);
    if (!itemCode) return;
    const key = input.includeSchedules ? groupKey(line, index) : `row-${index}`;
    const ordered = qty(line.qtyOrdered ?? line.qtyRequested);
    const current = grouped.get(key);
    const schedules = input.includeSchedules ? buildSchedules(line, headerCode, ackDate) : [];

    if (!current) {
      grouped.set(key, { line, index, quantityOrdered: ordered, schedules });
      return;
    }

    current.quantityOrdered += ordered;
    current.schedules.push(...schedules);
  });

  const lines: LineOut[] = [...grouped.values()].map((entry, index) => {
    const buyerLine = buyerLineNo(asString(entry.line.poLine || entry.line.lineNo), entry.index);
    const out: LineOut = {
      lineNo: String(index + 1),
      buyerLineNo: buyerLine,
      itemCode: asString(entry.line.partNo),
      itemCodeQualifier: "VP",
      description: asString(entry.line.description) || asString(entry.line.partNo),
      quantityOrdered: String(entry.quantityOrdered),
      uom: mapUom(asString(entry.line.uom, "PC")),
      unitPrice: money(entry.line.unitPrice)
    };
    if (input.includeSchedules) {
      out.schedules = entry.schedules;
    }
    return out;
  });

  const quantityHashTotal = lines.reduce((sum, line) => sum + qty(line.quantityOrdered), 0);
  const lineCodes = rawLines.map((line) => lineStatus(line, headerCode));

  const body = {
    interchange: {
      senderId,
      senderQualifier: "ZZ",
      receiverId,
      receiverQualifier: "ZZ",
      interchangeDate: interchangeDate(ackDate),
      interchangeTime: interchangeTime(),
      interchangeControlNo: controlNo,
      controlVersion: "00401",
      ackRequested: "0",
      usageIndicator: asString(payload.usageIndicator, "P") || "P"
    },
    message: {
      messageReference: "0001",
      messageType: "855",
      functionalGroup: "PR",
      groupControlNo,
      version: "004010",
      agency: "X"
    },
    payload: {
      purposeCode: "00",
      acknowledgmentType: ackType(lineCodes.length > 0 ? lineCodes : [headerCode]),
      poNumber,
      poDate,
      acknowledgmentDate: ackDate,
      salesOrderNumber: asString(payload.salesOrderNumber) || poNumber,
      currency: asString(payload.currency, "USD") || "USD",
      buyerId: asString(payload.buyerId) || receiverId || asString(input.buyerId),
      buyerQualifier: "UL",
      buyerName: asString(payload.buyerCompanyName),
      vendorId: asString(payload.vendorId) || senderId || asString(input.supplierPartyId),
      vendorQualifier: "UL",
      vendorName: asString(payload.supplierName),
      lines,
      summary: {
        lineCount: String(lines.length),
        quantityHashTotal: String(quantityHashTotal)
      }
    }
  };

  return stringifyPayloadDeep(body) as Record<string, unknown>;
}
