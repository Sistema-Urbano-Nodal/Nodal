-- Run once on the production Supabase database before deploying the scheduled sender.
-- Only the SHA-256 verifier goes to Vercel. The bearer stays in Vault.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('nodal-publication-email-schedule'));
DO $setup$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'nodal_publication_email_scheduler') THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'nodal_publication_email_scheduler',
      'Scheduled NODAL publication email worker'
    );
  END IF;
END
$setup$;
SELECT encode(extensions.digest(decrypted_secret, 'sha256'), 'hex') AS scheduler_sha256
FROM vault.decrypted_secrets WHERE name = 'nodal_publication_email_scheduler';
COMMIT;
