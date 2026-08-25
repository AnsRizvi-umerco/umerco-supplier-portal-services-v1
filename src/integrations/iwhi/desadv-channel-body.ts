import { stringifyPayloadDeep } from "@/integrations/iwhi/stringify-payload";
import {
  palletKind,
  shipmentTotals,
  type AsnShipment,
  type AsnUnitLoad
} from "@/services/asn/domain";

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
  if (value === "PARCEL") return "U";
  if (value === "HAND_CARRY") return "H";
  return "M";
}

function mapEquipmentType(mode: string): string {
  const method = mapTransportMethod(mode);
  if (method === "A") return "AE";
  if (method === "S") return "CN";
  if (method === "R") return "RR";
  return "TL";
}

function mapUom(uom: string): string {
  const value = uom.trim().toUpperCase();
  if (value === "EA" || value === "EACH" || value === "PCS") return "PC";
  return value || "PC";
}

function asShipment(payload: Record<string, unknown>): AsnShipment | null {
  if (!payload.asnNumber || !Array.isArray(payload.releases) || !Array.isArray(payload.unitLoads)) {
    return null;
  }
  return payload as unknown as AsnShipment;
}

function packsFromLoads(shipment: AsnShipment) {
  return shipment.unitLoads
    .filter((load) => load.cartons.length > 0)
    .map((load) => {
      const kind = palletKind(load, shipment.releases);
      const items = load.cartons.map((carton) => {
        const release = shipment.releases.find((row) => row.id === carton.releaseId);
        const data = release?.turnaround.data;
        return {
          buyerLineNo: data?.itemNumber || "1",
          itemCode: data?.partNo || "",
          itemCodeQualifier: "VP",
          description: data?.description || "",
          quantityShipped: String(carton.qty),
          uom: mapUom(data?.uom || "PC"),
          licencePlate: carton.licencePlate,
          releaseNumber: data?.releaseNumber
        };
      });
      return {
        sscc: load.licencePlate || load.cartons[0]?.licencePlate || "",
        palletKind: kind,
        items
      };
    });
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
  const shipment = asShipment(payload);
  const shipDate = compactDate(
    asString(payload.shipDate),
    new Date().toISOString().slice(0, 10).replace(/-/g, "")
  );
  const shipTime = compactTime(asString(payload.shipTime));
  const controlNo = padControlNo(input.controlNo ?? String(Date.now()));
  const groupControlNo = String(parseInt(controlNo, 10) || 1);
  const senderId = asString(input.senderId);
  const receiverId = asString(input.receiverId);
  const totals = shipment ? shipmentTotals(shipment) : { cartonCount: 0, palletCount: 0, grossWeightKg: 0, netWeightKg: 0, piecesPerPart: [] };
  const carrierScac = asString(payload.carrierScac).slice(0, 4).padEnd(4, "X");
  const transportMode = asString(payload.transportMode);
  const shipFrom = shipment?.shipFrom;
  const shipTo = shipment?.shipTo;
  const trackingNo = asString(payload.trackingNo);

  const ordersByPo = new Map<string, { poNumber: string; packs: ReturnType<typeof packsFromLoads> }>();
  if (shipment) {
    const packs = packsFromLoads(shipment);
    for (const release of shipment.releases.filter((row) => row.qtyToShip > 0)) {
      const poNumber = release.turnaround.data.poNumber;
      const current = ordersByPo.get(poNumber) ?? { poNumber, packs: [] };
      ordersByPo.set(poNumber, current);
    }
    const firstPo = [...ordersByPo.keys()][0];
    if (firstPo) {
      ordersByPo.get(firstPo)!.packs = packs;
    } else {
      ordersByPo.set(asString(payload.asnNumber, "ASN"), { poNumber: asString(payload.asnNumber, "ASN"), packs });
    }
  }

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
      shipmentId: asString(payload.asnNumber || payload.asnRef),
      shipmentDate: shipDate,
      shipmentTime: shipTime,
      hierarchyCode: "0001",
      shipment: {
        grossWeight: String(totals.grossWeightKg),
        netWeight: String(totals.netWeightKg),
        weightUom: "KG",
        packagingCode: totals.palletCount > 0 ? "PLT" : "CTN25",
        ladingQuantity: String(totals.cartonCount),
        carrierScac,
        transportMethod: mapTransportMethod(transportMode),
        equipmentType: mapEquipmentType(transportMode),
        equipmentInitial: carrierScac,
        equipmentNumber: trackingNo || padControlNo(controlNo).slice(-6),
        bolNumber: asString(payload.bolNumber),
        shipFrom: {
          id: shipFrom?.code || senderId,
          qualifier: "UL",
          name: shipFrom?.name || ""
        },
        shipTo: {
          id: shipTo?.code || receiverId,
          qualifier: "UL",
          name: shipTo?.name || "",
          street: shipTo?.street,
          city: shipTo?.city,
          postalCode: shipTo?.zip,
          country: shipTo?.country
        }
      },
      orders: [...ordersByPo.values()]
    }
  };

  return stringifyPayloadDeep(body) as Record<string, unknown>;
}

export function unitLoadKindForChannel(load: AsnUnitLoad, shipment: AsnShipment) {
  return palletKind(load, shipment.releases);
}
