BEGIN;

-- Store the small normalized JPEG on the same row so a publication and its cover change atomically.
ALTER TABLE public.nodal_news
  ADD COLUMN cover_revision text NOT NULL DEFAULT '',
  ADD COLUMN cover_alt text NOT NULL DEFAULT '' CHECK (char_length(cover_alt) <= 240),
  ADD COLUMN cover_jpeg bytea,
  ADD CONSTRAINT nodal_news_cover_valid CHECK (
    (cover_jpeg IS NULL AND cover_revision = '') OR
    (cover_jpeg IS NOT NULL AND cover_revision ~ '^[a-f0-9]{64}$' AND octet_length(cover_jpeg) BETWEEN 1 AND 307200)
  );
ALTER TABLE public.catalog_items
  ADD COLUMN cover_revision text NOT NULL DEFAULT '',
  ADD COLUMN cover_alt text NOT NULL DEFAULT '' CHECK (char_length(cover_alt) <= 240),
  ADD COLUMN cover_jpeg bytea,
  ADD CONSTRAINT catalog_items_cover_valid CHECK (
    (cover_jpeg IS NULL AND cover_revision = '') OR
    (kind = 'opportunity' AND cover_jpeg IS NOT NULL AND cover_revision ~ '^[a-f0-9]{64}$' AND octet_length(cover_jpeg) BETWEEN 1 AND 307200)
  );

CREATE FUNCTION public.claim_publication_email_with_cover()
RETURNS TABLE(event_id text,news_id uuid,catalog_id uuid,user_id uuid,attempts integer,email text,
              title text,url text,language text,excerpt text,byline text,organization text,cover_url text,cover_alt text)
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT job.*,
    CASE WHEN n.status='published' AND n.cover_revision <> '' THEN
      '/api/publication-covers/news/' || n.id || '/' || n.cover_revision || '.jpg'
    WHEN c.cover_revision <> '' THEN
      '/api/publication-covers/opportunity/' || c.id || '/' || c.cover_revision || '.jpg'
    ELSE '' END,
    CASE WHEN n.status='published' THEN n.cover_alt ELSE coalesce(c.cover_alt, '') END
  FROM public.claim_publication_email() job
  LEFT JOIN public.nodal_news n ON n.id = job.news_id
  LEFT JOIN public.catalog_items c ON c.id = job.catalog_id
    AND c.kind='opportunity' AND c.status='published' AND c.visibility='public';
$$;
REVOKE ALL ON FUNCTION public.claim_publication_email_with_cover() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_publication_email_with_cover() TO service_role;
COMMIT;
