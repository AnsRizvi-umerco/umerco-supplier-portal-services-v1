import type { AuthedRequest } from "@/middleware/auth";
import { asyncHandler } from "@/utils/asyncHandler";
import { sendServiceResult } from "@/utils/http";
import * as schedulesService from "@/services/schedules.service";

export const listSchedules = asyncHandler(async (req, res) => {
  const authed = req as AuthedRequest;
  const query = req.url.includes("?") ? req.url.split("?")[1]! : "";
  sendServiceResult(res, await schedulesService.listSchedules(authed.supplier, authed.portalUser, query));
});

export const getScheduleById = asyncHandler(async (req, res) => {
  const authed = req as AuthedRequest;
  sendServiceResult(res, await schedulesService.getScheduleById(authed.supplier, authed.portalUser, req.params.id));
});
