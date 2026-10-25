-- When an admin declines a suggestion for the official map, the lineup stays
-- private to its owner (submitted_at is cleared) and this records when, so the
-- owner can see "not accepted". Re-suggesting clears it again.
alter table public.lineups
  add column if not exists submission_denied_at timestamptz;
