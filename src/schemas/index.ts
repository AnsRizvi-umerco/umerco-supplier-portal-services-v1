import { z } from "zod";
import { aperakMessageSchema } from "@/schemas/aperak";
import { desadvMessageSchema } from "@/schemas/desadv";
import { deljitMessageSchema } from "@/schemas/deljit";
import { invoicMessageSchema } from "@/schemas/invoic";
import { ordrspMessageSchema } from "@/schemas/ordrsp";
import { statusCallbackSchema } from "@/schemas/status-callback";

export * from "@/schemas/common";
export * from "@/schemas/deljit";
export * from "@/schemas/aperak";
export * from "@/schemas/ordrsp";
export * from "@/schemas/desadv";
export * from "@/schemas/invoic";
export * from "@/schemas/inbound-po";
export * from "@/schemas/status-callback";

export const submitMessageSchema = z.discriminatedUnion("messageType", [
  desadvMessageSchema,
  invoicMessageSchema,
  ordrspMessageSchema,
  aperakMessageSchema
]);

export const webhookMessageSchema = z.union([deljitMessageSchema, statusCallbackSchema]);

export type SubmitMessage = z.infer<typeof submitMessageSchema>;
export type WebhookMessage = z.infer<typeof webhookMessageSchema>;
