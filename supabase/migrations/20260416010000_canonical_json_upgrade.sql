-- Canonical JSON upgrade: callback traceability, release date, and indexes.

alter table if exists submissions
  add column if not exists iwhi_message_id text,
  add column if not exists iwhi_transaction_id text,
  add column if not exists last_callback_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'submissions_iwhi_transaction_id_key'
  ) then
    alter table submissions
      add constraint submissions_iwhi_transaction_id_key unique (iwhi_transaction_id);
  end if;
end $$;

create index if not exists submissions_supplier_created_idx
  on submissions (supplier_id, created_at desc);

create index if not exists submissions_status_created_idx
  on submissions (status, created_at desc);

alter table if exists delivery_schedules
  add column if not exists release_date date;

create index if not exists delivery_schedules_supplier_received_idx
  on delivery_schedules (supplier_id, received_at desc);

create index if not exists audit_log_supplier_timestamp_idx
  on audit_log (supplier_id, "timestamp" desc);
