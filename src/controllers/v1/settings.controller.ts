import type { AuthedRequest } from "@/middleware/auth";
import { asyncHandler } from "@/utils/asyncHandler";
import { sendServiceResult } from "@/utils/http";
import * as settingsService from "@/services/settings.service";

export const getSettings = asyncHandler(async (req, res) => {
  const authed = req as AuthedRequest;
  if (!authed.supplier) {
    sendServiceResult(res, {
      status: 503 as const,
      body: { error: "Operations database is unavailable." }
    });
    return;
  }
  sendServiceResult(
    res,
    await settingsService.getSettings(authed.portalUser!, authed.supplier.id)
  );
});

export const patchSettings = asyncHandler(async (req, res) => {
  const authed = req as AuthedRequest;
  if (!authed.supplier) {
    sendServiceResult(res, {
      status: 503 as const,
      body: { error: "Operations database is unavailable." }
    });
    return;
  }
  sendServiceResult(
    res,
    await settingsService.patchSettings(
      authed.portalUser!,
      authed.supplier.id,
      req.body
    )
  );
});

export const getIntegrationStatus = asyncHandler(async (_req, res) => {
  sendServiceResult(res, settingsService.getIntegrationStatus());
});

export const getTradingPartners = asyncHandler(async (_req, res) => {
  sendServiceResult(res, settingsService.getTradingPartners());
});
