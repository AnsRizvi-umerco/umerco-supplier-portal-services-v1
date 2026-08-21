import type { PortalAuthUser, SupplierRow } from "@/middleware/auth";

export type DataScope = {
  companyId: string;
  /** Null means every supplier in the company (partner admin). */
  supplierId: string | null;
};

export function resolveDataScope(
  portalUser: PortalAuthUser | null | undefined,
  supplier: SupplierRow | null | undefined
): DataScope | null {
  const companyId = portalUser?.business_partner_id?.trim() ?? "";
  if (!companyId) return null;

  if (portalUser?.actor === "partner_admin") {
    return { companyId, supplierId: null };
  }

  if (!supplier?.id) return null;
  return { companyId, supplierId: supplier.id };
}

/**
 * Supplier: this operations supplier_id only (company_id on the row may still be null).
 * Company admin: every transaction for this company_id, including rows linked via suppliers.company_id.
 */
export function scopePredicate(companyParam: number, supplierParam: number): string {
  return scopePredicateAliased("", companyParam, supplierParam);
}

export function scopePredicateAliased(
  tableAlias: string,
  companyParam: number,
  supplierParam: number
): string {
  const prefix = tableAlias ? `${tableAlias}.` : "";
  return `(
    ($${supplierParam}::uuid IS NULL AND (
      ${prefix}company_id = $${companyParam}
      OR ${prefix}supplier_id IN (SELECT id FROM suppliers WHERE company_id = $${companyParam})
    ))
    OR (
      $${supplierParam}::uuid IS NOT NULL
      AND ${prefix}supplier_id = $${supplierParam}
    )
  )`;
}
