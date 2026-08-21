import { Router } from "express";
import { requireSupplier } from "@/middleware/auth";
import * as schedulesController from "@/controllers/v1/schedules.controller";
import * as submissionsController from "@/controllers/v1/submissions.controller";
import * as dashboardController from "@/controllers/v1/dashboard.controller";
import * as settingsController from "@/controllers/v1/settings.controller";
import * as integrationsController from "@/controllers/v1/integrations.controller";
import * as notificationsController from "@/controllers/v1/notifications.controller";
import * as messageHubController from "@/controllers/v1/message-hub.controller";

const router = Router();

router.get("/schedules", requireSupplier, schedulesController.listSchedules);
router.get("/schedules/:id", requireSupplier, schedulesController.getScheduleById);

router.get("/notifications", requireSupplier, notificationsController.listNotifications);
router.patch("/notifications/read-all", requireSupplier, notificationsController.markAllRead);
router.patch("/notifications/:id/read", requireSupplier, notificationsController.markOneRead);

router.post("/submit", requireSupplier, submissionsController.submitDocument);
router.get("/submissions", requireSupplier, submissionsController.listSubmissions);
router.get("/message-hub", requireSupplier, messageHubController.listMessageHub);
router.get("/transactions", requireSupplier, messageHubController.listMessageHub);

router.get("/dashboard", requireSupplier, dashboardController.getDashboard);
router.get("/profile", requireSupplier, dashboardController.getProfile);

router.get("/settings", requireSupplier, settingsController.getSettings);
router.patch("/settings", requireSupplier, settingsController.patchSettings);
router.get("/settings/integration-status", requireSupplier, settingsController.getIntegrationStatus);
router.get("/settings/trading-partners", requireSupplier, settingsController.getTradingPartners);

router.get("/edifact", requireSupplier, integrationsController.listEdifact);
router.post("/edifact", integrationsController.ingestEdifact);
router.post("/labels", requireSupplier, integrationsController.generateLabels);

export default router;
