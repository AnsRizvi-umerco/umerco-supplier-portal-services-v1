import type { AuthedRequest } from "@/middleware/auth";
import { asyncHandler } from "@/utils/asyncHandler";
import { sendServiceResult } from "@/utils/http";
import * as settingsService from "@/services/settings.service";

export const getSettings = asyncHandler(async (req, res) => {
  const authed = req as AuthedRequest;
  sendServiceResult(res, await settingsService.getSettings(authed.user!, authed.supabase!));
});

export const patchSettings = asyncHandler(async (req, res) => {
  const authed = req as AuthedRequest;
  sendServiceResult(res, await settingsService.patchSettings(authed.user!, authed.supabase!, req.body));
});

export const getIntegrationStatus = asyncHandler(async (_req, res) => {
  sendServiceResult(res, settingsService.getIntegrationStatus());
});

export const getTradingPartners = asyncHandler(async (_req, res) => {
  sendServiceResult(res, settingsService.getTradingPartners());
});
