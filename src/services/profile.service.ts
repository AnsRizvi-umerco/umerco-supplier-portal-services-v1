import type { PortalAuthUser, SupplierRow } from "@/middleware/auth";
import { getOperationsPool } from "@/config/operations-db";
import { resolveDataScope, scopePredicate } from "@/utils/data-scope";

const PROFILE_SELECT =
  "id, code, name, email, language, status, phone, created_at";

function startOfCurrentUtcMonth(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString();
}

export async function getProfile(
  supplier: SupplierRow | null | undefined,
  portalUser: PortalAuthUser | undefined
) {
  if (!portalUser) {
    return { status: 401 as const, body: { error: "Unauthorized" } };
  }
  if (!supplier) {
    return {
      status: 503 as const,
      body: { error: "Operations database is unavailable." }
    };
  }

  const pool = getOperationsPool();

  try {
    const { rows: profileRows } = await pool.query<{
      id: string;
      code: string;
      name: string;
      email: string;
      language: string;
      status: string;
      phone: string | null;
      created_at: string;
    }>(
      `SELECT ${PROFILE_SELECT} FROM suppliers WHERE id = $1 LIMIT 1`,
      [supplier.id]
    );

    const profile = profileRows[0];
    if (!profile) {
      return { status: 500 as const, body: { error: "Supplier not found" } };
    }

    const monthStart = startOfCurrentUtcMonth();
    const scope = resolveDataScope(portalUser, supplier) ?? {
      companyId: portalUser.business_partner_id,
      supplierId: supplier.id
    };
    const [totalSubsRes, monthSubsRes, schedulesRes, lastSubRes] = await Promise.all([
      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM submissions WHERE ${scopePredicate(1, 2)}`,
        [scope.companyId, scope.supplierId]
      ),
      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM submissions WHERE ${scopePredicate(1, 2)} AND created_at >= $3`,
        [scope.companyId, scope.supplierId, monthStart]
      ),
      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM delivery_schedules WHERE ${scopePredicate(1, 2)}`,
        [scope.companyId, scope.supplierId]
      ),
      pool.query<{ created_at: string }>(
        `SELECT created_at FROM submissions
         WHERE ${scopePredicate(1, 2)}
         ORDER BY created_at DESC
         LIMIT 1`,
        [scope.companyId, scope.supplierId]
      )
    ]);

    const lastSubmissionAt = lastSubRes.rows[0]?.created_at ?? null;
    const lastActiveAt = lastSubmissionAt ?? null;

    return {
      status: 200 as const,
      body: {
        id: profile.id,
        code: profile.code,
        name: profile.name,
        status: profile.status,
        language: profile.language,
        memberSince: profile.created_at,
        phone: profile.phone,
        authEmail: portalUser.email ?? profile.email ?? "",
        lastSignInAt: null,
        stats: {
          totalSubmissions: Number(totalSubsRes.rows[0]?.count ?? 0),
          submissionsThisMonth: Number(monthSubsRes.rows[0]?.count ?? 0),
          schedulesReceived: Number(schedulesRes.rows[0]?.count ?? 0),
          lastActiveAt
        }
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load profile";
    return { status: 500 as const, body: { error: message } };
  }
}
