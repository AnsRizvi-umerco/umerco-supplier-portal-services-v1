import { z } from "zod";
import {
  compactYmdDateSchema,
  envelopeBaseSchema,
  nonNegativeDecimalStringSchema,
  positiveIntStringSchema
} from "@/schemas/common";

export const desadvLineSchema = z.object({
  poNumber: z.string().min(1),
  poLine: z.string().min(1),
  partNo: z.string().min(1),
  description: z.string().min(1),
  qtyShipped: positiveIntStringSchema,
  uom: z.string().min(1),
  containerType: z.string().min(1)
});

export const desadvPayloadSchema = z.object({
  supplierName: z.string().min(1),
  buyerCompanyName: z.string().min(1),
  asnRef: z.string().min(1),
  shipDate: compactYmdDateSchema,
  shipTime: z.string(),
  transportMode: z.string().min(1),
  carrier: z.string().min(1),
  trackingNo: z.string().min(1),
  bolNumber: z.string().min(1),
  shipToFacility: z.string().min(1),
  packageCount: positiveIntStringSchema,
  packageType: z.string().min(1),
  grossWeight: nonNegativeDecimalStringSchema,
  netWeight: nonNegativeDecimalStringSchema,
  notes: z.string(),
  lines: z.array(desadvLineSchema).min(1)
});

export const desadvMessageSchema = envelopeBaseSchema.extend({
  messageType: z.literal("DESADV"),
  payload: desadvPayloadSchema
});

export type DesadvMessage = z.infer<typeof desadvMessageSchema>;
