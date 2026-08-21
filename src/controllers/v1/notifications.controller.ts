import type { AuthedRequest } from "@/middleware/auth";
import { asyncHandler } from "@/utils/asyncHandler";
import { sendServiceResult } from "@/utils/http";
import * as notificationsService from "@/services/notifications.service";

export const listNotifications = asyncHandler(async (req, res) => {
  const authed = req as AuthedRequest;
  sendServiceResult(
    res,
    await notificationsService.listNotifications(
      authed.supplier,
      authed.portalUser,
      authed.operationsPool
    )
  );
});

export const markAllRead = asyncHandler(async (req, res) => {
  const authed = req as AuthedRequest;
  sendServiceResult(
    res,
    await notificationsService.markAllNotificationsRead(
      authed.supplier,
      authed.portalUser,
      authed.operationsPool
    )
  );
});

export const markOneRead = asyncHandler(async (req, res) => {
  const authed = req as AuthedRequest;
  sendServiceResult(
    res,
    await notificationsService.markNotificationRead(
      authed.supplier,
      authed.portalUser,
      String(req.params.id ?? ""),
      authed.operationsPool
    )
  );
});
