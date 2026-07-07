import { z } from "zod";
import { compactYmdDateSchema, envelopeBaseSchema, nonNegativeIntStringSchema } from "@/schemas/common";

export const aperakLineSchema = z.object({
  lineNo: z.string().min(1),
  partNo: z.string().min(1),
  qtyRequested: nonNegativeIntStringSchema,
  qtyAccepted: nonNegativeIntStringSchema,
  promisedDate: compactYmdDateSchema
});

export const aperakPayloadSchema = z.object({
  deljitReference: z.string().min(1),
  responseDate: compactYmdDateSchema,
  responseCode: z.enum(["AC", "IB", "RJ"]),
  scope: z.enum(["FULL", "PARTIAL"]),
  note: z.string(),
  facility: z.string().min(1),
  supplierName: z.string().min(1),
  buyerCompanyName: z.string().min(1),
  lines: z.array(aperakLineSchema)
});

export const aperakMessageSchema = envelopeBaseSchema.extend({
  messageType: z.literal("APERAK"),
  payload: aperakPayloadSchema
});

export type AperakMessage = z.infer<typeof aperakMessageSchema>;
