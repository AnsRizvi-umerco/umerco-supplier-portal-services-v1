import { z } from "zod";
import { compactYmdDateSchema, envelopeBaseSchema, isoDateSchema } from "@/schemas/common";

const inboundDateSchema = z.union([isoDateSchema, compactYmdDateSchema]);

export const deljitLineSchema = z.object({
  partNo: z.string().min(1),
  description: z.string().min(1),
  qtyRequired: z.number().int().positive(),
  uom: z.string().min(1),
  deliverBy: inboundDateSchema,
  facility: z.string().min(1)
});

export const deljitPayloadSchema = z.object({
  deljitRef: z.string().min(1),
  releaseDate: inboundDateSchema.optional(),
  periodStart: inboundDateSchema,
  periodEnd: inboundDateSchema,
  lines: z.array(deljitLineSchema).min(1)
});

export const deljitMessageSchema = envelopeBaseSchema.extend({
  messageType: z.literal("DELJIT"),
  payload: deljitPayloadSchema
});

export type DeljitMessage = z.infer<typeof deljitMessageSchema>;
