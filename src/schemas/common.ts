import { z } from "zod";
import { isYyyymmddValid } from "@/utils/dates/compact";

export const tradingPartnerSchema = z.string().min(1);

export const docTypeSchema = z.enum(["DESADV", "INVOIC", "ORDRSP", "APERAK"]);

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected ISO date (YYYY-MM-DD)");

/** Outbound submit dates: YYYYMMDD (no dashes). */
export const compactYmdDateSchema = z
  .string()
  .length(8)
  .regex(/^\d{8}$/)
  .refine(isYyyymmddValid, "Invalid calendar date (YYYYMMDD)");

/** Decimal number serialized as a string (e.g. "71250", "142.50"). */
export const decimalStringSchema = z
  .string()
  .refine((s) => /^-?\d+(\.\d+)?$/.test(s) && Number.isFinite(Number(s)), "Expected numeric string");

export const positiveIntStringSchema = z
  .string()
  .refine((s) => /^\d+$/.test(s) && parseInt(s, 10) >= 1, "Expected positive integer as string");

export const nonNegativeIntStringSchema = z
  .string()
  .refine((s) => /^\d+$/.test(s) && parseInt(s, 10) >= 0, "Expected non-negative integer as string");

export const positiveDecimalStringSchema = decimalStringSchema.refine(
  (s) => Number(s) > 0,
  "Expected positive decimal as string"
);

export const nonNegativeDecimalStringSchema = decimalStringSchema.refine(
  (s) => Number(s) >= 0,
  "Expected non-negative decimal as string"
);

export const envelopeBaseSchema = z.object({
  supplierCode: z.string().optional().default(""),
  tradingPartner: z.string().optional().default("")
});

export const statusSchema = z.enum(["draft", "pending", "submitted", "error"]);
