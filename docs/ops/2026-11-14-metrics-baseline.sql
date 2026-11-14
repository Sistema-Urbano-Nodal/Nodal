-- Read-only baseline for the indicator sheet and, later, the admin home: what the catalogue's figures are today.
-- One query, because `supabase db query` prints only the last statement's result. Run from the repository root:
--   npx --no-install supabase db query --linked -f docs/ops/2026-11-14-metrics-baseline.sql
-- Its values replace each `n` of the catalogue in docs/superpowers/specs/2026-11-14-admin-front-door-metrics-design.md
-- and each "por confirmar" and "por calcular" of the sheet. It needs no migration and never reads visit_counts.
-- Written from the catalogue definitions alone: do not edit it to match any later query; the home is checked against it.
-- Days are Lima days (UTC-5 all year). 7 days = Lima days today-6 to today, 30 days = today-29 to today, each from 05:00 UTC.
-- Not here, read from the festival panel the same day: "Inscripciones a bloques" and "Horas de asistencia".
-- Activity (C2): non-admin accounts only; "left out on purpose": fiiu_registrations.updated_at, attendance by staff,
-- follow interactions, catalog updates by staff, profiles.updated_at, course_enrollments, certificates.
select
 to_char(w.d, 'YYYY-MM-DD') as lima_day,
 -- Cuentas: every row of auth.users, the team's included
 (select count(*) from auth.users) as accounts,
 -- Con correo confirmado
 (select count(*) from auth.users where email_confirmed_at is not null) as confirmed,
 -- Cuentas nuevas: latest sign-up day, and the count by Lima month ("2026-07:9, 2026-09:40, ...")
 (select to_char(max(created_at) - interval '5 hours', 'YYYY-MM-DD') from auth.users) as last_signup_day,
 (select string_agg(m || ':' || n, ', ' order by m)
    from (select to_char(created_at - interval '5 hours', 'YYYY-MM') as m, count(*) as n
            from auth.users group by 1) months) as accounts_by_month,
 -- Entraron al menos una vez: rows of profiles, and those created in the two windows
 (select count(*) from public.profiles) as profiles,
 (select count(*) from public.profiles where created_at >= w.s7 and created_at < w.tomorrow) as profiles_7d,
 (select count(*) from public.profiles where created_at >= w.s30 and created_at < w.tomorrow) as profiles_30d,
 -- Cuentas del equipo
 (select count(*) from public.profiles where app_role = 'admin') as admins,
 -- Con ciudad
 (select count(*) from public.profiles where btrim(coalesce(city_region, '')) <> '') as with_city,
 -- Con intereses: accounts with a saved answer set whose interests are not null, and those with at least one
 (select count(distinct user_id) from public.onboarding_responses where interests is not null) as interests_not_null,
 (select count(distinct user_id) from public.onboarding_responses where cardinality(interests) > 0) as with_interests,
 -- Perfil basico completo: city not blank AND at least one interest
 (select count(*) from public.profiles p
   where btrim(coalesce(p.city_region, '')) <> ''
     and exists (select 1 from public.onboarding_responses o where o.user_id = p.id and cardinality(o.interests) > 0)) as basic_profile,
 -- Con biografia: trimmed profiles.bio, else raw_answers.partC.bio
 (select count(*) from public.profiles p
   where btrim(coalesce(p.bio, '')) <> ''
      or exists (select 1 from public.onboarding_responses o
                  where o.user_id = p.id and btrim(coalesce(o.raw_answers -> 'partC' ->> 'bio', '')) <> '')) as with_bio,
 -- Autoevaluacion hecha
 (select count(distinct user_id) from public.onboarding_responses where raw_answers -> 'assessed' = 'true'::jsonb) as assessed,
 -- Visibles en el directorio: account active AND consent (the stored choice, else the first-run answer)
 (select count(*) from public.profiles p
    cross join lateral (select coalesce((select pp.data_consent from public.profile_preferences pp
                                          where pp.user_id = p.id order by pp.updated_at desc limit 1), '{}'::jsonb) as dc) c
   where p.account_status = 'active'
     and case when c.dc ? 'directoryPublic'
              then c.dc -> 'directoryPublic' = 'true'::jsonb
              else exists (select 1 from public.onboarding_responses o
                            where o.user_id = p.id and o.raw_answers -> 'partC' -> 'consent' = 'true'::jsonb)
         end) as directory_visible,
 -- Perfil guardado: rows of onboarding_responses
 (select count(*) from public.onboarding_responses) as onboarding_rows,
 -- Abrieron contenido, sin el equipo
 (select count(distinct e.user_id) from public.course_events e
    join public.profiles p on p.id = e.user_id and p.app_role <> 'admin') as course_openers_non_admin,
 -- Encuesta final, N: non-admin people enrolled before the September group's cut-off
 (select count(distinct e.user_id) from public.course_enrollments e
    join public.profiles p on p.id = e.user_id and p.app_role <> 'admin'
   where e.created_at::timestamptz < '2026-10-01T00:00:00Z'::timestamptz) as survey_n,
 -- Miembros con actividad, overall and per kind, for both windows
 a.active_7d, a.active_30d,
 a.active_profile_7d, a.active_profile_30d,
 a.active_network_7d, a.active_network_30d,
 a.active_opportunities_7d, a.active_opportunities_30d,
 a.active_festival_7d, a.active_festival_30d,
 a.active_courses_7d, a.active_courses_30d,
 a.active_membership_7d, a.active_membership_30d,
 -- Pais (respuesta de inscripcion), raw: lower(btrim(country)) and its count, most frequent first
 (select string_agg(c || ':' || n, ', ' order by n desc, c)
    from (select lower(btrim(coalesce(answers ->> 'country', ''))) as c, count(*) as n
            from public.fiiu_registrations group by 1) countries_raw) as countries
from (select (now() - interval '5 hours')::date as d,
             ((((now() - interval '5 hours')::date - 6)::timestamp + interval '5 hours') at time zone 'UTC') as s7,
             ((((now() - interval '5 hours')::date - 29)::timestamp + interval '5 hours') at time zone 'UTC') as s30,
             ((((now() - interval '5 hours')::date + 1)::timestamp + interval '5 hours') at time zone 'UTC') as tomorrow) w
cross join lateral (
 select
  count(distinct x.user_id) filter (where x.t >= w.s7 and x.t < w.tomorrow) as active_7d,
  count(distinct x.user_id) filter (where x.t >= w.s30 and x.t < w.tomorrow) as active_30d,
  count(distinct x.user_id) filter (where x.kind = 'profile' and x.t >= w.s7 and x.t < w.tomorrow) as active_profile_7d,
  count(distinct x.user_id) filter (where x.kind = 'profile' and x.t >= w.s30 and x.t < w.tomorrow) as active_profile_30d,
  count(distinct x.user_id) filter (where x.kind = 'network' and x.t >= w.s7 and x.t < w.tomorrow) as active_network_7d,
  count(distinct x.user_id) filter (where x.kind = 'network' and x.t >= w.s30 and x.t < w.tomorrow) as active_network_30d,
  count(distinct x.user_id) filter (where x.kind = 'opportunities' and x.t >= w.s7 and x.t < w.tomorrow) as active_opportunities_7d,
  count(distinct x.user_id) filter (where x.kind = 'opportunities' and x.t >= w.s30 and x.t < w.tomorrow) as active_opportunities_30d,
  count(distinct x.user_id) filter (where x.kind = 'festival' and x.t >= w.s7 and x.t < w.tomorrow) as active_festival_7d,
  count(distinct x.user_id) filter (where x.kind = 'festival' and x.t >= w.s30 and x.t < w.tomorrow) as active_festival_30d,
  count(distinct x.user_id) filter (where x.kind = 'courses' and x.t >= w.s7 and x.t < w.tomorrow) as active_courses_7d,
  count(distinct x.user_id) filter (where x.kind = 'courses' and x.t >= w.s30 and x.t < w.tomorrow) as active_courses_30d,
  count(distinct x.user_id) filter (where x.kind = 'membership' and x.t >= w.s7 and x.t < w.tomorrow) as active_membership_7d,
  count(distinct x.user_id) filter (where x.kind = 'membership' and x.t >= w.s30 and x.t < w.tomorrow) as active_membership_30d
 from (
  -- Perfil
  select 'profile' as kind, o.user_id, v.t from public.onboarding_responses o,
    lateral (values (o.created_at), (o.updated_at)) v(t)
  union all select 'profile', f.user_id, f.created_at::timestamptz from public.pilot_feedback f where f.action = 'profile'
  -- Red
  union all select 'network', f.user_id, f.created_at from public.member_follows f
  union all select 'network', i.from_user_id, i.created_at from public.member_interactions i where i.type = 'skip'
  union all select 'network', f.user_id, f.created_at::timestamptz from public.pilot_feedback f where f.action = 'matching'
  -- Oportunidades
  union all select 'opportunities', c.user_id, c.created_at from public.catalog_interests c
  union all select 'opportunities', c.user_id, c.updated_at from public.catalog_interests c where c.updated_by = c.user_id
  -- Festival
  union all select 'festival', r.user_id, r.created_at from public.fiiu_registrations r
  union all select 'festival', r.user_id, a.created_at from public.fiiu_attendance a
    join public.fiiu_registrations r on r.id = a.registration_id where a.method = 'qr'
  union all select 'festival', m.user_id, m.created_at from public.fiiu_messages m where m.organiser = false
  union all select 'festival', l.user_id, l.created_at from public.fiiu_message_likes l
  union all select 'festival', g.user_id, v.t from public.fiiu_ratings g,
    lateral (values (g.created_at), (g.updated_at)) v(t)
  -- Cursos
  union all select 'courses', e.user_id, e.created_at::timestamptz from public.course_events e
  union all select 'courses', p.user_id, p.created_at::timestamptz from public.course_posts p where p.staff = false
  union all select 'courses', s.user_id, v.t::timestamptz from public.course_survey_responses s,
    lateral (values (s.created_at), (s.submitted_at)) v(t)
  union all select 'courses', f.user_id, f.created_at::timestamptz from public.pilot_feedback f
    where f.action not in ('profile', 'matching')
  -- Membresia
  union all select 'membership', m.user_id, m.accepted_at from public.membership_acceptances m
 ) x
 join public.profiles pr on pr.id = x.user_id and pr.app_role <> 'admin'
) a;
