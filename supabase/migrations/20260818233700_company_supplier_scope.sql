-- Scope operations data by company and supplier.
-- company_id = Master business_partners.id
-- master_supplier_id = Master suppliers.id (operations.suppliers only)

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS company_id uuid,
  ADD COLUMN IF NOT EXISTS master_supplier_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS suppliers_master_supplier_id_uidx
  ON suppliers (master_supplier_id)
  WHERE master_supplier_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS suppliers_company_id_idx
  ON suppliers (company_id);

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS company_id uuid;

ALTER TABLE delivery_schedules
  ADD COLUMN IF NOT EXISTS company_id uuid;

CREATE INDEX IF NOT EXISTS submissions_company_supplier_idx
  ON submissions (company_id, supplier_id, created_at DESC);

CREATE INDEX IF NOT EXISTS delivery_schedules_company_supplier_idx
  ON delivery_schedules (company_id, supplier_id, received_at DESC);

UPDATE submissions s
SET company_id = sup.company_id
FROM suppliers sup
WHERE s.supplier_id = sup.id
  AND s.company_id IS NULL
  AND sup.company_id IS NOT NULL;

UPDATE delivery_schedules ds
SET company_id = sup.company_id
FROM suppliers sup
WHERE ds.supplier_id = sup.id
  AND ds.company_id IS NULL
  AND sup.company_id IS NOT NULL;
