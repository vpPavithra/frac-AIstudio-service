-- One row per server start, closed when it stops (Ctrl+C or a deploy's SIGTERM), so a report can cover
-- exactly one run: npm run ai:report:run. stopped_at stays null while the server runs, or if it crashed.
CREATE TABLE IF NOT EXISTS server_runs (
  id          BIGSERIAL PRIMARY KEY,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  stopped_at  TIMESTAMPTZ,
  provider    TEXT        NOT NULL,
  store       TEXT        NOT NULL,
  host        TEXT,
  pid         INTEGER
);
CREATE INDEX IF NOT EXISTS server_runs_started_idx ON server_runs (started_at DESC);
