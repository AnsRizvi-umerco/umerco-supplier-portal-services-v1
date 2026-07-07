-- Initial portal schema (from BUILD_THIS.md). Apply via: supabase db push (linked project).
-- Uses gen_random_uuid() (PG 13+) so we do not depend on uuid-ossp search_path on Supabase.

create table if not exists suppliers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  code          text not null unique,
  email         text not null unique,
  language      text not null default 'en',
  status        text not null default 'active' check (status in ('active', 'pending', 'suspended')),
  auth_user_id  uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

create table if not exists delivery_schedules (
  id             uuid primary key default gen_random_uuid(),
  deljit_ref     text not null unique,
  supplier_id    uuid not null references suppliers(id) on delete cascade,
  period_start   date not null,
  period_end     date not null,
  status         text not null default 'pending' check (status in ('pending', 'acknowledged', 'completed')),
  canonical_json jsonb not null,
  received_at    timestamptz not null default now()
);

create table if not exists schedule_lines (
  id           uuid primary key default gen_random_uuid(),
  schedule_id  uuid not null references delivery_schedules(id) on delete cascade,
  part_no      text not null,
  description  text,
  qty_required integer not null,
  uom          text not null default 'EA',
  deliver_by   date not null,
  facility     text not null
);

create table if not exists submissions (
  id              uuid primary key default gen_random_uuid(),
  supplier_id     uuid not null references suppliers(id) on delete cascade,
  doc_type        text not null check (doc_type in ('DESADV', 'INVOIC', 'ORDRSP', 'APERAK')),
  ref_no          text not null,
  deljit_ref      text,
  status          text not null default 'pending' check (status in ('draft', 'pending', 'submitted', 'error')),
  canonical_json  jsonb not null,
  iwhi_response   jsonb,
  error_message   text,
  created_at      timestamptz not null default now(),
  submitted_at    timestamptz
);

create table if not exists submission_lines (
  id             uuid primary key default gen_random_uuid(),
  submission_id  uuid not null references submissions(id) on delete cascade,
  part_no        text not null,
  description    text,
  qty            integer not null,
  uom            text not null default 'EA',
  unit_price     numeric(12,2),
  line_total     numeric(12,2)
);

create table if not exists audit_log (
  id           uuid primary key default gen_random_uuid(),
  supplier_id  uuid references suppliers(id) on delete set null,
  action       text not null,
  doc_ref      text,
  doc_type     text,
  details      jsonb,
  ip_address   text,
  timestamp    timestamptz not null default now()
);

alter table suppliers          enable row level security;
alter table delivery_schedules enable row level security;
alter table schedule_lines     enable row level security;
alter table submissions        enable row level security;
alter table submission_lines   enable row level security;
alter table audit_log          enable row level security;

drop policy if exists "supplier_read_own" on suppliers;
drop policy if exists "schedule_read_own" on delivery_schedules;
drop policy if exists "schedule_lines_read_own" on schedule_lines;
drop policy if exists "submissions_read_own" on submissions;
drop policy if exists "submissions_insert_own" on submissions;
drop policy if exists "audit_log_read_own" on audit_log;

create policy "supplier_read_own" on suppliers for select
  using (auth.uid() = auth_user_id);

create policy "schedule_read_own" on delivery_schedules for select
  using (supplier_id = (select id from suppliers where auth_user_id = auth.uid()));

create policy "schedule_lines_read_own" on schedule_lines for select
  using (schedule_id in (
    select id from delivery_schedules
    where supplier_id = (select id from suppliers where auth_user_id = auth.uid())
  ));

create policy "submissions_read_own" on submissions for select
  using (supplier_id = (select id from suppliers where auth_user_id = auth.uid()));

create policy "submissions_insert_own" on submissions for insert
  with check (supplier_id = (select id from suppliers where auth_user_id = auth.uid()));

create policy "audit_log_read_own" on audit_log for select
  using (supplier_id = (select id from suppliers where auth_user_id = auth.uid()));
