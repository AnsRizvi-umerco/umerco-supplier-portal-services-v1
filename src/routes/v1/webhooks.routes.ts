import { Router } from "express";
import * as integrationsController from "@/controllers/v1/integrations.controller";

const router = Router();

router.post("/iwhi", integrationsController.handleIwhiWebhook);

export default router;
