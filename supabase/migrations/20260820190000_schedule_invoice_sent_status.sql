-- Allow delivery schedule / PO cards to move to invoice_sent after a successful INVOIC.

ALTER TABLE delivery_schedules DROP CONSTRAINT IF EXISTS delivery_schedules_status_check;
ALTER TABLE delivery_schedules
  ADD CONSTRAINT delivery_schedules_status_check
  CHECK (status IN ('pending', 'acknowledged', 'completed', 'invoice_sent'));
