import { getOptionalEnv } from "@/config/env";
import {
  resolveInboundOperationsPool,
  withOperationsPool
} from "@/config/operations-db";
import { upsertOperationsSupplier } from "@/services/operations-supplier";
import { processIwhiWebhook } from "@/services/webhooks.service";
import { backfillTransactionCompanyIds } from "@/config/operations-schema";
import { Pool } from "pg";

type MasterSupplierRow = {
  id: string;
  email: string;
  full_name: string;
  status: string;
  partner_status: string;
};

let masterPool: Pool | null = null;

function getMasterPool(): Pool {
  if (!masterPool) {
    const connectionString = getOptionalEnv("MASTER_DATABASE_URL");
    if (!connectionString) {
      throw new Error("Missing MASTER_DATABASE_URL");
    }
    masterPool = new Pool({ connectionString });
  }
  return masterPool;
}

async function findMasterSupplier(
  companyId: string,
  supplierId: string
): Promise<MasterSupplierRow | null> {
  const { rows } = await getMasterPool().query<MasterSupplierRow>(
    `SELECT s.id, s.email, s.full_name, s.status,
            bp.status AS partner_status
     FROM suppliers s
     INNER JOIN business_partners bp ON bp.id = s.business_partner_id
     WHERE s.id = $1
       AND s.business_partner_id = $2`,
    [supplierId, companyId]
  );
  return rows[0] ?? null;
}

function withSupplierCode(rawBody: string, supplierCode: string): string {
  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return rawBody;
    }
    if ("interchange" in parsed && "message" in parsed && "payload" in parsed) {
      return rawBody;
    }
    return JSON.stringify({ ...parsed, supplierCode });
  } catch {
    return rawBody;
  }
}

export async function receiveSupplierInbound(params: {
  companyId: string;
  supplierId: string;
  rawBody: string;
}) {
  const masterSupplier = await findMasterSupplier(params.companyId, params.supplierId);
  if (!masterSupplier || masterSupplier.status !== "active") {
    return { status: 404 as const, body: { error: "Supplier inbound channel not found" } };
  }
  if (masterSupplier.partner_status !== "active") {
    return { status: 403 as const, body: { error: "Partner organization is not active" } };
  }

  const operationsPool = await resolveInboundOperationsPool(params.companyId);

  return withOperationsPool(operationsPool, async () => {
    const operationsSupplier = await upsertOperationsSupplier({
      masterSupplierId: masterSupplier.id,
      companyId: params.companyId,
      name: masterSupplier.full_name,
      email: masterSupplier.email
    });
    if (!operationsSupplier) {
      return {
        status: 500 as const,
        body: { error: "Could not resolve supplier operations record" }
      };
    }

    await backfillTransactionCompanyIds(operationsPool);

    const rawBody = withSupplierCode(params.rawBody, operationsSupplier.code);
    return processIwhiWebhook(rawBody, undefined, {
      skipSignature: true,
      companyId: params.companyId,
      supplierId: operationsSupplier.id
    });
  });
}
