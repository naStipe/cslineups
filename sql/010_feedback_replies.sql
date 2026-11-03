-- Replies on feedback: an admin can answer an item from admin.html, and the
-- user who sent it can answer back from the feedback box on the map.
--   last_admin_reply_at  a newer admin reply than user_seen_at puts the
--                        update dot on the user's feedback button
--   needs_admin          true after the user replies, false after an admin
--                        replies or closes the item; open items plus these
--                        make up the count on an admin's feedback button
-- Service-role only, like public.feedback: RLS on, no policies.
create table if not exists public.feedback_replies (
  id          uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.feedback(id) on delete cascade,
  author_id   uuid references auth.users(id) on delete set null,
  from_admin  boolean not null,
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index if not exists feedback_replies_feedback_idx on public.feedback_replies (feedback_id, created_at);
alter table public.feedback_replies enable row level security;

alter table public.feedback add column if not exists last_admin_reply_at timestamptz;
alter table public.feedback add column if not exists needs_admin boolean not null default false;
