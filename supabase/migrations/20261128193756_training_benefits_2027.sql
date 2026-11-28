BEGIN;
CREATE TABLE public.training_terms_2027 (
 user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
 status text NOT NULL CHECK(status IN ('active','inactive','suspended')), activated_at timestamptz,updated_at timestamptz NOT NULL
);
CREATE TABLE public.training_offerings_2027 (
 course_id uuid PRIMARY KEY REFERENCES public.pilot_courses(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('course','masterclass')),included_eligible boolean NOT NULL,
 regular_cents integer NOT NULL CHECK(regular_cents BETWEEN 0 AND 100000000),promo_cents integer CHECK(promo_cents BETWEEN 0 AND 100000000),
 capacity integer NOT NULL CHECK(capacity BETWEEN 1 AND 100000)
);
CREATE TABLE public.training_reservations_2027 (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 course_id uuid NOT NULL REFERENCES public.training_offerings_2027(course_id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('course','masterclass')),mode text NOT NULL CHECK(mode IN ('included','additional')),
 status text NOT NULL CHECK(status IN ('enrolled','pending')),price_cents integer NOT NULL CHECK(price_cents BETWEEN 0 AND 100000000),
 created_at timestamptz NOT NULL,confirmed_at timestamptz,
 enrollment_id uuid UNIQUE REFERENCES public.course_enrollments(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 UNIQUE(user_id,course_id),CHECK(mode<>'included' OR (status='enrolled' AND price_cents=0)),
 CHECK((status='pending' AND confirmed_at IS NULL AND enrollment_id IS NULL) OR
       (status='enrolled' AND confirmed_at IS NOT NULL AND enrollment_id IS NOT NULL))
);
CREATE UNIQUE INDEX training_included_2027 ON public.training_reservations_2027(user_id,kind) WHERE mode='included';
CREATE INDEX training_roster_2027 ON public.training_reservations_2027(course_id,status);
ALTER TABLE public.training_terms_2027 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_offerings_2027 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_reservations_2027 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.training_terms_2027,public.training_offerings_2027,public.training_reservations_2027 FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.training_terms_2027,public.training_offerings_2027 TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.training_reservations_2027 TO service_role;

CREATE FUNCTION public.training_2027_term(p_user uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT to_jsonb(t) FROM public.training_terms_2027 t WHERE t.user_id=p_user;
$$;
CREATE FUNCTION public.training_2027_offering(p_course uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT to_jsonb(o) FROM public.training_offerings_2027 o WHERE o.course_id=p_course;
$$;
CREATE FUNCTION public.training_2027_occupied(p_course uuid) RETURNS integer LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT count(*)::int FROM (SELECT user_id FROM public.course_enrollments WHERE course_id=p_course
 UNION SELECT user_id FROM public.training_reservations_2027 WHERE course_id=p_course) AS places;
$$;
CREATE FUNCTION public.training_2027_snapshot(p_user uuid,p_course uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('member_active',EXISTS(SELECT FROM public.profiles WHERE id=p_user AND account_status='active'),
 'term',public.training_2027_term(p_user),'used',(SELECT jsonb_build_object('course',count(*) FILTER(WHERE kind='course'),
  'masterclass',count(*) FILTER(WHERE kind='masterclass')) FROM public.training_reservations_2027 WHERE user_id=p_user AND mode='included'),
 'course',(SELECT to_jsonb(c) FROM (SELECT id,title,status,starts_on,ends_on,enrollment_open FROM public.pilot_courses WHERE id=p_course) c),
 'offering',public.training_2027_offering(p_course),'occupied',public.training_2027_occupied(p_course),
 'enrollment',(SELECT id FROM public.course_enrollments WHERE user_id=p_user AND course_id=p_course),
 'reservation',(SELECT to_jsonb(r) FROM public.training_reservations_2027 r WHERE r.user_id=p_user AND r.course_id=p_course));
$$;
CREATE FUNCTION public.training_2027_listing(p_user uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(public.training_2027_snapshot(p_user,o.course_id) ORDER BY c.starts_on,c.id),'[]'::jsonb)
 FROM public.training_offerings_2027 o JOIN public.pilot_courses c ON c.id=o.course_id WHERE c.status='published';
$$;
CREATE FUNCTION public.training_2027_pending(p_course uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.created_at,r.id),'[]'::jsonb) FROM public.training_reservations_2027 r
 WHERE r.course_id=p_course AND r.status='pending';
$$;
CREATE FUNCTION public.training_2027_set_term(p_user uuid,p_status text,p_at timestamptz) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 PERFORM id FROM public.profiles WHERE id=p_user AND (p_status<>'active' OR account_status='active') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'training_member_missing'; END IF;
 INSERT INTO public.training_terms_2027 AS t(user_id,status,activated_at,updated_at)
 VALUES(p_user,p_status,CASE WHEN p_status='active' THEN p_at END,p_at) ON CONFLICT(user_id) DO UPDATE
 SET status=excluded.status,activated_at=coalesce(t.activated_at,excluded.activated_at),updated_at=excluded.updated_at;
 RETURN public.training_2027_term(p_user);
END $$;
CREATE FUNCTION public.training_2027_configure(p_course uuid,p_config jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE c public.pilot_courses; kind_name text := p_config->>'kind'; cap integer := (p_config->>'capacity')::integer;
BEGIN
 SELECT * INTO c FROM public.pilot_courses WHERE id=p_course FOR NO KEY UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'training_offering_missing'; END IF;
 IF p_course='72e3cc56-a506-4a1b-97b5-9333e8d283ca' OR c.starts_on !~ '^2027-[0-9]{2}-[0-9]{2}$'
 OR (c.ends_on<>'' AND (c.ends_on !~ '^2027-[0-9]{2}-[0-9]{2}$' OR c.ends_on<c.starts_on)) THEN RAISE EXCEPTION 'training_invalid'; END IF;
 IF cap<public.training_2027_occupied(p_course) OR EXISTS(SELECT FROM public.training_reservations_2027 WHERE course_id=p_course AND kind<>kind_name)
 THEN RAISE EXCEPTION 'training_conflict'; END IF;
 INSERT INTO public.training_offerings_2027(course_id,kind,included_eligible,regular_cents,promo_cents,capacity)
 VALUES(p_course,kind_name,(p_config->>'includedEligible')::boolean,(p_config->>'regularCents')::integer,(p_config->>'promoCents')::integer,cap)
 ON CONFLICT(course_id) DO UPDATE SET kind=excluded.kind,included_eligible=excluded.included_eligible,
 regular_cents=excluded.regular_cents,promo_cents=excluded.promo_cents,capacity=excluded.capacity;
 RETURN public.training_2027_offering(p_course);
END $$;
-- Includes the legacy course roster, direct enrollment and invitation acceptance transactions.
-- Lock against first-time configuration even when a course has no offer yet.
CREATE FUNCTION public.training_2027_guard_enrollment() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (OLD.id,OLD.course_id,OLD.user_id) IS DISTINCT FROM (NEW.id,NEW.course_id,NEW.user_id)
   AND EXISTS(SELECT FROM public.training_offerings_2027 WHERE course_id IN (OLD.course_id,NEW.course_id))
  THEN RAISE EXCEPTION 'training_reservation_required'; END IF;
  RETURN NEW;
 END IF;
 PERFORM id FROM public.pilot_courses WHERE id=NEW.course_id FOR NO KEY UPDATE;
 IF EXISTS(SELECT FROM public.training_offerings_2027 WHERE course_id=NEW.course_id) AND NOT EXISTS(
 SELECT FROM public.training_reservations_2027 WHERE course_id=NEW.course_id AND user_id=NEW.user_id AND enrollment_id=NEW.id AND status='enrolled')
 THEN RAISE EXCEPTION 'training_reservation_required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER training_guard_enrollment_2027 BEFORE INSERT OR UPDATE OF id,user_id,course_id ON public.course_enrollments
 FOR EACH ROW EXECUTE FUNCTION public.training_2027_guard_enrollment();
-- Only the server computes commands. The snapshot includes every field used to calculate price or eligibility.
-- Re-read it after taking the same locks as term/config writes. A competing writer causes the application to requote.
CREATE FUNCTION public.training_2027_apply(p_user uuid,p_course uuid,p_expected jsonb,p_command jsonb) RETURNS boolean
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE op text:=p_command->>'action'; mode_name text:=p_command->>'mode'; rid uuid:=(p_command->>'id')::uuid;
 eid uuid:=(p_command->>'enrollment')::uuid; stamp timestamptz:=(p_command->>'at')::timestamptz;
BEGIN
 PERFORM id FROM public.profiles WHERE id=p_user FOR UPDATE;
 PERFORM id FROM public.pilot_courses WHERE id=p_course FOR NO KEY UPDATE;
 -- Updating this row gives snapshot-isolated transactions a serialization failure rather than a stale capacity count.
 UPDATE public.training_offerings_2027 SET capacity=capacity WHERE course_id=p_course;
 IF NOT FOUND OR public.training_2027_snapshot(p_user,p_course) IS DISTINCT FROM p_expected THEN RETURN false; END IF;
 IF op='cancel' THEN
  DELETE FROM public.training_reservations_2027 WHERE id=rid AND user_id=p_user AND course_id=p_course AND status='pending';
  RETURN FOUND;
 ELSIF op='confirm' THEN
  UPDATE public.training_reservations_2027 SET status='enrolled',confirmed_at=stamp,enrollment_id=eid
  WHERE id=rid AND user_id=p_user AND course_id=p_course AND mode='additional' AND status='pending';
  IF NOT FOUND THEN RETURN false; END IF;
 ELSIF op='reserve' THEN
  INSERT INTO public.training_reservations_2027(id,user_id,course_id,kind,mode,status,price_cents,created_at,confirmed_at,enrollment_id)
  VALUES(rid,p_user,p_course,p_expected->'offering'->>'kind',mode_name,CASE WHEN eid IS NULL THEN 'pending' ELSE 'enrolled' END,
   (p_command->>'price')::integer,stamp,CASE WHEN eid IS NOT NULL THEN stamp END,eid);
 ELSE RAISE EXCEPTION 'training_invalid'; END IF;
 IF eid IS NOT NULL THEN
  INSERT INTO public.course_enrollments(id,user_id,course_id,created_at,access_basis)
  VALUES(eid,p_user,p_course,to_char(stamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),CASE WHEN mode_name='included' THEN 'founder' ELSE 'independent' END);
 END IF;
 RETURN true;
END $$;
CREATE FUNCTION public.training_2027_user_reservations(p_user uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.created_at,r.id),'[]'::jsonb)
 FROM public.training_reservations_2027 r WHERE r.user_id=p_user;
$$;
REVOKE ALL ON FUNCTION public.training_2027_term(uuid),public.training_2027_offering(uuid),public.training_2027_occupied(uuid),
 public.training_2027_snapshot(uuid,uuid),public.training_2027_listing(uuid),public.training_2027_pending(uuid),
 public.training_2027_set_term(uuid,text,timestamptz),public.training_2027_configure(uuid,jsonb),public.training_2027_guard_enrollment(),
 public.training_2027_apply(uuid,uuid,jsonb,jsonb),public.training_2027_user_reservations(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.training_2027_term(uuid),public.training_2027_offering(uuid),public.training_2027_occupied(uuid),
 public.training_2027_snapshot(uuid,uuid),public.training_2027_listing(uuid),public.training_2027_pending(uuid),
 public.training_2027_set_term(uuid,text,timestamptz),public.training_2027_configure(uuid,jsonb),public.training_2027_apply(uuid,uuid,jsonb,jsonb),
 public.training_2027_user_reservations(uuid) TO service_role;
COMMIT;
