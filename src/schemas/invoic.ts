import { z } from "zod";
import {
  compactYmdDateSchema,
  envelopeBaseSchema,
  nonNegativeDecimalStringSchema,
  positiveDecimalStringSchema,
  positiveIntStringSchema
} from "@/schemas/common";

export const invoicLineSchema = z.object({
  poLine: z.string().min(1),
  partNo: z.string().min(1),
  description: z.string().min(1),
  qty: positiveIntStringSchema,
  uom: z.string().min(1),
  unitPrice: positiveDecimalStringSchema,
  lineTotal: positiveDecimalStringSchema
});

export const invoicPayloadSchema = z.object({
  invoiceNo: z.string().min(1),
  invoiceDate: compactYmdDateSchema,
  dueDate: z.union([z.literal(""), compactYmdDateSchema]),
  poReference: z.string().min(1),
  asnReference: z.string().min(1),
  deljitReference: z.string(),
  currency: z.string().min(1),
  paymentTerms: z.string().min(1),
  invoiceType: z.string().min(1),
  incoterm: z.string().min(1),
  facility: z.string().min(1),
  buyerCompanyName: z.string().min(1),
  supplierName: z.string().min(1),
  supplierTaxId: z.string(),
  supplierAddress: z.string(),
  supplierApEmail: z.string(),
  notes: z.string(),
  subtotal: nonNegativeDecimalStringSchema,
  shippingAmount: nonNegativeDecimalStringSchema,
  discountAmount: nonNegativeDecimalStringSchema,
  taxRate: nonNegativeDecimalStringSchema,
  taxAmount: nonNegativeDecimalStringSchema,
  lines: z.array(invoicLineSchema).min(1),
  totalAmount: positiveDecimalStringSchema
});

export const invoicMessageSchema = envelopeBaseSchema.extend({
  messageType: z.literal("INVOIC"),
  payload: invoicPayloadSchema
});

export type InvoicMessage = z.infer<typeof invoicMessageSchema>;
