-- Optional persisted course content translations. Base text remains the fallback.
-- Access remains through the existing service-only course APIs and RLS policies.
ALTER TABLE public.pilot_courses
  ADD COLUMN IF NOT EXISTS translations jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.course_modules
  ADD COLUMN IF NOT EXISTS translations jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.pilot_courses
  ADD CONSTRAINT pilot_courses_translations_object CHECK (jsonb_typeof(translations) = 'object');
ALTER TABLE public.course_modules
  ADD CONSTRAINT course_modules_translations_object CHECK (jsonb_typeof(translations) = 'object');
