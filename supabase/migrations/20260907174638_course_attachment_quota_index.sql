-- Cover the course foreign-key lookup and both personal/course-owned upload quotas.
CREATE INDEX IF NOT EXISTS course_attachments_course_owner
 ON public.course_attachments(course_id,user_id);
