-- A FRAC dictionary upload (services/document.service.ts, Nov 2026): a whole existing FRAC in one workbook (roles,
-- activities, mappings, competencies, ladders, sources), which the Creator steps then update. Allows the new kind.
-- The constraint is the unnamed CHECK from 010, which PostgreSQL names frac_documents_kind_check.
ALTER TABLE frac_documents DROP CONSTRAINT IF EXISTS frac_documents_kind_check;
ALTER TABLE frac_documents ADD CONSTRAINT frac_documents_kind_check
  CHECK (kind IN ('brief', 'dictionary', 'roles', 'competencies', 'sources'));
