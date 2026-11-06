-- 001: initial FRAC Studio schema (spec section 4): fracs, frac_versions, reviews and jobs.
-- Applied once by `npm run migrate` (or MIGRATE_ON_START=true), inside a transaction.
-- One JSONB doc per FRAC is enough: FRACs stay under 1 MB.

-- One row per FRAC; owner_id comes from the x-aastrika-creator header and scopes every read
CREATE TABLE IF NOT EXISTS fracs (
  id          UUID PRIMARY KEY,
  owner_id    TEXT        NOT NULL,
  org_id      TEXT,
  cadre       TEXT        NOT NULL,
  state       TEXT        NOT NULL,
  step        SMALLINT    NOT NULL DEFAULT 1,
  doc         JSONB       NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fracs_owner_updated_idx ON fracs (owner_id, updated_at DESC);

-- Snapshot on every completed step so a bad revise can be rolled back (spec 4.1)
CREATE TABLE IF NOT EXISTS frac_versions (
  id          BIGSERIAL PRIMARY KEY,
  frac_id     UUID        NOT NULL REFERENCES fracs (id) ON DELETE CASCADE,
  step        SMALLINT    NOT NULL,
  reason      TEXT        NOT NULL,
  doc         JSONB       NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS frac_versions_frac_idx ON frac_versions (frac_id, created_at DESC);

-- source_model keeps the parsed workbook so a past review can be reopened in the Creator (spec gap 6)
CREATE TABLE IF NOT EXISTS reviews (
  id            UUID PRIMARY KEY,
  owner_id      TEXT        NOT NULL,
  org_id        TEXT,
  frac_id       UUID        REFERENCES fracs (id) ON DELETE SET NULL,
  kind          TEXT        NOT NULL CHECK (kind IN ('upload', 'expert-check')),
  source_name   TEXT,
  ctx           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  source_model  JSONB,
  report        JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reviews_owner_created_idx ON reviews (owner_id, created_at DESC);

-- Background jobs (Creator steps, reviews, checks); the portal polls status and done/total for progress
CREATE TABLE IF NOT EXISTS jobs (
  id          UUID PRIMARY KEY,
  owner_id    TEXT        NOT NULL,
  kind        TEXT        NOT NULL,
  target_id   UUID,
  status      TEXT        NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'error')),
  msg         TEXT,
  done        INTEGER     NOT NULL DEFAULT 0,
  total       INTEGER     NOT NULL DEFAULT 0,
  error       TEXT,
  -- token and cost accounting per job (spec section 9)
  usage       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_target_idx ON jobs (target_id, created_at DESC);
