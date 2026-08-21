import type { AuthedRequest } from "@/middleware/auth";
import { asyncHandler } from "@/utils/asyncHandler";
import { sendServiceResult } from "@/utils/http";
import * as dashboardService from "@/services/dashboard.service";
import * as profileService from "@/services/profile.service";

export const getDashboard = asyncHandler(async (req, res) => {
  const authed = req as AuthedRequest;
  const query = req.url.includes("?") ? req.url.split("?")[1]! : "";
  sendServiceResult(res, await dashboardService.getDashboard(authed.supplier, authed.portalUser, query));
});

export const getProfile = asyncHandler(async (req, res) => {
  const authed = req as AuthedRequest;
  sendServiceResult(
    res,
    await profileService.getProfile(authed.supplier, authed.portalUser)
  );
});
