import { z } from "zod";
import { compactYmdDateSchema, envelopeBaseSchema, nonNegativeIntStringSchema } from "@/schemas/common";

export const ordrspLineSchema = z.object({
  poLine: z.string().min(1),
  partNo: z.string().min(1),
  qtyOrdered: nonNegativeIntStringSchema,
  qtyConfirmed: nonNegativeIntStringSchema,
  promisedDate: compactYmdDateSchema,
  responseCode: z.enum(["AC", "IB", "RJ"]),
  reasonCode: z.string().min(1)
});

export const ordrspPayloadSchema = z.object({
  poReference: z.string().min(1),
  responseDate: compactYmdDateSchema,
  facility: z.string().min(1),
  supplierName: z.string().min(1),
  buyerCompanyName: z.string().min(1),
  note: z.string(),
  lines: z.array(ordrspLineSchema).min(1)
});

export const ordrspMessageSchema = envelopeBaseSchema.extend({
  messageType: z.literal("ORDRSP"),
  payload: ordrspPayloadSchema
});

export type OrdrspMessage = z.infer<typeof ordrspMessageSchema>;
