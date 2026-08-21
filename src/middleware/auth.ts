import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { Pool } from "pg";
import { getOptionalEnv } from "@/config/env";
import {
  resolveOperationsPool,
  runWithOperationsPool,
  withOperationsPool
} from "@/config/operations-db";
import {
  upsertCompanyPlaceholder,
  upsertOperationsSupplier
} from "@/services/operations-supplier";
import { backfillTransactionCompanyIds } from "@/config/operations-schema";

export type SupplierRow = {
  id: string;
  code: string;
  name: string;
  email: string;
  language: string;
};

export type PortalActor = "partner_admin" | "supplier";

export type EdiIdentity = {
  mutually_defined_zz: string | null;
  duns: string | null;
  as2: string | null;
};

export type PortalAuthUser = {
  id: string;
  actor: PortalActor;
  email: string;
  full_name: string;
  business_partner_id: string;
  business_partner_code: string;
  business_partner_name: string;
  mutually_defined_zz: string | null;
  duns: string | null;
  as2: string | null;
  company_mutually_defined_zz: string | null;
  company_duns: string | null;
  company_as2: string | null;
  channel_url: string | null;
  comms_username: string | null;
  comms_password: string | null;
  document_types: string[];
};

type PortalTokenPayload = {
  sub: string;
  actor: PortalActor;
};

export type AuthedRequest = Request & {
  portalUser?: PortalAuthUser;
  supplier?: SupplierRow | null;
  accessToken?: string;
  operationsPool?: Pool;
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

function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7);
}

async function resolvePortalUser(
  payload: PortalTokenPayload
): Promise<PortalAuthUser | null> {
  const pool = getMasterPool();

  if (payload.actor === "partner_admin") {
    const { rows } = await pool.query<{
      id: string;
      email: string;
      full_name: string;
      business_partner_id: string;
      partner_code: string;
      partner_name: string;
      status: string;
      partner_status: string;
      mutually_defined_zz: string | null;
      duns: string | null;
      as2: string | null;
    }>(
      `SELECT u.id, u.email, u.full_name, u.business_partner_id, u.status,
              bp.code AS partner_code,
              bp.name AS partner_name,
              bp.status AS partner_status,
              bp.mutually_defined_zz,
              bp.duns,
              bp.as2
       FROM app_users u
       INNER JOIN business_partners bp ON bp.id = u.business_partner_id
       WHERE u.id = $1
         AND u.role = 'partner_admin'::user_role`,
      [payload.sub]
    );

    const row = rows[0];
    if (!row || row.status !== "active" || row.partner_status !== "active") {
      return null;
    }

    return {
      id: row.id,
      actor: "partner_admin",
      email: row.email,
      full_name: row.full_name,
      business_partner_id: row.business_partner_id,
      business_partner_code: row.partner_code,
      business_partner_name: row.partner_name,
      mutually_defined_zz: row.mutually_defined_zz,
      duns: row.duns,
      as2: row.as2,
      company_mutually_defined_zz: row.mutually_defined_zz,
      company_duns: row.duns,
      company_as2: row.as2,
      channel_url: null,
      comms_username: null,
      comms_password: null,
      document_types: []
    };
  }

  const { rows } = await pool.query<{
    id: string;
    email: string;
    full_name: string;
    business_partner_id: string;
    partner_code: string;
    partner_name: string;
    status: string;
    partner_status: string;
    mutually_defined_zz: string | null;
    duns: string | null;
    as2: string | null;
    partner_mutually_defined_zz: string | null;
    partner_duns: string | null;
    partner_as2: string | null;
    channel_url: string | null;
    comms_username: string | null;
    comms_password: string | null;
    document_types: string[] | null;
  }>(
    `SELECT s.id, s.email, s.full_name, s.business_partner_id, s.status,
            s.mutually_defined_zz, s.duns, s.as2,
            s.channel_url, s.comms_username, s.comms_password, s.document_types,
            bp.code AS partner_code,
            bp.name AS partner_name,
            bp.status AS partner_status,
            bp.mutually_defined_zz AS partner_mutually_defined_zz,
            bp.duns AS partner_duns,
            bp.as2 AS partner_as2
     FROM suppliers s
     INNER JOIN business_partners bp ON bp.id = s.business_partner_id
     WHERE s.id = $1`,
    [payload.sub]
  );

  const row = rows[0];
  if (!row || row.status !== "active" || row.partner_status !== "active") {
    return null;
  }

  return {
    id: row.id,
    actor: "supplier",
    email: row.email,
    full_name: row.full_name,
    business_partner_id: row.business_partner_id,
    business_partner_code: row.partner_code,
    business_partner_name: row.partner_name,
    mutually_defined_zz: row.mutually_defined_zz,
    duns: row.duns,
    as2: row.as2,
    company_mutually_defined_zz: row.partner_mutually_defined_zz,
    company_duns: row.partner_duns,
    company_as2: row.partner_as2,
    channel_url: row.channel_url,
    comms_username: row.comms_username,
    comms_password: row.comms_password,
    document_types: Array.isArray(row.document_types) ? row.document_types : []
  };
}

async function resolveOperationsSupplier(
  portalUser: PortalAuthUser
): Promise<SupplierRow | null> {
  if (portalUser.actor === "supplier") {
    return upsertOperationsSupplier({
      masterSupplierId: portalUser.id,
      companyId: portalUser.business_partner_id,
      name: portalUser.full_name,
      email: portalUser.email
    });
  }

  return upsertCompanyPlaceholder({
    companyId: portalUser.business_partner_id,
    code: portalUser.business_partner_code,
    name: portalUser.business_partner_name,
    email: portalUser.email
  });
}

export async function attachAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  const token = getBearerToken(req);
  if (!token) {
    req.supplier = null;
    return next();
  }

  const jwtSecret = getOptionalEnv("JWT_SECRET");
  if (!jwtSecret) {
    req.supplier = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, jwtSecret) as jwt.JwtPayload;
    if (
      !decoded.sub ||
      (decoded.actor !== "partner_admin" && decoded.actor !== "supplier")
    ) {
      req.supplier = null;
      return next();
    }

    const portalUser = await resolvePortalUser({
      sub: decoded.sub,
      actor: decoded.actor
    });

    if (!portalUser) {
      req.supplier = null;
      return next();
    }

    req.portalUser = portalUser;
    req.accessToken = token;

    try {
      const operationsPool = await resolveOperationsPool(
        portalUser.business_partner_id,
        token
      );
      req.operationsPool = operationsPool;

      await withOperationsPool(operationsPool, async () => {
        req.supplier = await resolveOperationsSupplier(portalUser);
        await backfillTransactionCompanyIds(operationsPool);
      });
    } catch (error) {
      console.error("Operations DB attach failed:", error);
      req.supplier = null;
    }
  } catch (error) {
    console.error("Auth attach failed:", error);
    req.portalUser = undefined;
    req.supplier = null;
  }

  next();
}

export function bindOperationsPool(req: AuthedRequest, _res: Response, next: NextFunction) {
  if (req.operationsPool) {
    runWithOperationsPool(req.operationsPool, next);
    return;
  }
  next();
}

export function requirePartnerAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.portalUser) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (req.portalUser.actor !== "partner_admin") {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

export function requireSupplier(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.portalUser) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (req.portalUser.actor === "supplier" && !req.supplier) {
    return res.status(503).json({
      error: "Operations database is unavailable for this supplier."
    });
  }
  next();
}
