-- Which side a lineup is thrown for. Existing rows default to 'any'.
alter table public.lineups
  add column if not exists side text not null default 'any'
  check (side in ('t', 'ct', 'any'));
