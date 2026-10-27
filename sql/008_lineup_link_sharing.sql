-- Per-lineup link sharing: the owner can make one personal lineup viewable by
-- anyone holding its link (unlisted: never listed, indexed or submitted).
-- Off by default; the owner turns it on and off from the lineup's dossier.
alter table public.lineups add column if not exists link_shared boolean not null default false;
