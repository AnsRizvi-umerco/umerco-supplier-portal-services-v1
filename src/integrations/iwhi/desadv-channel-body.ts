import { stringifyPayloadDeep } from "@/integrations/iwhi/stringify-payload";

type AsnLineIn = {
  poNumber?: unknown;
  poLine?: unknown;
  partNo?: unknown;
  description?: unknown;
  qtyShipped?: unknown;
  uom?: unknown;
  containerType?: unknown;
  poDate?: unknown;
};

function asString(value: unknown, fallback = ""): string {
  if (value == null) return fallback;
  return String(value).trim();
}

function padControlNo(value: string): string {
  const digits = value.replace(/\D/g, "").slice(-9);
  return digits.padStart(9, "0") || "000000001";
}

function compactTime(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 4) return digits.slice(0, 4);
  const now = new Date();
  return `${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}`;
}

function interchangeDate(documentDate: string): string {
  if (/^\d{8}$/.test(documentDate)) return documentDate.slice(2);
  return new Date().toISOString().slice(2, 10).replace(/-/g, "");
}

function compactDate(value: string, fallback: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 8) return digits;
  if (digits.length === 6) return `20${digits}`;
  return fallback;
}

function mapTransportMethod(mode: string): string {
  const value = mode.trim().toUpperCase();
  if (value === "AIR" || value === "A") return "A";
  if (value === "SEA" || value === "OCEAN" || value === "S") return "S";
  if (value === "RAIL" || value === "R") return "R";
  return "M";
}

function mapEquipmentType(mode: string): string {
  const method = mapTransportMethod(mode);
  if (method === "A") return "AE";
  if (method === "S") return "CN";
  if (method === "R") return "RR";
  return "TL";
}

function mapPackagingCode(packageType: string, containerType?: string): string {
  const value = (packageType || containerType || "").trim().toUpperCase();
  if (value === "PALLET" || value === "PLT") return "PLT";
  if (value === "CRATE" || value === "CRT") return "CRT";
  if (value === "TOTE") return "TOT";
  if (value.startsWith("CTN")) return value;
  return "CTN25";
}

function mapUom(uom: string): string {
  const value = uom.trim().toUpperCase();
  if (value === "EA" || value === "EACH" || value === "PCS") return "PC";
  return value || "PC";
}

function mapWeightUom(uom: string): string {
  const value = uom.trim().toUpperCase();
  if (value === "KG" || value === "KGM") return "KG";
  if (value === "LB" || value === "LBR") return "LB";
  return "LB";
}

function optionalMeasure(value: unknown): string | undefined {
  const measure = asString(value);
  return measure || undefined;
}

function scac(carrier: string): string {
  const letters = carrier.replace(/[^A-Za-z]/g, "").toUpperCase();
  return (letters.slice(0, 4) || "XXXX").padEnd(4, "X");
}

function buyerLineNo(poLine: string, index: number): string {
  const digits = poLine.replace(/\D/g, "");
  if (digits) return String(parseInt(digits, 10));
  return String(index + 1);
}

function splitQuantity(total: number, packCount: number, packIndex: number): number {
  if (packCount <= 1) return total;
  const base = Math.floor(total / packCount);
  const remainder = total - base * packCount;
  return base + (packIndex < remainder ? 1 : 0);
}

function buildSscc(senderId: string, serial: number): string {
  const prefix = senderId.replace(/\D/g, "").padStart(13, "0").slice(-13);
  const serialPart = String(Math.max(1, serial)).padStart(3, "0").slice(-3);
  return `00${prefix}${serialPart}`.slice(0, 18);
}

function equipmentNumber(trackingNo: string, controlNo: string): string {
  if (trackingNo && trackingNo !== "NO-TRACKING-YET") {
    const digits = trackingNo.replace(/\D/g, "");
    return digits || trackingNo.slice(0, 10);
  }
  return padControlNo(controlNo).slice(-6);
}

export function buildDesadvChannelBody(input: {
  senderId: string;
  receiverId: string;
  buyerId: string;
  supplierPartyId: string;
  controlNo?: string;
  payload: Record<string, unknown>;
}): Record<string, unknown> {
  const payload = input.payload;
  const shipDate = compactDate(asString(payload.shipDate), new Date().toISOString().slice(0, 10).replace(/-/g, ""));
  const shipTime = compactTime(asString(payload.shipTime));
  const controlNo = padControlNo(input.controlNo ?? String(Date.now()));
  const groupControlNo = String(parseInt(controlNo, 10) || 1);
  const packCount = Math.max(1, parseInt(asString(payload.packageCount, "1"), 10) || 1);
  const rawLines = Array.isArray(payload.lines) ? (payload.lines as AsnLineIn[]) : [];
  const packageType = asString(payload.packageType, "CARTON");
  const senderId = asString(input.senderId);
  const receiverId = asString(input.receiverId);
  const shipFromId = asString(payload.shipFromId) || senderId || asString(input.supplierPartyId);
  const shipToId = asString(payload.shipToId) || receiverId || asString(input.buyerId);
  const carrierCode = scac(asString(payload.carrier));
  const transportMode = asString(payload.transportMode);

  const ordersByPo = new Map<
    string,
    { poNumber: string; poDate: string; lines: AsnLineIn[] }
  >();

  for (const line of rawLines) {
    const poNumber = asString(line.poNumber);
    if (!poNumber) continue;
    const current = ordersByPo.get(poNumber) ?? {
      poNumber,
      poDate: compactDate(asString(line.poDate), shipDate),
      lines: []
    };
    current.lines.push(line);
    ordersByPo.set(poNumber, current);
  }

  const orders = [...ordersByPo.values()].map((order) => {
    const packs = Array.from({ length: packCount }, (_, packIndex) => {
      const items = order.lines.flatMap((line, lineIndex) => {
        const qty = splitQuantity(
          Math.max(0, parseInt(asString(line.qtyShipped, "0"), 10) || 0),
          packCount,
          packIndex
        );
        if (qty <= 0) return [];
        return [
          {
            buyerLineNo: buyerLineNo(asString(line.poLine), lineIndex),
            itemCode: asString(line.partNo),
            itemCodeQualifier: "VP",
            description: asString(line.description) || asString(line.partNo),
            quantityShipped: String(qty),
            uom: mapUom(asString(line.uom, "PC"))
          }
        ];
      });

      return {
        sscc: buildSscc(senderId || shipFromId, packIndex + 1),
        items
      };
    }).filter((pack) => pack.items.length > 0);

    return {
      poNumber: order.poNumber,
      poDate: order.poDate,
      packs: packs.length > 0 ? packs : [{ sscc: buildSscc(senderId || shipFromId, 1), items: [] }]
    };
  });

  const firstContainer = asString(rawLines[0]?.containerType);
  const firstUom = asString(rawLines[0]?.uom);

  const body = {
    interchange: {
      senderId,
      senderQualifier: "ZZ",
      receiverId,
      receiverQualifier: "ZZ",
      interchangeDate: interchangeDate(shipDate),
      interchangeTime: shipTime,
      interchangeControlNo: controlNo,
      controlVersion: "00401",
      ackRequested: "0",
      usageIndicator: asString(payload.usageIndicator, "P") || "P"
    },
    message: {
      messageReference: "0001",
      messageType: "856",
      functionalGroup: "SH",
      groupControlNo,
      version: "004010",
      agency: "X"
    },
    payload: {
      purposeCode: "00",
      shipmentId: asString(payload.asnRef),
      shipmentDate: shipDate,
      shipmentTime: shipTime,
      hierarchyCode: "0001",
      shipment: {
        grossWeight: asString(payload.grossWeight, "0"),
        netWeight: asString(payload.netWeight, "0"),
        weightUom: mapWeightUom(asString(payload.weightUom) || firstUom),
        length: optionalMeasure(payload.length),
        width: optionalMeasure(payload.width),
        height: optionalMeasure(payload.height),
        dimensionUom: optionalMeasure(payload.dimensionUom),
        packagingCode: mapPackagingCode(packageType, firstContainer),
        ladingQuantity: String(packCount),
        carrierScac: carrierCode,
        transportMethod: mapTransportMethod(transportMode),
        equipmentType: mapEquipmentType(transportMode),
        equipmentInitial: carrierCode,
        equipmentNumber: equipmentNumber(asString(payload.trackingNo), controlNo),
        bolNumber: asString(payload.bolNumber),
        shipFrom: {
          id: shipFromId,
          qualifier: "UL",
          name: asString(payload.supplierName)
        },
        shipTo: {
          id: shipToId,
          qualifier: "UL",
          name: asString(payload.shipToFacility) || asString(payload.buyerCompanyName)
        }
      },
      orders
    }
  };

  return stringifyPayloadDeep(body) as Record<string, unknown>;
}
