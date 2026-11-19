BEGIN;

-- Profile searches carry only a revision. The image is read through a
-- separate signed-in endpoint that enforces the same consent as a member card.
ALTER TABLE public.profiles ADD COLUMN photo_revision uuid;
CREATE TABLE member_work.profile_photos (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  jpeg bytea NOT NULL CHECK (octet_length(jpeg) BETWEEN 1 AND 131072)
);
ALTER TABLE member_work.profile_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON member_work.profile_photos FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON member_work.profile_photos TO service_role;
-- Existing table-level service grants on profiles cover its new revision column.

CREATE FUNCTION public.set_member_profile_photo(p_actor uuid, p_revision uuid, p_jpeg bytea)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  -- Lock the account before its photo, including on remove. Two concurrent
  -- replacements cannot leave a revision belonging to the other image.
  UPDATE public.profiles SET photo_revision=p_revision WHERE id=p_actor AND account_status='active';
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_jpeg IS NULL AND p_revision IS NULL THEN
    DELETE FROM member_work.profile_photos WHERE user_id=p_actor;
  ELSIF p_jpeg IS NOT NULL AND p_revision IS NOT NULL THEN
    INSERT INTO member_work.profile_photos(user_id,jpeg) VALUES(p_actor,p_jpeg)
    ON CONFLICT(user_id) DO UPDATE SET jpeg=EXCLUDED.jpeg;
  ELSE
    RAISE EXCEPTION 'photo and revision must be changed together';
  END IF;
  RETURN true;
END $$;

CREATE FUNCTION public.read_member_profile_photo(p_actor uuid, p_member uuid, p_revision uuid)
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT encode(i.jpeg,'base64')
  FROM member_work.profile_photos i JOIN public.profiles p ON p.id=i.user_id
  WHERE p.id=p_member AND p.account_status='active'
    AND EXISTS (SELECT FROM public.profiles WHERE id=p_actor AND account_status='active')
    AND (p.id=p_actor OR member_work.eligible(p.id))
    AND (p_revision IS NULL OR p.photo_revision=p_revision)
$$;
REVOKE ALL ON FUNCTION public.read_member_profile_photo(uuid,uuid,uuid),
  public.set_member_profile_photo(uuid,uuid,bytea) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_member_profile_photo(uuid,uuid,uuid),
  public.set_member_profile_photo(uuid,uuid,bytea) TO service_role;

COMMIT;
