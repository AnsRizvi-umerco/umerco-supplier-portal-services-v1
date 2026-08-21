-- In-app notifications for inbound schedules / purchase orders.

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
