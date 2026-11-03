-- Signed-in users can see their own feedback and its status in the feedback
-- box. When an admin solves or discards one (status + closed_at, set by
-- api/admin.js action "feedback-status"), the feedback button shows a dot
-- until the user opens their list, which stamps user_seen_at through
-- api/feedback.js. An item is "unseen" while
--   status <> 'open' and closed_at > coalesce(user_seen_at, '-infinity').
-- Still service-role only: RLS stays on with no policies, and the API
-- filters every read and write by the caller's user_id.
alter table public.feedback add column if not exists user_seen_at timestamptz;

-- Items closed before this shipped count as already seen, so nobody gets a
-- burst of old notifications.
update public.feedback set user_seen_at = coalesce(closed_at, now())
  where status <> 'open' and user_seen_at is null;

create index if not exists feedback_user_idx on public.feedback (user_id, created_at desc) where user_id is not null;
