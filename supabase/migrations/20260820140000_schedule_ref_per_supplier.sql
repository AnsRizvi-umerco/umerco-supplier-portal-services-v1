-- Allow the same PO / DELJIT reference on different suppliers.

ALTER TABLE delivery_schedules DROP CONSTRAINT IF EXISTS delivery_schedules_deljit_ref_key;
DROP INDEX IF EXISTS delivery_schedules_deljit_ref_key;

CREATE UNIQUE INDEX IF NOT EXISTS delivery_schedules_supplier_deljit_ref_uidx
  ON delivery_schedules (supplier_id, deljit_ref);
