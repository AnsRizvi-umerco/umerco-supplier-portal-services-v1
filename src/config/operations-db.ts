import { AsyncLocalStorage } from "node:async_hooks";
import { Pool } from "pg";
import { getOptionalEnv } from "@/config/env";
import { ensureOperationsScopeSchema } from "@/config/operations-schema";
import { createPgPool, createReachablePgPool } from "@/config/pg-pool";

export type DbRouteMode = "shared" | "dedicated";

export type DbRoute = {
  business_partner_id: string;
  mode: DbRouteMode;
  connection_string: string | null;
};

const opsDbStorage = new AsyncLocalStorage<Pool>();
const poolsByConnectionString = new Map<string, Pool>();
let masterPool: Pool | null = null;

const pendingPools = new Map<string, Promise<Pool>>();

async function getOrCreatePool(connectionString: string): Promise<Pool> {
  const existing = poolsByConnectionString.get(connectionString);
  if (existing) return existing;

  const pending = pendingPools.get(connectionString);
  if (pending) return pending;

  const created = createReachablePgPool(connectionString)
    .then((pool) => {
      poolsByConnectionString.set(connectionString, pool);
      pendingPools.delete(connectionString);
      return pool;
    })
    .catch((error) => {
      pendingPools.delete(connectionString);
      throw error;
    });

  pendingPools.set(connectionString, created);
  return created;
}

function getMasterPool(): Pool {
  if (!masterPool) {
    const connectionString = getOptionalEnv("MASTER_DATABASE_URL");
    if (!connectionString) {
      throw new Error("Missing MASTER_DATABASE_URL");
    }
    masterPool = createPgPool(connectionString);
  }
  return masterPool;
}

/**
 * Fallback pool for webhooks / unauthenticated paths only.
 */
export function getSharedOperationsPool(): Pool {
  const connectionString = getOptionalEnv("OPERATIONS_DATABASE_URL");
  if (!connectionString) {
    throw new Error(
      "Missing OPERATIONS_DATABASE_URL (required for webhooks when no partner db-route is available)"
    );
  }
  const existing = poolsByConnectionString.get(connectionString);
  if (existing) return existing;

  const pool = createPgPool(connectionString);
  poolsByConnectionString.set(connectionString, pool);
  return pool;
}

function getMasterPortalBaseUrl(): string | undefined {
  return getOptionalEnv("MASTER_PORTAL_BASE_URL")?.replace(/\/$/, "");
}

/**
 * Fetch db-route from Master Portal API (same endpoint used after login).
 * Returns connection_string for both shared and dedicated modes.
 */
export async function fetchDbRouteFromApi(
  businessPartnerId: string,
  accessToken: string
): Promise<DbRoute> {
  const baseUrl = getMasterPortalBaseUrl();
  if (!baseUrl) {
    throw new Error("Missing MASTER_PORTAL_BASE_URL");
  }

  const response = await fetch(
    `${baseUrl}/api/supplier-portal/db-route/${encodeURIComponent(businessPartnerId)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` }
    }
  );

  const body = (await response.json().catch(() => null)) as
    | DbRoute
    | { error?: string }
    | null;

  if (!response.ok) {
    const message =
      (body && "error" in body && body.error) || "Failed to resolve database route";
    throw new Error(message);
  }

  if (!body || !("business_partner_id" in body) || !body.mode) {
    throw new Error("Invalid database route response");
  }

  return {
    business_partner_id: body.business_partner_id,
    mode: body.mode,
    connection_string: body.connection_string ?? null
  };
}

/**
 * Resolve the operations DB pool for a business partner from db-route API.
 * Uses connection_string for both shared and dedicated modes.
 */
export async function resolveOperationsPool(
  businessPartnerId: string,
  accessToken: string
): Promise<Pool> {
  const route = await fetchDbRouteFromApi(businessPartnerId, accessToken);
  const connectionString = route.connection_string?.trim();

  if (!connectionString) {
    throw new Error(
      `db-route returned no connection_string for business partner ${businessPartnerId} (mode=${route.mode})`
    );
  }

  const pool = await getOrCreatePool(connectionString);
  await ensureOperationsScopeSchema(pool);
  return pool;
}

export async function resolveInboundOperationsPool(businessPartnerId: string): Promise<Pool> {
  const { rows } = await getMasterPool().query<{
    mode: DbRouteMode;
    connection_secret_ref: string | null;
  }>(
    `SELECT mode, connection_secret_ref
     FROM business_partner_db_routes
     WHERE business_partner_id = $1`,
    [businessPartnerId]
  );

  const route = rows[0];
  const sharedFallback =
    getOptionalEnv("OPERATIONS_DATABASE_URL") || getOptionalEnv("SUPPLIER_PORTAL_DATABASE_URL");
  const connectionString =
    route?.mode === "dedicated"
      ? route.connection_secret_ref?.trim()
      : route?.connection_secret_ref?.trim() || sharedFallback;

  if (!connectionString) {
    throw new Error(
      `No operations database configured for business partner ${businessPartnerId}`
    );
  }

  const pool = await getOrCreatePool(connectionString);
  await ensureOperationsScopeSchema(pool);
  return pool;
}

export function getOperationsPool(): Pool {
  return opsDbStorage.getStore() ?? getSharedOperationsPool();
}

export function runWithOperationsPool(pool: Pool, next: () => void): void {
  opsDbStorage.run(pool, next);
}

export async function withOperationsPool<T>(pool: Pool, fn: () => Promise<T>): Promise<T> {
  return opsDbStorage.run(pool, fn);
}
