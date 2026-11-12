# Changelog

What changed, and why. Newest first. Nothing here is deployed yet: FRAC Studio ships once, after the
full pre-deploy test checklist passes.

## Unreleased: FRAC Studio review decisions (11 Nov 2026)

The eight decisions from the FRAC Studio review. What changed where: `docs/releases/REVIEW_DECISIONS_2026-11.md`;
the cost effect: `docs/COST_IMPACT_REVIEW_DECISIONS.md`.

- **Documents and standard sheets.** `POST/GET/DELETE /v1/fracs/:id/documents` and the `frac_documents` table
  (`migrations/010_frac_documents.sql`):
  - A job description or government order (PDF via `unpdf`, DOCX via `mammoth`, TXT) feeds research, which then
    searches once instead of 3 times.
  - A standard Roles, Competencies or Sources sheet (.xlsx or .csv) replaces that AI step:
    - roles only fill empty roles;
    - competencies only map, in a new `mapping` task;
    - research doesn't search.
  - Templates for each kind are at `GET /v1/templates/:kind`.
- **Position matching.** `GET /v1/fracs/match` finds the owner's FRAC for exactly the same position. `seed` on
  `POST /v1/fracs` starts from it, or from a Positions-master entry the portal read (`seededFrom`).
- **Agent-chosen size.** `size` is optional on create. Without it, research picks the size and says why
  (`sizeBy`, `sizeReason`).
- **View Source.** Sources carry an optional `url`. The agent gives each source's address; `source-links.ts` keeps it
  only when it is a searched page (Claude `citations`) or an address on `RESEARCH_SEARCH_DOMAINS` or
  `SOURCE_LINK_DOMAINS` that answers a check (`SOURCE_LINK_CHECK_TIMEOUT_MS`, `SOURCE_LINK_MAX_CHECKS`). The research
  prompt now asks the agent to search before listing sources (a run could finish with no search). The Excel has a URL
  column.
- **Gemini removed.** The Gemini provider, the `gemini-free` and `gemini-paid` profiles, the `@google/genai`
  dependency and `GEMINI_API_KEY` are gone. `claude` is the default `AI_PROVIDER` and `MOCK_PRICED_AS`; the
  remaining profiles are `claude`, `claude-mixed` and `claude-fast`. Only `ANTHROPIC_API_KEY` is needed.
- **Wording.** The job messages say "The agent" instead of the persona names, and "Position" instead of "Cadre"
  (the validation message and the Excel label). The prompts and the `cadre` field are unchanged.
- **Draft Excel.** The Excel can be downloaded before the expert check. A draft (no check yet, or one that is out
  of date) has no "Expert check" sheet and says "not yet expert-checked".
- **Tests.** 184 passed and 3 skipped. New: `src/mocks/review-decisions.test.ts` (it asserts which AI calls each
  case makes), `src/services/documents/documents.test.ts`, and the citation capture.

## Unreleased: review fixes, safer jobs, spending limit (9–11 Nov 2026)

**Review rules** (`e2c85ee`). The ASHA injections rule and the ASHA and ANM prescribing rules no longer raise
Blockers on sentences that rule the act out ("does not … inject", "without … injections", "correct any drift to
… prescribing"). "Family / birth / discharge / care / delivery planning" is no longer read as the KCM
competency "Planning". On the ASHA Karnataka FRAC the rule-based findings went from 4 to 1.

**Expert check out of date** (`0c67832`). A ladders run or a content edit after the expert check sets
`reviewStale`; the portal shows the old findings with a note, offers "Re-run expert check" and holds the
Excel download until the check runs again.

**One running job per FRAC or review** (`1d00638`). A second start answers 409 `JOB_RUNNING` with the live
job's id; a job silent for two heartbeats is replaced. `migrations/009_one_active_job.sql` adds the unique
index. `GET /v1/fracs/:id` returns `activeJobId`.

**Spending limit** (`74fee93`). A job stops with `AI_BUDGET_EXCEEDED` once its billed spend reaches
`JOB_MAX_COST_USD` ($3); estimates never count.

**Docs and reports.** `docs/API_REFERENCE.md`, `docs/DATABASE.md`, the 9 Nov build report, the ASHA Karnataka
cost and review analysis, and the 9 Nov daily report.

## Unreleased: AI response report and release tracking (6 Nov 2026)

**Measured calls.** Every model call goes through one `askModel` helper and is logged to `ai_calls`
(`migrations/004_ai_calls.sql`): provider, model, task, tier, time, tokens, cost and outcome (ok, wrong shape,
or the provider's error code). No prompt or answer text is stored. Each review also records how many AI
flags it raised, kept and dropped, by reason (`report.aiChecklist`).

**Report.** `npm run ai:report` writes `reports/ai-report-<date>.md`. **Releases.** `docs/releases/TEMPLATE.md`,
`docs/releases/AI_SERVICE_TRACKER.md` (updates, blockers, AI quality over time) and a draft `release-0.2.0.md`.

## Unreleased: switchable AI providers (6 Nov 2026, `58d2441`)

**Providers.** Before: Claude only, picked when `ANTHROPIC_API_KEY` was set. Now `AI_PROVIDER` names a
profile in `config/ai-providers.json` (`gemini-free`, the default; `gemini-paid`; `claude`) or `mock`. A
profile holds the model and thinking level per tier, prices, the key's variable name, web search, a
free-tier flag and a cap on calls in flight. Adding a provider is one file plus a profile.

**Gemini.** New `providers/text/gemini.ts` on `@google/genai` 2.30.0. The free tier runs `gemini-3.6-flash`
on both tiers (`gemini-3.8-flash` was overloaded on 6 Nov 2026) with no web search, one call at a time, and shows cost as a paid-price estimate.

**Scripts.** `dev:mock`, `dev:mock:seed`, `dev:ai`, `start:mock`, `start:ai`, and `ai:check` (one tiny real
call per tier). Removed settings: `ANTHROPIC_*_MODEL`, `LLM_*_EFFORT`, `RATE_*` (now in the profiles).

**Docs.** `docs/FRAC_STUDIO_GUIDE.md`: each step, the Reviewer, running, providers, pricing, configuration.

## Unreleased: settings in config, three fixes, comments (6 Nov 2026, `6db13e9`, `6878558`)

**Config.** Batch sizes, review checklist limits, LLM token and resume caps, the Postgres pool and the
brief-size targets (`config/frac-sizes.json`) are settings now.

**Fixes.** The Review and Expert check sheets style their findings header again. Running jobs send a
heartbeat, so the watchdog no longer takes a long model call for a dead job. AI flags are dropped only
by ladder rules marked `suppressesAiFlags`, and frontline-only rules no longer drop flags for other cadres.

**Docs.** File header comments across the repo and `docs/CODEBASE_GUIDE.md`.

## Unreleased: AI steps and review engine r3 (5 Nov 2026, `127ddc7`)

**AI steps.** Research, roles and activities, competencies and level ladders run as jobs through one
`TextProvider` seam, with batching, revise-with-feedback, versions and a sample-data mock.

**Review engine r3.** Rule-based checks in code, Vidya's fixed checklist (Q1 scope, Q2 accuracy, Q3 state
fit) with quote checks, a computed verdict, and "same file, same review" by fingerprint
(`migrations/003_review_fingerprint.sql`, `POST /v1/frac-reviews/:id/rerun`).

**Cost.** Tokens, web searches and USD per call, added up per job and shown in the portal.

## Unreleased: aligned with aastrika-ai-service

**Folder layout.** Files moved to the sibling repo's layout with no logic change: `models/` for the domain
types, one repository file per entity, the review engine, Excel and job runner under `services/`, and the
middleware and utils renamed to match (`auth`, `errorHandler`, `requestContext`, `requestLogger`, `upload`,
`response`, `context`). Kept as they were, by decision: the service at the repo root, Jest, and numbered
migrations.

**Errors.** Before: `{ error: "message" }`, so a client could only match on English text. Now every
failure is `{ error: { code, message, details? } }` through one `ApiError`, with codes listed in
docs/ONBOARDING.md. Status codes are deliberate: a locked brief or an unfinished review is 409, not 400.

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
