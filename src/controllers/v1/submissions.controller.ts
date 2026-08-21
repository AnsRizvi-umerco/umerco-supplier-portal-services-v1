import type { AuthedRequest } from "@/middleware/auth";
import { asyncHandler } from "@/utils/asyncHandler";
import { sendServiceResult } from "@/utils/http";
import * as submitService from "@/services/submit.service";
import * as submissionsService from "@/services/submissions.service";

export const submitDocument = asyncHandler(async (req, res) => {
  const authed = req as AuthedRequest;
  sendServiceResult(
    res,
    await submitService.submitDocument(authed.supplier!, authed.portalUser!, req.body)
  );
});

export const listSubmissions = asyncHandler(async (req, res) => {
  const authed = req as AuthedRequest;
  sendServiceResult(res, await submissionsService.listSubmissions(authed.supplier, authed.portalUser));
});
