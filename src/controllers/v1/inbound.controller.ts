import { asyncHandler } from "@/utils/asyncHandler";
import { sendServiceResult } from "@/utils/http";
import * as inboundService from "@/services/inbound.service";

export const handleSupplierInbound = asyncHandler(async (req, res) => {
  const companyId = String(req.params.companyId ?? "");
  const supplierId = String(req.params.supplierId ?? "");
  const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});

  sendServiceResult(
    res,
    await inboundService.receiveSupplierInbound({
      companyId,
      supplierId,
      rawBody
    })
  );
});
