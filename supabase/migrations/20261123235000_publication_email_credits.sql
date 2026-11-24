BEGIN;

-- A voluntary editorial credit, independent of private creator and moderator identities.
ALTER TABLE public.nodal_news ADD COLUMN public_byline text NOT NULL DEFAULT ''
  CHECK (char_length(public_byline) <= 120);
ALTER TABLE public.catalog_items ADD COLUMN public_byline text NOT NULL DEFAULT ''
  CHECK (char_length(public_byline) <= 120);

-- Reuse the existing atomic claim. Older workers can keep using its original return type.
CREATE FUNCTION public.claim_publication_email()
RETURNS TABLE(event_id text,news_id uuid,catalog_id uuid,user_id uuid,attempts integer,email text,
              title text,url text,language text,excerpt text,byline text,organization text)
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT job.*,
    coalesce(n.body, nullif(btrim(c.translations->job.language->>'summary'), ''),
             c.translations->job.language->>'body', ''),
    coalesce(n.public_byline, c.public_byline, ''), coalesce(c.organization, '')
  FROM public.claim_news_email() job
  LEFT JOIN public.nodal_news n ON n.id = job.news_id
  LEFT JOIN public.catalog_items c ON c.id = job.catalog_id;
$$;
REVOKE ALL ON FUNCTION public.claim_publication_email() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_publication_email() TO service_role;
COMMIT;
