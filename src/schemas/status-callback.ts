import { z } from "zod";

export const statusCallbackSchema = z.object({
  transactionId: z.string().min(1),
  status: z.enum(["submitted", "error"]),
  messageId: z.string().optional(),
  errorDetail: z.string().optional()
});

export type StatusCallback = z.infer<typeof statusCallbackSchema>;
