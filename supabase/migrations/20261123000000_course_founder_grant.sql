-- A null basis is an existing seat awaiting individual reconciliation. Never infer payment from a badge.
ALTER TABLE public.course_enrollments
  ADD COLUMN IF NOT EXISTS access_basis text CHECK (access_basis IN ('founder', 'independent'));
