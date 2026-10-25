-- Feedback box on the map: suggestions and bug reports from visitors
-- (signed in or not). Read and closed by admins in the admin page; only the
-- API (service role) touches this table.
create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete set null,
  kind       text not null check (kind in ('suggestion', 'bug')),
  message    text not null check (char_length(message) between 1 and 2000),
  contact    text not null default '' check (char_length(contact) <= 200),
  page       text not null default '' check (char_length(page) <= 300),
  user_agent text not null default '' check (char_length(user_agent) <= 300),
  status     text not null default 'open' check (status in ('open', 'solved', 'discarded')),
  created_at timestamptz not null default now(),
  closed_at  timestamptz
);
create index if not exists feedback_status_idx on public.feedback (status, created_at desc);
alter table public.feedback enable row level security;
