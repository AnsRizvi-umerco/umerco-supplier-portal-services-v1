-- Raw EDIFACT payloads pushed from IWHI (HTTP POST). Writes use service role in the app; reads use RLS for authenticated portal users.

create table if not exists edifact_outputs (
  id              uuid primary key default gen_random_uuid(),
  edifact_string  text not null,
  received_at     timestamptz not null default now()
);

alter table edifact_outputs enable row level security;

drop policy if exists "edifact_outputs_select_authenticated" on edifact_outputs;

create policy "edifact_outputs_select_authenticated" on edifact_outputs
  for select
  to authenticated
  using (true);
