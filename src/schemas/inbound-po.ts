import { z } from "zod";

const optionalString = z.string().optional().default("");

export const inboundPoLineSchema = z
  .object({
    lineNo: optionalString,
    itemCode: z.string().min(1),
    itemCodeQualifier: optionalString,
    description: z.string().min(1),
    quantity: z.string().min(1),
    uom: z.string().min(1),
    unitPrice: optionalString,
    lineAmount: optionalString
  })
  .passthrough();

export const inboundPoShipToSchema = z
  .object({
    id: optionalString,
    qualifier: optionalString,
    name: optionalString,
    street: optionalString,
    city: optionalString,
    state: optionalString,
    postalCode: optionalString,
    countryCode: optionalString
  })
  .passthrough();

export const inboundPoSummarySchema = z
  .object({
    lineCount: optionalString,
    quantityHashTotal: optionalString,
    orderTotal: optionalString
  })
  .passthrough();

export const inboundPurchaseOrderSchema = z
  .object({
    interchange: z
      .object({
        senderId: optionalString,
        senderQualifier: optionalString,
        receiverId: optionalString,
        receiverQualifier: optionalString,
        interchangeDate: optionalString,
        interchangeTime: optionalString,
        interchangeControlNo: optionalString,
        controlVersion: optionalString,
        ackRequested: optionalString,
        usageIndicator: optionalString
      })
      .passthrough(),
    message: z
      .object({
        messageReference: optionalString,
        messageType: z.string().min(1),
        functionalGroup: optionalString,
        groupControlNo: optionalString,
        version: optionalString,
        agency: optionalString
      })
      .passthrough(),
    payload: z
      .object({
        purposeCode: optionalString,
        orderTypeCode: optionalString,
        poNumber: z.string().min(1),
        poDate: z.string().min(1),
        requestedDeliveryDate: z.string().min(1),
        currency: optionalString,
        buyerId: optionalString,
        buyerQualifier: optionalString,
        buyerName: optionalString,
        vendorId: optionalString,
        vendorQualifier: optionalString,
        vendorName: optionalString,
        shipTo: inboundPoShipToSchema.optional(),
        lines: z.array(inboundPoLineSchema).min(1),
        summary: inboundPoSummarySchema.optional()
      })
      .passthrough()
  })
  .passthrough();

export type InboundPurchaseOrder = z.infer<typeof inboundPurchaseOrderSchema>;

export function isInboundPurchaseOrder(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!("interchange" in record) || !("message" in record) || !("payload" in record)) {
    return false;
  }
  const message = record.message;
  if (!message || typeof message !== "object") return false;
  const messageType = String((message as { messageType?: unknown }).messageType ?? "").trim();
  const functionalGroup = String(
    (message as { functionalGroup?: unknown }).functionalGroup ?? ""
  ).trim();
  return messageType === "850" || functionalGroup === "PO";
}
