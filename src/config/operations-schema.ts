import type { Pool } from "pg";

const ensured = new WeakSet<Pool>();

export async function ensureOperationsScopeSchema(pool: Pool): Promise<void> {
  if (!ensured.has(pool)) {
    await pool.query(`
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

    ALTER TABLE delivery_schedules DROP CONSTRAINT IF EXISTS delivery_schedules_deljit_ref_key;
    DROP INDEX IF EXISTS delivery_schedules_deljit_ref_key;
    CREATE UNIQUE INDEX IF NOT EXISTS delivery_schedules_supplier_deljit_ref_uidx
      ON delivery_schedules (supplier_id, deljit_ref);

    CREATE TABLE IF NOT EXISTS notifications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
      company_id uuid,
      title text NOT NULL,
      body text NOT NULL,
      tone text NOT NULL DEFAULT 'info',
      href text,
      doc_ref text,
      doc_type text,
      schedule_id uuid,
      read_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS notifications_supplier_created_idx
      ON notifications (supplier_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS notifications_company_created_idx
      ON notifications (company_id, created_at DESC);

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
  `);

    ensured.add(pool);
  }

  await ensureNotificationsTable(pool);
  await ensureScheduleStatusConstraint(pool);
}

const notificationsEnsured = new WeakSet<Pool>();
const notificationsBackfilled = new WeakSet<Pool>();
const scheduleStatusEnsured = new WeakSet<Pool>();

export async function ensureScheduleStatusConstraint(pool: Pool): Promise<void> {
  if (scheduleStatusEnsured.has(pool)) return;

  await pool.query(`
    ALTER TABLE delivery_schedules DROP CONSTRAINT IF EXISTS delivery_schedules_status_check;
    ALTER TABLE delivery_schedules
      ADD CONSTRAINT delivery_schedules_status_check
      CHECK (status IN ('pending', 'acknowledged', 'completed', 'invoice_sent'));
  `);

  scheduleStatusEnsured.add(pool);
}

export async function ensureNotificationsTable(pool: Pool): Promise<void> {
  if (notificationsEnsured.has(pool)) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
      company_id uuid,
      title text NOT NULL,
      body text NOT NULL,
      tone text NOT NULL DEFAULT 'info',
      href text,
      doc_ref text,
      doc_type text,
      schedule_id uuid,
      read_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS notifications_supplier_created_idx
      ON notifications (supplier_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS notifications_company_created_idx
      ON notifications (company_id, created_at DESC);
  `);

  notificationsEnsured.add(pool);
}

export async function backfillScheduleNotifications(pool: Pool): Promise<void> {
  await ensureNotificationsTable(pool);
  if (notificationsBackfilled.has(pool)) return;

  await pool.query(`
    INSERT INTO notifications (
      supplier_id, company_id, title, body, tone, href, doc_ref, doc_type, schedule_id, created_at
    )
    SELECT
      ds.supplier_id,
      ds.company_id,
      CASE
        WHEN (ds.canonical_json::jsonb) ? 'interchange' THEN 'Purchase order received'
        ELSE 'Delivery schedule received'
      END,
      CASE
        WHEN (ds.canonical_json::jsonb) ? 'interchange' THEN
          'PO ' || ds.deljit_ref || COALESCE(' from ' || NULLIF(ds.canonical_json->'payload'->>'buyerName', ''), '') || ' is ready to review.'
        ELSE
          'DELJIT ' || ds.deljit_ref || ' is ready to review.'
      END,
      'info',
      '/schedules?schedule=' || ds.id::text,
      ds.deljit_ref,
      CASE
        WHEN (ds.canonical_json::jsonb) ? 'interchange' THEN '850'
        ELSE 'DELJIT'
      END,
      ds.id,
      ds.received_at
    FROM delivery_schedules ds
    WHERE NOT EXISTS (
      SELECT 1 FROM notifications n WHERE n.schedule_id = ds.id
    );
  `);

  notificationsBackfilled.add(pool);
}

export async function backfillTransactionCompanyIds(pool: Pool): Promise<void> {
  await pool.query(`
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
  `);
}
