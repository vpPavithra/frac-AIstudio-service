-- Documents a team attaches to a FRAC (services/document.service.ts): a job description or government order
-- for the research step (kind 'brief', its extracted text in `text`), or a standard Roles, Competencies or
-- Sources sheet that replaces an AI step (`parsed` holds the import summary; for sources, the rows too).
-- The uploaded file itself is never stored.
CREATE TABLE IF NOT EXISTS frac_documents (
  id          UUID        PRIMARY KEY,
  frac_id     UUID        NOT NULL REFERENCES fracs (id) ON DELETE CASCADE,
  owner_id    TEXT        NOT NULL,
  kind        TEXT        NOT NULL CHECK (kind IN ('brief', 'roles', 'competencies', 'sources')),
  filename    TEXT        NOT NULL,
  mime        TEXT        NOT NULL DEFAULT '',
  bytes       INTEGER     NOT NULL DEFAULT 0,
  text        TEXT        NOT NULL DEFAULT '',
  parsed      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS frac_documents_frac_idx ON frac_documents (frac_id, created_at);
