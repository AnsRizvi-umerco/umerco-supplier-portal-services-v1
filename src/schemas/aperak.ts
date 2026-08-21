import { z } from "zod";
import {
  compactYmdDateSchema,
  envelopeBaseSchema,
  nonNegativeDecimalStringSchema,
  nonNegativeIntStringSchema
} from "@/schemas/common";

export const aperakLineSchema = z.object({
  lineNo: z.string().min(1),
  partNo: z.string().min(1),
  description: z.string().optional(),
  qtyRequested: nonNegativeIntStringSchema,
  qtyAccepted: nonNegativeIntStringSchema,
  promisedDate: compactYmdDateSchema,
  uom: z.string().optional(),
  unitPrice: nonNegativeDecimalStringSchema.optional()
});

export const aperakPayloadSchema = z.object({
  deljitReference: z.string().min(1),
  poNumber: z.string().optional(),
  poDate: compactYmdDateSchema.optional(),
  responseDate: compactYmdDateSchema,
  responseCode: z.enum(["AC", "IB", "RJ"]),
  scope: z.enum(["FULL", "PARTIAL"]),
  note: z.string(),
  facility: z.string().min(1),
  supplierName: z.string().min(1),
  buyerCompanyName: z.string().min(1),
  buyerId: z.string().optional(),
  vendorId: z.string().optional(),
  currency: z.string().optional(),
  salesOrderNumber: z.string().optional(),
  usageIndicator: z.enum(["P", "T"]).optional(),
  lines: z.array(aperakLineSchema)
});

export const aperakMessageSchema = envelopeBaseSchema.extend({
  messageType: z.literal("APERAK"),
  payload: aperakPayloadSchema
});

export type AperakMessage = z.infer<typeof aperakMessageSchema>;
