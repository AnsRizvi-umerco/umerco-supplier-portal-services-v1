-- Supplier settings columns and update policy for portal settings page.

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS notification_email text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS deljit_email_alerts boolean DEFAULT true;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS default_currency text DEFAULT 'USD';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS default_incoterm text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS default_payment_terms text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS default_facility text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS default_uom text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS default_transport_mode text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS default_carrier text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS default_response_code text DEFAULT 'AC';

CREATE POLICY "supplier_update_own" ON suppliers FOR UPDATE
  USING (auth.uid() = auth_user_id)
  WITH CHECK (auth.uid() = auth_user_id);
