-- Install only on the production NODAL database after its sender is deployed.
-- Scheduling registers future runs. It never calls the worker during setup.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;
DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'nodal_publication_email_scheduler') THEN
    RAISE EXCEPTION 'Prepare the publication scheduler key before registering the job';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES ('anon'), ('authenticated')) AS access(role_name)
    WHERE
      (has_schema_privilege(role_name, 'vault', 'USAGE')
       AND has_table_privilege(role_name, 'vault.decrypted_secrets', 'SELECT'))
  ) THEN
    RAISE EXCEPTION 'The scheduler requires private access to Vault';
  END IF;
END
$check$;
SELECT cron.schedule('nodal-publication-emails', '7,22,37,52 * * * *', $job$
  SET LOCAL http.curlopt_timeout_ms = '290000';
  DO $send$
  DECLARE
    bearer text;
    response extensions.http_response;
  BEGIN
    SELECT decrypted_secret INTO STRICT bearer FROM vault.decrypted_secrets
    WHERE name = 'nodal_publication_email_scheduler';
    -- Use a synchronous HTTPS request: credentials never enter a SQL queue.
    SELECT * INTO STRICT response FROM extensions.http(ROW(
      'GET', 'https://sistema-urbano-nodal-ten.vercel.app/api/cron/news-email',
      ARRAY[extensions.http_header('Authorization', 'Bearer ' || bearer)],
      NULL, NULL
    )::extensions.http_request);
    IF response.status IS DISTINCT FROM 200 THEN
      RAISE EXCEPTION 'Publication sender returned HTTP %', response.status;
    END IF;
  END
  $send$;
$job$);
COMMIT;
