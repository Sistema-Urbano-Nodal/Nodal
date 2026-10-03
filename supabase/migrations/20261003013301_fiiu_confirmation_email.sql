BEGIN;

-- FIIU registration summary email. After a person's first registration the
-- server emails a summary of their choices and records the outcome here:
-- confirmation_status is 'none' (no email yet: registered before this existed,
-- email is off, or over the hourly sending limit), 'pending' (sending), 'sent',
-- 'failed' (the provider cannot have it), 'uncertain' (the message went out
-- without a final answer) or 'skipped' (a reserved test or example address);
-- confirmation_language is the email's language; confirmation_sent_at is when
-- the provider accepted it.
-- Additive only: existing rows become 'none', constant defaults need no table
-- rewrite, and the code live today neither reads nor writes these columns, so
-- applying this before the deploy is safe. Apply it BEFORE deploying code that
-- knows the columns: the API selects them on every registration read.
ALTER TABLE public.fiiu_registrations
 ADD COLUMN confirmation_status text NOT NULL DEFAULT 'none'
  CHECK (confirmation_status IN ('none','pending','sent','failed','uncertain','skipped')),
 ADD COLUMN confirmation_language text
  CHECK (confirmation_language IN ('en','es','pt')),
 ADD COLUMN confirmation_sent_at timestamptz;

COMMIT;
