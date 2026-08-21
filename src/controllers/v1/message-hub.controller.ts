import type { AuthedRequest } from "@/middleware/auth";
import { asyncHandler } from "@/utils/asyncHandler";
import { sendServiceResult } from "@/utils/http";
import * as messageHubService from "@/services/message-hub.service";

export const listMessageHub = asyncHandler(async (req, res) => {
  const authed = req as AuthedRequest;
  const query = req.url.includes("?") ? req.url.split("?")[1]! : "";
  sendServiceResult(res, await messageHubService.listMessageHub(authed.supplier, authed.portalUser, query));
});
