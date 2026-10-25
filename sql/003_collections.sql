-- Collections: a named, ordered set of lineups (a strategy to plan, practise
-- and share). Items snapshot the lineup's name/type so a deleted lineup can
-- still be shown as "no longer available".
create table if not exists public.collections (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null references auth.users(id) on delete cascade,
  map_id               text not null,
  name                 text not null check (char_length(name) between 1 and 80),
  description          text not null default '' check (char_length(description) <= 500),
  visibility           text not null default 'private' check (visibility in ('private', 'unlisted', 'public')),
  share_slug           text not null unique check (share_slug ~ '^[A-Za-z0-9]{10}$'),
  forked_from          uuid references public.collections(id) on delete set null,
  moderation_hidden_at timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists collections_owner_map_idx on public.collections (owner_id, map_id);
create index if not exists collections_public_idx on public.collections (map_id, updated_at desc)
  where visibility = 'public' and moderation_hidden_at is null;

create table if not exists public.collection_items (
  id            uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  lineup_id     text references public.lineups(id) on delete set null,
  throw_id      text,
  position      integer not null check (position >= 0),
  role          text not null default '' check (char_length(role) <= 40),
  timing        text not null default '' check (char_length(timing) <= 60),
  note          text not null default '' check (char_length(note) <= 280),
  snapshot_name text not null default '' check (char_length(snapshot_name) <= 200),
  snapshot_type text not null default '',
  added_by      uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists collection_items_collection_idx on public.collection_items (collection_id, position);
create index if not exists collection_items_lineup_idx on public.collection_items (lineup_id);

alter table public.collections enable row level security;
alter table public.collection_items enable row level security;
