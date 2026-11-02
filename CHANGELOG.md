# Changelog

What changed, and why. Newest first. Nothing here is deployed yet: FRAC Studio ships once, after the
full pre-deploy test checklist passes.

## Unreleased: aligned with aastrika-ai-service

**Errors.** Before: `{ error: "message" }`, so a client could only match on English text. Now every
failure is `{ error: { code, message, details? } }` through one `ApiError`, with codes listed in
ONBOARDING.md. Status codes are deliberate: a locked brief or an unfinished review is 409, not 400.

**Validation.** Before: hand-written checks inside the services. Now every request body has a Zod
schema in `src/validations/`; services receive typed, validated input. `rolesDirty: true` from a client
is now refused (it was silently ignored).

**Layout.** One routes file became `routes/` (wiring) plus `controllers/` (HTTP), as in the sibling repo.

**Config.** Models, rates, limits, timeouts and CORS moved from `.env` into the committed
`config/service.json`, read through `config/constants.ts`. Startup refuses a secret in the file.
`npm run config:check` (in CI) rejects unknown keys and non-numeric numbers.

**Logging.** Structured logger (JSON in the image) with a request id on every line and one access line
per request, replacing `console.*`.

**Stuck jobs.** Before: a restart left jobs "running" forever and the portal spun indefinitely. Now a
watchdog fails queued/running jobs untouched for `JOB_STALE_AFTER_MS` with `JOB_INTERRUPTED`, at
startup and every `JOB_SWEEP_EVERY_MS`. Migration 002 adds `jobs.error_code`.

**Hardening.** CORS is an exact-origin allowlist, empty by default (only the proxy calls the service).
The Docker image has a `HEALTHCHECK`. CI runs typecheck and the config check.

## 0.1.0: first build (2 Nov 2026)

- Deterministic review engine: tolerant workbook parser, mapping-cell parser, the five computed checks,
  outdated names from `config/outdated.json`, report merge.
- Excel read and write for the FRAC and review downloads; exports re-import cleanly.
- Spec section 8 API: FRACs, team edits with autosave support, expert check, version history and restore,
  reviews with upload, export and open-in-Creator, job polling.
- Postgres and in-memory stores; numbered migrations with an advisory-locked runner; deploy packaging
  (Dockerfile, Jenkinsfile, CI).
- AI review behind a seam with a computed-only stand-in until the prompts arrive from the prototype.
