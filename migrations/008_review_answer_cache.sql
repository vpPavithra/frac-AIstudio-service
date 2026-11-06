-- Stored AI checklist answers, so an expert check re-asks the model only about competencies whose text
-- changed (services/ai-review.service.ts). key = sha256 of the provider, cadre, state, prompt wording and the
-- competency's text and rule hits ("competency"), or of the whole FRAC ("state" fit). Insert-only.
CREATE TABLE IF NOT EXISTS review_answer_cache (
  key         TEXT PRIMARY KEY,
  kind        TEXT        NOT NULL CHECK (kind IN ('competency', 'state')),
  answer      JSONB       NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
