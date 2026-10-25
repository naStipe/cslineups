-- User reports on public collections (DSA notice-and-action path).
create table if not exists public.collection_reports (
  id            uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  reporter_id   uuid not null references auth.users(id) on delete cascade,
  reason        text not null default '' check (reason in ('', 'copyright', 'abuse', 'spam', 'other')),
  details       text not null default '' check (char_length(details) <= 1000),
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  unique (collection_id, reporter_id)
);
create index if not exists collection_reports_open_idx on public.collection_reports (created_at desc) where resolved_at is null;
alter table public.collection_reports enable row level security;
