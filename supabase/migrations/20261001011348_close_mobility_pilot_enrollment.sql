-- Close enrolment for the first course pilot (Curso Movilidad Nivel 2) after its
-- September cohort. Data only and idempotent: it changes nothing when the id is
-- absent or staff already closed the course from the teaching workspace. The
-- version bump makes a teaching form opened before closure fail with 409 instead
-- of silently reopening enrolment. Existing participants keep full access; the
-- course stays published (archiving would hide it from them).
UPDATE public.pilot_courses
SET enrollment_open = false,
    version = version + 1,
    updated_at = to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
WHERE id = '72e3cc56-a506-4a1b-97b5-9333e8d283ca' AND enrollment_open;
