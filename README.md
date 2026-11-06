# frac-studio-service

Backend for FRAC Studio (FRAC Creator, FRAC Reviewer, My FRACs). The UI lives in `sunbird-cb-orgportal`
at `app/frac-studio`, and calls this service through `sunbird-cb-uiproxy` at `/apis/protected/v8/fracStudio/*`.
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and [docs/CODEBASE_GUIDE.md](docs/CODEBASE_GUIDE.md) for what every folder and file does.
[docs/FRAC_STUDIO_GUIDE.md](docs/FRAC_STUDIO_GUIDE.md) explains each Creator step and the Reviewer, how to run mock, Gemini or
Claude, the pricing and the configuration.

## Run

```bash
cp .env.example .env      # fill the POSTGRES_* settings
npm install
npm run migrate           # applies migrations/*.sql not yet recorded in schema_migrations
npm run dev               # http://localhost:3005/health
```

Without Postgres: `FRAC_STUDIO_STORE=memory npm run dev` (data is lost on restart). For orgportal local
development, run it on another port (`PORT=3010`) and add the `/apis/protected/v8/fracStudio` rule to
orgportal's `proxy/localhost.proxy.json`.

Settings live in `config/service.json` (provider choice, limits, timeouts, CORS) and `config/ai-providers.json` (models, prices); the environment overrides
any of them, and `.env` holds secrets and per-deployment values only. After editing config, run
`npm run config:check`. `npm run check` runs typecheck, lint, config check and tests. New here? Read
`ONBOARDING.md` and `CLAUDE.md`.

## AI provider: switchable, mock or a real model

The AI steps call whichever provider `AI_PROVIDER` names. Nothing else changes between them: same steps,
batching, progress, checks, report and export.

| `AI_PROVIDER` | Answers from | Key (environment only) |
|---|---|---|
| `mock` | `src/mocks/` sample data, no cost, no network | none |
| `gemini-free` (the default in `config/service.json`) | Gemini API free tier, `gemini-3.6-flash` on both tiers (switch to `gemini-3.8-flash` once Google's overload clears), no web search | `GEMINI_API_KEY` |
| `gemini-paid` | Gemini API paid tier, `gemini-4-argon` (complex) + `gemini-3.8-flash`, Google Search for research | `GEMINI_API_KEY` |
| `claude` | Claude Sonnet 5.5 on both tiers (high / medium thinking), web search for research | `ANTHROPIC_API_KEY` |
| `claude-fast` | The same model with less thinking (medium / low): faster and cheaper, for the effort comparison | `ANTHROPIC_API_KEY` |

The profiles live in [`config/ai-providers.json`](config/ai-providers.json): model and thinking level per
tier, list prices, which variable holds the key, web search, free tier and a cap on calls in flight.
Switching provider means changing `AI_PROVIDER` and setting that profile's key. Changing a model or a
price means editing the profile. Neither needs a code change.

| Command | What runs |
|---|---|
| `npm run dev:mock` | Sample data, whatever `AI_PROVIDER` says |
| `npm run dev:mock:seed` | Sample data, memory store, one finished FRAC and review preloaded |
| `npm run dev:ai` | The provider `AI_PROVIDER` names (`.env` overrides `service.json`); refuses to start on the mock, and stops if the key is missing |
| `npm run dev` | Whatever `AI_PROVIDER` says, mock included |
| `npm run ai:check` | One tiny real call per tier to prove the key, models and quota; prints tokens and cost |
| `npm run ai:report` | Writes `reports/ai-report-<date>.md`: by day (cost and billed), tokens, cost, model and wall time and thinking share per step, per FRAC / review, revisions and what they added, cost per user, by provider and task, slowest calls, failures, jobs, review checklist flags, and a warning when a day's billed spend passes `REPORT_DAILY_BUDGET_USD` ($5). `-- --days 7`, `-- --since 2026-11-01`, `-- --calls` to list every call |
| `npm run ai:report:daily` | One day's report, compared with the day before, with every call (start, finish, job, task, model, outcome, tokens, cost) in `reports/daily/ai-daily-<date>.md`. Today so far by default; `-- --yesterday` for a cron job after midnight, `-- --day 2026-11-06` for any day. Times in IST (`REPORT_UTC_OFFSET_MINUTES`) |
| `npm run start:mock` / `start:ai` | The same, from the built `dist/` |

**Make sure a run uses the AI, not the mock:**

1. Start it with `npm run dev:ai` (or `start:ai`). These set `AI_REQUIRE_REAL=true`, so the service refuses to start on the mock and says why. `npm run dev` does not: it follows whatever `AI_PROVIDER` says.
2. The startup log names the provider: `"ai":"gemini-free"` (or `claude`), never `"ai":"mock"`.
3. `curl -H 'x-aastrika-creator: me' localhost:3010/v1/info` returns `{"aiProvider":"gemini-free"}`.
4. After a step, `npm run ai:report -- --days 1` lists the calls under `gemini-free · gemini-3.6-flash`; mock calls show as `mock · mock`.

The cost in the portal reads "est." on both the mock and the Gemini free tier (no bill either way), so it does not tell them apart; the checks above do.

- **Where the key goes:** the service's `.env` locally (`GEMINI_API_KEY=…`); the deployment's secret store
  on a server. Never a file in `config/` (committed; startup refuses any `*_API_KEY` there).
- To try another provider for one run: `AI_PROVIDER=claude npm run dev:ai`.
- Startup logs `"ai":"gemini-free"` (or the name in use); `GET /v1/info` returns the same.
- **Free tier:** calls are not billed, so the cost on each job is what the same tokens would cost at the
  paid list price, marked `est.` in the portal. The profile runs one call at a time (`maxConcurrent: 1`)
  and the SDK waits and retries on a 429, so a full FRAC is slower than on a paid key. When the daily
  quota runs out, jobs fail with `AI_BUSY` until it resets (midnight Pacific).
- **Adding another provider** (e.g. OpenAI): write `src/providers/text/<kind>.ts` implementing
  `TextProvider`, add it to `FACTORIES` in `src/providers/registry.ts` and to `PROVIDER_KINDS` in
  `src/config/ai-providers.ts`, then add a profile. See `gemini.ts` for a complete example.

What switching affects, how to edit the sample data, and how to delete the mocks: [src/mocks/README.md](src/mocks/README.md).

## Releases and the AI response report

Every model call is logged to `ai_calls` (provider, model, task, time, tokens, cost, outcome; no prompt or
answer text), and every review stores how many AI flags it raised, kept and dropped.
`npm run ai:report` turns that into a Markdown report and `npm run ai:report:daily` writes one per day. The server log also prints an "AI call started" and an "AI call finished" line for every call, with its job, task, model, time, tokens and cost. To keep daily reports, schedule `npm run ai:report:daily -- --yesterday` after midnight IST (cron or a Jenkins job), on a machine that can reach the database. Release notes live in `RELEASE_NOTES/`: copy
[TEMPLATE.md](RELEASE_NOTES/TEMPLATE.md) per release, and keep updates, blockers and AI quality over time in
[AI_SERVICE_TRACKER.md](RELEASE_NOTES/AI_SERVICE_TRACKER.md).

## Deploy

Same pipeline as playlist-service (`Jenkinsfile`): `Dockerfile.build` compiles and zips `dist/`, `config/` and
`migrations/`; `build.sh` builds the runtime image from `Dockerfile` (Node 20 alpine, port 3005, runs as `node`).

- **Migrations:** run `node migrate.js` in the image once per deploy (a job or init container), or set
  `MIGRATE_ON_START=true`. Each file runs once, in its own transaction, under an advisory lock, so several
  replicas starting together are safe.
- **Network:** the service trusts the `x-aastrika-creator` header, so expose it only inside the cluster. The
  uiproxy reaches it through `FRAC_STUDIO_API_BASE` (default `${KONG_API_BASE}/frac-studio`, so a Kong route
  `/frac-studio` → this service, or point the variable straight at the service).
- **Shutdown:** on SIGTERM it stops taking requests and lets running jobs finish before exiting. Give the pod a
  termination grace period longer than the longest job.

## Test

```bash
npm test                  # unit tests (src/**/*.test.ts) + acceptance (test/*.test.ts)
npm run test:coverage
```

`test/pg.test.ts` runs the real migration and the API flows through the Postgres repositories on pg-mem (an
in-memory Postgres), so no database server is needed. It is close to Postgres but not identical; run
`npm run migrate` against a real database before the first deploy.

`test/sample.test.ts` runs three synthetic workbooks (GNM-, ANM- and Staff-Nurse-style, built in
`test/support/sample-workbooks.ts`) with every defect planted at a known count. `npm run fixtures:sample`
writes them to `test/fixtures/sample/` for manual uploads. They are test data, not clinical content.

The acceptance tests in `test/acceptance.test.ts` reproduce spec section 6.6 and are skipped until the real
dictionaries are copied into `test/fixtures/` (they are gitignored):

- `GNM COMPETENCY DICTIONARY 9 June 2025.xlsx`
- `ANM competencies 6aug2026.xlsx`
- `Staff Nurse competencies - India v0.1.xlsx`

## Extending the review rules

The review engine is r3 (`docs/spec/FRAC_Reviewer_rules_r3.md`). Clinical reviewers edit two files; no
code change or deploy is needed, both are read when a review runs:

| File | Holds | Override |
|---|---|---|
| `config/outdated.json` | Outdated laws and programme names (§4.5), with `onlyIfAbsent` / `frontlineOnly` conditions | `OUTDATED_CONFIG_PATH` |
| `config/review-rules.json` | Acts beyond scope per cadre (§4.4), ladder-shift rules (§4.3), core job areas per cadre (§5) | `REVIEW_RULES_CONFIG_PATH` |

The review fingerprint includes both files, so a stored review is never reused after a rule changes.
What is built against the spec and rules, and what is still open: `docs/spec/R3_GAP_ANALYSIS.md`.

## Tuning without a code change

Every tunable is a key in `config/service.json` (or an environment variable of the same name, which wins).
`npm run config:check` rejects unknown keys and non-numbers. These are read once at startup, so restart
the service after a change.

| What | Keys | Default |
|---|---|---|
| Provider | `AI_PROVIDER`, `MOCK_PRICED_AS` (whose prices the mock's estimate uses) | `gemini-free`, `gemini-free` |
| Call limits (every provider) | `LLM_TIMEOUT_MS`, `LLM_RETRIES`, `LLM_MAX_TOKENS`, `LLM_MAX_RESUMES`, `LLM_MAX_RETRY_DELAY_MS`, `LLM_INVALID_RETRIES` | 10 min, 3, 64,000, 3, 60 s, 1 |
| Creator batching | `AI_BATCH_SIZE`, `AI_BATCH_PARALLEL` (activities and ladders) | 4 per call, 6 at once |
| Review checklist | `REVIEW_BATCH_SIZE`, `REVIEW_BATCH_PARALLEL`, `REVIEW_MAX_STATE_ITEMS`, `REVIEW_MIN_QUOTE_WORDS` | 6, 6, 6, 4 |
| Research web search | `RESEARCH_WEB_SEARCH`, `RESEARCH_SEARCH_DOMAINS`, `RESEARCH_SEARCH_MAX_USES` | on, 4 government domains, 3 |
| Jobs | `JOB_STALE_AFTER_MS`, `JOB_SWEEP_EVERY_MS`, `JOB_HEARTBEAT_MS` | 15 min, 1 min, 1 min |
| Postgres pool | `POSTGRES_POOL_MAX`, `POSTGRES_CONNECT_TIMEOUT_MS`, `POSTGRES_IDLE_TIMEOUT_MS` | 10, 10 s, 30 s |
| Request limits | `MAX_UPLOAD_MB`, `MAX_JSON_MB`, `MAX_TEXT_CHARS`, `MAX_ROLES`, `MAX_ACTIVITIES_PER_ROLE`, `MAX_COMPETENCIES` | 15, 5, 20,000, 200, 200, 500 |

Models, thinking levels and prices are per provider in `config/ai-providers.json` (override with
`AI_PROVIDERS_CONFIG_PATH`). Startup stops if a profile is malformed, and `config:check` checks that
`AI_PROVIDER` and `MOCK_PRICED_AS` name a profile.

Brief sizes (roles, activities per role and competencies for compact, standard and full) are in
`config/frac-sizes.json` (override with `FRAC_SIZES_CONFIG_PATH`). Startup stops if a size is missing or a
count is not a positive whole number.

What stays in code on purpose: rules the spec fixes, such as at most 3 postings, 5 levels per ladder, the
fixed finding titles and the triage thresholds. Changing those changes the product, so they go through review.
