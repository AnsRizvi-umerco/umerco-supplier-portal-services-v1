import { Router } from "express";
import * as inboundController from "@/controllers/v1/inbound.controller";

const router = Router();

router.post("/:companyId/:supplierId", inboundController.handleSupplierInbound);

export default router;
