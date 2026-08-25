import type { AuthedRequest } from "@/middleware/auth";
import { asyncHandler } from "@/utils/asyncHandler";
import { sendServiceResult } from "@/utils/http";
import * as draftService from "@/services/asn/draft.service";

export const createDraft = asyncHandler(async (req, res) => {
  const authed = req as AuthedRequest;
  sendServiceResult(res, await draftService.createDraft(authed.supplier, authed.portalUser, req.body));
});

export const getDraft = asyncHandler(async (req, res) => {
  const authed = req as AuthedRequest;
  sendServiceResult(res, await draftService.getDraft(authed.supplier, authed.portalUser, String(req.params.id ?? "")));
});

export const patchDraft = asyncHandler(async (req, res) => {
  const authed = req as AuthedRequest;
  sendServiceResult(
    res,
    await draftService.patchDraft(authed.supplier, authed.portalUser, String(req.params.id ?? ""), req.body)
  );
});

export const allocateLabels = asyncHandler(async (req, res) => {
  const authed = req as AuthedRequest;
  sendServiceResult(
    res,
    await draftService.allocateLabels(authed.supplier, authed.portalUser, String(req.params.id ?? ""))
  );
});

export const unlockLabels = asyncHandler(async (req, res) => {
  const authed = req as AuthedRequest;
  sendServiceResult(
    res,
    await draftService.unlockLabels(authed.supplier, authed.portalUser, String(req.params.id ?? ""))
  );
});

export const submitDraft = asyncHandler(async (req, res) => {
  const authed = req as AuthedRequest;
  sendServiceResult(
    res,
    await draftService.submitDraft(authed.supplier, authed.portalUser, String(req.params.id ?? ""))
  );
});
