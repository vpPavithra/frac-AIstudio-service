-- 003: adds reviews.fingerprint and an (owner_id, fingerprint) index.
-- Review engine r3 (rules §9): the same file and context return the stored review. Reviews are looked
-- up by owner and fingerprint; the fingerprint includes the engine version and the rule tables.
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS fingerprint TEXT;
CREATE INDEX IF NOT EXISTS reviews_owner_fingerprint_idx ON reviews (owner_id, fingerprint);
