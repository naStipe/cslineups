-- One-off data fix (2026-10-25): every personal lineup starts as "not approved".
-- The admin reviews them; "approved" = moderation_reviewed_at is set.
update public.lineups set moderation_reviewed_at = null where is_official = false;
