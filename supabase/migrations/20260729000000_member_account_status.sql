-- Whether a member may still use their account.
--
-- The sqlite backend has carried this since its first migration and enforces it
-- in four places. The Supabase backend — the one production actually runs —
-- reported every member as 'active' from a hardcoded literal, so a member could
-- not be suspended at all: their session kept resolving, they could sign in
-- again, and they stayed in the directory.
--
-- Deliberately a column rather than a GoTrue ban. It is read for free with the
-- profile the app already selects, it carries the same three states sqlite
-- does, and one UPDATE here is the whole operation.

alter table public.profiles
  add column if not exists account_status text not null default 'active';

alter table public.profiles
  drop constraint if exists profiles_account_status_check;
alter table public.profiles
  add constraint profiles_account_status_check
  check (account_status in ('active', 'disabled', 'pending'));

-- the directory reads every profile and keeps only the active ones
create index if not exists profiles_account_status_idx
  on public.profiles(account_status);

comment on column public.profiles.account_status is
  'active, disabled or pending. Server-enforced on session resolution, sign-in, '
  'the directory listing and the member card. Never written from a request body: '
  'no insert or update policy exists for authenticated, so only the service key '
  'and the dashboard can change it — a suspended member cannot lift their own '
  'suspension.';

-- To suspend someone:
--   update public.profiles set account_status = 'disabled' where email = '...';
-- To restore them, set it back to 'active'.
