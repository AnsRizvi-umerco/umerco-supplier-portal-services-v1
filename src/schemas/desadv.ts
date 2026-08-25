import { z } from "zod";
import { envelopeBaseSchema } from "@/schemas/common";

const addressSchema = z.object({
  code: z.string(),
  name: z.string(),
  street: z.string(),
  city: z.string(),
  zip: z.string(),
  country: z.string()
});

const partySchema = z.object({
  code: z.string(),
  name: z.string()
});

const buyerSchema = z.object({
  id: z.string(),
  name: z.string()
});

export const asnTurnaroundSchema = z.object({
  partNo: z.string().min(1),
  description: z.string().min(1),
  shipTo: addressSchema,
  shipFrom: partySchema,
  buyer: buyerSchema,
  poNumber: z.string().min(1),
  itemNumber: z.string().min(1),
  releaseNumber: z.string().min(1),
  price: z.string(),
  uom: z.string().min(1)
});

export const sealedTurnaroundSchema = z.object({
  data: asnTurnaroundSchema,
  checksum: z.string().min(1)
});

export const asnReleaseSchema = z.object({
  id: z.string().min(1),
  scheduleId: z.string().min(1),
  turnaround: sealedTurnaroundSchema,
  deliveryDate: z.string(),
  openQty: z.number(),
  qtyToShip: z.number().nonnegative(),
  partsPerCarton: z.number().int().positive(),
  cartonsPerPallet: z.number().int().positive(),
  unitWeightKg: z.number().nonnegative(),
  countryOfOrigin: z.string(),
  dateControlled: z.boolean(),
  manufacturingDate: z.string(),
  expirationDate: z.string()
});

export const asnCartonSchema = z.object({
  id: z.string().min(1),
  releaseId: z.string().min(1),
  qty: z.number().int().positive(),
  short: z.boolean(),
  licencePlate: z.string().nullable(),
  grossWeightKg: z.number().nonnegative()
});

export const asnUnitLoadSchema = z.object({
  id: z.string().min(1),
  mode: z.enum(["PALLET", "LOOSE"]),
  licencePlate: z.string().nullable(),
  cartons: z.array(asnCartonSchema)
});

export const asnShipmentSchema = z.object({
  asnNumber: z.string().min(1),
  shipDate: z.string().min(1),
  shipTime: z.string().min(1),
  transportMode: z.string(),
  carrierScac: z.string(),
  trackingNo: z.string(),
  bolNumber: z.string(),
  currentStep: z.number().int().min(1).max(5),
  labelsFrozen: z.boolean(),
  shipFrom: partySchema,
  shipTo: addressSchema,
  buyer: buyerSchema,
  releases: z.array(asnReleaseSchema),
  unitLoads: z.array(asnUnitLoadSchema)
});

export const desadvPayloadSchema = asnShipmentSchema.extend({
  usageIndicator: z.enum(["P", "T"]).optional()
});

export const desadvMessageSchema = envelopeBaseSchema.extend({
  messageType: z.literal("DESADV"),
  payload: desadvPayloadSchema
});

export type DesadvMessage = z.infer<typeof desadvMessageSchema>;
export type AsnShipmentPayload = z.infer<typeof asnShipmentSchema>;
