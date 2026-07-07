import { Router } from "express";
import { requireSupplier } from "@/middleware/auth";
import * as schedulesController from "@/controllers/v1/schedules.controller";
import * as submissionsController from "@/controllers/v1/submissions.controller";
import * as dashboardController from "@/controllers/v1/dashboard.controller";
import * as settingsController from "@/controllers/v1/settings.controller";
import * as integrationsController from "@/controllers/v1/integrations.controller";

const router = Router();

router.get("/schedules", schedulesController.listSchedules);
router.get("/schedules/:id", schedulesController.getScheduleById);

router.post("/submit", requireSupplier, submissionsController.submitDocument);
router.get("/submissions", submissionsController.listSubmissions);

router.get("/dashboard", dashboardController.getDashboard);
router.get("/profile", dashboardController.getProfile);

router.get("/settings", requireSupplier, settingsController.getSettings);
router.patch("/settings", requireSupplier, settingsController.patchSettings);
router.get("/settings/integration-status", requireSupplier, settingsController.getIntegrationStatus);
router.get("/settings/trading-partners", requireSupplier, settingsController.getTradingPartners);

router.get("/edifact", requireSupplier, integrationsController.listEdifact);
router.post("/edifact", integrationsController.ingestEdifact);
router.post("/labels", requireSupplier, integrationsController.generateLabels);

export default router;
