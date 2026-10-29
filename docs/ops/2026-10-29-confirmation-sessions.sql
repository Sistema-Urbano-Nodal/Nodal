-- Revoke the never-used sessions that sign-up confirmation links created (owner runs this by hand, after review).
--
-- WHAT
--   Until 29 Oct 2026 GoTrue confirmed a sign-up through the implicit flow: opening the confirmation link created a
--   session (amr 'otp') and sent the browser to login.html#access_token=…&refresh_token=…&type=signup. NODAL never
--   uses that session (sign-in is explicit, with a password), so web/scripts/auth.js removes it from the address bar,
--   but the browser's History file keeps the full URL, refresh token included, and nothing ever expires it. Anyone
--   who can read that history (a shared lab or desk computer, a synced browser profile, an extension) could put the
--   token in the nodal_refresh cookie and be signed in as that member. The audit counted about 440 such sessions,
--   3 of them belonging to administrators.
--   Sign-up now asks GoTrue for a PKCE link (server/supabase.js signup: ?code=, worth nothing without a verifier nobody
--   keeps), so no new ones are made once that is deployed. This script deletes the ones that already exist, which is what GoTrue
--   itself does on a sign-out: deleting the session deletes its refresh token and amr rows with it (ON DELETE CASCADE).
--
-- WHICH SESSIONS, ALL OF THESE AT ONCE
--   * every authentication method recorded for it is 'otp' (an email link; never a password sign-in),
--   * it has exactly one refresh token, not revoked and with no parent: it was never refreshed, so never used,
--   * auth.sessions.refreshed_at is null,
--   * it was created within 5 minutes of the account's email_confirmed_at (the confirmation itself).
--   A session failing any of these is left alone; part 1 counts the otp-only unused ones the time window leaves out.
--
-- WHY THIS SIGNS NOBODY OUT
--   A NODAL sign-in is a password sign-in: GoTrue gives it its own session (amr 'password'), and that is the one in
--   the member's cookies. None of these sessions ever reached a NODAL cookie, and none was ever refreshed, so no
--   browser is signed in with one. Members keep every other session they have; someone who never signed in still
--   signs in with their password as before.
--
-- HOW TO RUN IT
--   1. Deploy the PKCE change first; before that, every new confirmation adds one more such session (running this
--      again later is safe).
--   2. Run PART 1 alone (read-only, counts only: no address, token or id leaves the database). Expect about 440
--      sessions to revoke and 0 left alone. If the numbers look wrong, stop here.
--   3. Run PART 2. As written it is a dry run: it deletes inside a transaction, shows the count and ROLLS BACK. It
--      also refuses (raises, removing nothing) when more than 500 sessions match; lower that to the number part 1
--      showed if you like. When the count matches part 1, change the last line from ROLLBACK to COMMIT and run it.
--   4. Run PART 1 again: confirmation_sessions_to_revoke should be 0.
--   In the Supabase SQL editor (role postgres), or with `supabase db query --linked -f` on a copy holding only the
--   part to run. This is not a migration: never `supabase db push` it.


-- ============================== PART 1: diagnostic (read-only) ==============================
with amr as (
  select session_id, bool_and(authentication_method = 'otp') as otp_only
  from auth.mfa_amr_claims
  group by session_id
), tokens as (
  select session_id, count(*) as total,
         count(*) filter (where not revoked and coalesce(parent, '') = '') as never_used
  from auth.refresh_tokens
  where session_id is not null
  group by session_id
), unused_otp as (
  select s.id, s.user_id, s.created_at,
         coalesce(abs(extract(epoch from (s.created_at - u.email_confirmed_at))) <= 300, false) as at_confirmation
  from auth.sessions s
  join auth.users u on u.id = s.user_id
  join amr on amr.session_id = s.id and amr.otp_only
  join tokens t on t.session_id = s.id and t.total = 1 and t.never_used = 1
  where s.refreshed_at is null
)
select
  count(*) filter (where c.at_confirmation)                                              as confirmation_sessions_to_revoke,
  count(distinct c.user_id) filter (where c.at_confirmation)                             as members_concerned,
  count(distinct c.user_id) filter (where c.at_confirmation and p.app_role = 'admin')    as admin_members_concerned,
  count(*) filter (where c.at_confirmation and c.created_at < now() - interval '7 days') as older_than_7_days,
  min(c.created_at) filter (where c.at_confirmation)                                     as oldest,
  max(c.created_at) filter (where c.at_confirmation)                                     as newest,
  count(*) filter (where not c.at_confirmation)                                          as unused_otp_sessions_left_alone,
  (select count(*) from auth.sessions)                                                   as all_sessions
from unused_otp c
left join public.profiles p on p.id = c.user_id;


-- ============================== PART 2: cleanup (dry run until the last line says COMMIT) ==============================
begin;

create temporary table revoked_confirmation_sessions (id uuid, user_id uuid) on commit drop;

with revoked as (
  delete from auth.sessions s
  using auth.users u
  where u.id = s.user_id
    and s.refreshed_at is null
    and abs(extract(epoch from (s.created_at - u.email_confirmed_at))) <= 300
    and exists (select 1 from auth.mfa_amr_claims a where a.session_id = s.id and a.authentication_method = 'otp')
    and not exists (select 1 from auth.mfa_amr_claims a where a.session_id = s.id and a.authentication_method <> 'otp')
    and (select count(*) from auth.refresh_tokens r where r.session_id = s.id) = 1
    and not exists (select 1 from auth.refresh_tokens r where r.session_id = s.id and (r.revoked or coalesce(r.parent, '') <> ''))
  returning s.id, s.user_id
)
insert into revoked_confirmation_sessions select id, user_id from revoked;

do $$
declare matched integer;
begin
  select count(*) into matched from revoked_confirmation_sessions;
  if matched > 500 then
    raise exception 'Stopped: % sessions matched, more than the ~440 part 1 showed. Nothing was removed.', matched;
  end if;
end $$;

select count(*) as sessions_revoked, count(distinct user_id) as members_concerned from revoked_confirmation_sessions;

rollback;  -- dry run: change to COMMIT once sessions_revoked matches part 1
