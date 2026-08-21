import { getOperationsPool } from "@/config/operations-db";

export type OperationsSupplierRow = {
  id: string;
  code: string;
  name: string;
  email: string;
  language: string;
};

const SELECT = "id, code, name, email, language, master_supplier_id, company_id";

type OperationsSupplierRecord = OperationsSupplierRow & {
  master_supplier_id: string | null;
  company_id: string | null;
};

async function findByMasterSupplierId(
  masterSupplierId: string
): Promise<OperationsSupplierRow | null> {
  const { rows } = await getOperationsPool().query<OperationsSupplierRecord>(
    `SELECT ${SELECT} FROM suppliers WHERE master_supplier_id = $1 LIMIT 1`,
    [masterSupplierId]
  );
  return toRow(rows[0]);
}

async function findByEmail(email: string): Promise<OperationsSupplierRecord | null> {
  const { rows } = await getOperationsPool().query<OperationsSupplierRecord>(
    `SELECT ${SELECT} FROM suppliers WHERE email ILIKE $1 LIMIT 1`,
    [email]
  );
  return rows[0] ?? null;
}

async function findCompanyPlaceholder(
  companyId: string
): Promise<OperationsSupplierRow | null> {
  const { rows } = await getOperationsPool().query<OperationsSupplierRecord>(
    `SELECT ${SELECT}
     FROM suppliers
     WHERE company_id = $1 AND master_supplier_id IS NULL
     LIMIT 1`,
    [companyId]
  );
  return toRow(rows[0]);
}

function toRow(row: OperationsSupplierRecord | undefined): OperationsSupplierRow | null {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    email: row.email,
    language: row.language
  };
}

async function reattachLegacyTransactions(supplierId: string, companyId: string): Promise<void> {
  const pool = getOperationsPool();
  await pool.query(
    `UPDATE submissions
     SET supplier_id = $1,
         company_id = $2
     WHERE supplier_id IN (
       SELECT id FROM suppliers
       WHERE company_id = $2
         AND master_supplier_id IS NULL
         AND email ILIKE 'legacy-%'
     )`,
    [supplierId, companyId]
  );
  await pool.query(
    `UPDATE delivery_schedules
     SET supplier_id = $1,
         company_id = $2
     WHERE supplier_id IN (
       SELECT id FROM suppliers
       WHERE company_id = $2
         AND master_supplier_id IS NULL
         AND email ILIKE 'legacy-%'
     )`,
    [supplierId, companyId]
  );
}

/**
 * One operations row per Master supplier.
 * If this supplier previously shared a company row, claim that row instead of creating an empty one.
 */
export async function upsertOperationsSupplier(input: {
  masterSupplierId: string;
  companyId: string;
  name: string;
  email: string;
}): Promise<OperationsSupplierRow | null> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim() || email;
  if (!email || !input.masterSupplierId || !input.companyId) return null;

  const existing = await findByMasterSupplierId(input.masterSupplierId);
  if (existing) {
    await getOperationsPool().query(
      `UPDATE suppliers
       SET company_id = $2, name = $3, email = $4
       WHERE master_supplier_id = $1`,
      [input.masterSupplierId, input.companyId, name, email]
    );
    await reattachLegacyTransactions(existing.id, input.companyId);
    return existing;
  }

  const byEmail = await findByEmail(email);
  if (byEmail && (!byEmail.master_supplier_id || byEmail.master_supplier_id === input.masterSupplierId)) {
    await getOperationsPool().query(
      `UPDATE suppliers
       SET master_supplier_id = $2,
           company_id = $3,
           name = $4,
           code = $2,
           email = $5
       WHERE id = $1`,
      [byEmail.id, input.masterSupplierId, input.companyId, name, email]
    );
    const claimed = await findByMasterSupplierId(input.masterSupplierId);
    if (claimed) {
      await reattachLegacyTransactions(claimed.id, input.companyId);
    }
    return claimed;
  }

  try {
    const { rows } = await getOperationsPool().query<OperationsSupplierRecord>(
      `INSERT INTO suppliers (
         name, code, email, language, status, company_id, master_supplier_id
       )
       VALUES ($1, $2, $3, 'en', 'active', $4, $5)
       RETURNING ${SELECT}`,
      [name, input.masterSupplierId, email, input.companyId, input.masterSupplierId]
    );
    const created = toRow(rows[0]);
    if (created) {
      await reattachLegacyTransactions(created.id, input.companyId);
    }
    return created;
  } catch (error) {
    const pgError = error as { code?: string };
    if (pgError.code !== "23505") {
      console.error("Failed to provision operations supplier:", error);
      return null;
    }
  }

  const byMaster = await findByMasterSupplierId(input.masterSupplierId);
  if (byMaster) {
    await reattachLegacyTransactions(byMaster.id, input.companyId);
    return byMaster;
  }

  return null;
}

/** Partner-admin placeholder so requireSupplier still has a row. Not used for stats. */
export async function upsertCompanyPlaceholder(input: {
  companyId: string;
  code: string;
  name: string;
  email: string;
}): Promise<OperationsSupplierRow | null> {
  const email = input.email.trim().toLowerCase();
  const code = input.code.trim();
  const name = input.name.trim() || code;
  if (!input.companyId || !code) return null;

  const existing = await findCompanyPlaceholder(input.companyId);
  if (existing) return existing;

  try {
    const { rows } = await getOperationsPool().query<OperationsSupplierRecord>(
      `INSERT INTO suppliers (
         name, code, email, language, status, company_id, master_supplier_id
       )
       VALUES ($1, $2, $3, 'en', 'active', $4, NULL)
       RETURNING ${SELECT}`,
      [name, `company:${input.companyId}`, `company-${input.companyId}@operations.local`, input.companyId]
    );
    return toRow(rows[0]);
  } catch (error) {
    const pgError = error as { code?: string };
    if (pgError.code === "23505") {
      const placeholder = await findCompanyPlaceholder(input.companyId);
      if (placeholder) return placeholder;

      if (email) {
        const byEmail = await findByEmail(email);
        if (byEmail) {
          await getOperationsPool().query(
            `UPDATE suppliers
             SET company_id = COALESCE(company_id, $2)
             WHERE id = $1 AND master_supplier_id IS NULL`,
            [byEmail.id, input.companyId]
          );
          return toRow(byEmail);
        }
      }
    }
    console.error("Failed to provision company operations placeholder:", error);
    return null;
  }
}
