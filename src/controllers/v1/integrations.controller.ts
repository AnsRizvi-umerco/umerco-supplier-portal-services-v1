import type { AuthedRequest } from "@/middleware/auth";
import { IWHI_CONFIG } from "@/integrations/iwhi/index";
import { asyncHandler } from "@/utils/asyncHandler";
import { sendServiceResult } from "@/utils/http";
import * as edifactService from "@/services/edifact.service";
import * as labelsService from "@/services/labels.service";
import * as webhooksService from "@/services/webhooks.service";

export const ingestEdifact = asyncHandler(async (req, res) => {
  sendServiceResult(res, await edifactService.ingestEdifact(req.body));
});

export const listEdifact = asyncHandler(async (_req, res) => {
  sendServiceResult(res, await edifactService.listEdifactOutputs());
});

export const listLabels = asyncHandler(async (req, res) => {
  const authed = req as AuthedRequest;
  sendServiceResult(res, await labelsService.listShippingLabels(authed.supplier, authed.portalUser));
});

export const generateLabels = asyncHandler(async (req, res) => {
  sendServiceResult(res, await labelsService.generateLabels(req.body));
});

export const handleIwhiWebhook = asyncHandler(async (req, res) => {
  const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  const signature = req.headers[IWHI_CONFIG.webhook.signatureHeader.toLowerCase()] as string | undefined;
  sendServiceResult(res, await webhooksService.processIwhiWebhook(rawBody, signature));
});
