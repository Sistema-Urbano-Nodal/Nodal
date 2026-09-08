-- Keep the text comparison in a JSON RPC body, not a long PostgREST URL.
-- Only the trusted NODAL server may call this function with a verified owner.
CREATE FUNCTION public.edit_own_course_post(
 p_id uuid, p_course_id uuid, p_user_id uuid, p_expected_body text, p_body text
) RETURNS SETOF public.course_posts
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 UPDATE public.course_posts
 SET body=p_body
 WHERE id=p_id AND course_id=p_course_id AND user_id=p_user_id
   AND deleted_at IS NULL AND body=p_expected_body
   AND char_length(p_body) BETWEEN 1 AND 6000 AND btrim(p_body)<>''
 RETURNING *;
$$;
REVOKE ALL ON FUNCTION public.edit_own_course_post(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.edit_own_course_post(uuid,uuid,uuid,text,text) TO service_role;
