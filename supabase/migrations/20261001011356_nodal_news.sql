BEGIN;
-- NODAL-wide news, written by administrators in the Publishing desk and read through
-- NODAL's own API (server/news-api.js). The browser never queries this table.
CREATE TABLE public.nodal_news (
 id uuid PRIMARY KEY,
 title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 160),
 body text NOT NULL CHECK(char_length(body)<=2000),
 url text NOT NULL CHECK(url='' OR (url LIKE 'https://%' AND char_length(url)<=500)),
 status text NOT NULL CHECK(status IN ('draft','published')),
 pinned boolean NOT NULL DEFAULT false,
 -- Set on the first publication and kept afterwards, so republishing never reorders the feed.
 published_at timestamptz,
 created_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL,
 created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 version integer NOT NULL CHECK(version>0),
 CONSTRAINT nodal_news_published_at CHECK(status='draft' OR published_at IS NOT NULL)
);
-- The public feed: published items, pinned first, then newest, keyset-paginated on id.
CREATE INDEX nodal_news_public ON public.nodal_news(status,pinned DESC,published_at DESC,id DESC);
-- The desk: newest written first.
CREATE INDEX nodal_news_recent ON public.nodal_news(created_at DESC,id DESC);
-- Account erasure sets created_by to NULL without scanning the table.
CREATE INDEX nodal_news_created_by ON public.nodal_news(created_by);
-- No browser role reads or writes news. PostgREST still applies object privileges to
-- service-role calls, so the server gets only what server/news-repository.js uses.
ALTER TABLE public.nodal_news ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nodal_news FROM PUBLIC,anon,authenticated;
REVOKE ALL ON TABLE public.nodal_news FROM service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.nodal_news TO service_role;
COMMIT;
