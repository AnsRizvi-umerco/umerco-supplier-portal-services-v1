import type { PortalAuthUser, SupplierRow } from "@/middleware/auth";
import { getOperationsPool } from "@/config/operations-db";
import { resolveDataScope, scopePredicate } from "@/utils/data-scope";

export async function listSubmissions(
  supplier: SupplierRow | null | undefined,
  portalUser: PortalAuthUser | undefined
) {
  const scope = resolveDataScope(portalUser, supplier);
  if (!scope) return { status: 200 as const, body: { submissions: [] } };

  try {
    const { rows } = await getOperationsPool().query(
      `SELECT id, doc_type, ref_no, status, created_at, submitted_at,
              error_message, iwhi_message_id, last_callback_at
       FROM submissions
       WHERE ${scopePredicate(1, 2)}
       ORDER BY created_at DESC`,
      [scope.companyId, scope.supplierId]
    );
    return { status: 200 as const, body: { submissions: rows } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load submissions";
    return { status: 400 as const, body: { submissions: [], error: message } };
  }
}
