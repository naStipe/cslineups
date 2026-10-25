-- Named areas (polygons) and, later, callout points per map and radar level.
-- Percent coordinates, same space as lineup landing/throw positions.
create table if not exists public.map_areas (
  id         uuid primary key default gen_random_uuid(),
  map_id     text not null,
  level      text not null default 'top',
  kind       text not null default 'area' check (kind in ('area', 'callout')),
  slug       text not null check (slug ~ '^[a-z0-9-]{1,32}$'),
  name       text not null check (char_length(name) between 1 and 40),
  polygon    jsonb,   -- [{x,y}, ...] for kind = 'area'
  point      jsonb,   -- {x,y} for kind = 'callout'
  sort       integer not null default 0,
  updated_at timestamptz not null default now()
);
create unique index if not exists map_areas_unique_slug on public.map_areas (map_id, level, kind, slug);
create index if not exists map_areas_map_idx on public.map_areas (map_id);
alter table public.map_areas enable row level security;
