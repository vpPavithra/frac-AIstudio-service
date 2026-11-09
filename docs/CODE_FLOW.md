# Code flow: where the code starts and how each flow runs

Read this first. It follows the code from `npm run dev:ai` to a finished FRAC, a review and a report, with the
file and line where each hop happens. For what every file is, see [CODEBASE_GUIDE.md](CODEBASE_GUIDE.md); for
what the user sees at each step, see [FRAC_STUDIO_GUIDE.md](FRAC_STUDIO_GUIDE.md). Line numbers are as of
9 Nov 2026; if one has moved, search for the function name next to it.

## 1. What is where

Only `src/` runs in production. Everything else supports it.

```mermaid
flowchart LR
  subgraph Runs["Runs in production"]
    SRC["src/<br/>the service"]
    CFG["config/<br/>settings, provider profiles,<br/>review rule tables"]
    MIG["migrations/<br/>numbered SQL"]
  end
  subgraph Support["Not shipped"]
    TOOLS["tools/<br/>reports, ops checks, fixtures"]
    TEST["test/<br/>API and Postgres tests"]
    DOCS["docs/<br/>guides, spec, releases"]
    OUT["reports/<br/>generated report files"]
  end
  TOOLS -- "imports models and repositories" --> SRC
  TOOLS -- "writes" --> OUT
  TEST -- "imports" --> SRC
```

| Folder | What it holds | Shipped in the image? |
| --- | --- | --- |
| `src/` | The service: HTTP API, AI steps, review engine, jobs, storage. `src/` never imports `tools/` | Yes, compiled to `dist/` |
| `config/` | `service.json` (settings), `ai-providers.json` (models and prices), `review-rules.json` and `outdated.json` (rule tables), `frac-sizes.json`, `method.txt` | Yes |
| `migrations/` | `001`–`008` numbered SQL, applied once each | Yes |
| `tools/reports/` | The report builders and their command-line entry points (`npm run ai:report`, `ai:report:daily`, `ai:report:run`, `review:report`) | No |
| `tools/ops/` | `npm run config:check` (CI) and `npm run ai:check` (one tiny real call) | No |
| `tools/fixtures/` | `npm run fixtures:sample` (sample workbooks for tests) | No |
| `test/` | API, Postgres-path and acceptance tests, and shared test data | No |
| `docs/` | This file, the guides, architecture, onboarding, the spec, and `releases/` (template, tracker, release notes) | No |
| `reports/` | Report files the tools write (daily, per run, per FRAC, per review) | No |

## 2. Where it starts

`npm run dev:ai` (or `npm start` on a server) runs **`src/server.ts`**. In order:

| # | What happens | Where |
| --- | --- | --- |
| 1 | `.env` is loaded, then `config/service.json` is merged into the environment (importing `config/constants.ts` does it) | `src/server.ts:1`, `src/config/settings.ts` |
| 2 | Postgres pool, or the in-memory store when `FRAC_STUDIO_STORE=memory` | `src/server.ts:26-27` |
| 3 | The job runner, which also writes each AI call to `ai_calls` | `src/server.ts:29` |
| 4 | The AI provider: `AI_PROVIDER` names a profile in `config/ai-providers.json` (or `mock`); `dev:ai` refuses the mock | `src/server.ts:33` → `src/providers/registry.ts:65` |
| 5 | The services: `ReviewService` (with Vidya's checklist and its answer store) and `FracService` | `src/server.ts:35-37` |
| 6 | Startup stops if Postgres is unreachable; migrations run when `MIGRATE_ON_START=true` | `src/server.ts:39-41` |
| 7 | The stuck-job watchdog starts | `src/server.ts:45` → `src/services/job-watchdog.service.ts:28` |
| 8 | A `server_runs` row records this run (for `npm run ai:report:run`) | `src/server.ts:48` |
| 9 | The HTTP app (`src/app.ts`) listens on `PORT`; the log prints `"ai":"<provider>"` and the run id | `src/server.ts` (`listen`) |
| 10 | Ctrl+C or SIGTERM: stop taking requests, let running jobs finish, close the run row, exit | `src/server.ts` (`shutdown`) |

## 3. How a request gets in

The portal never calls the service directly: orgportal → uiproxy (`/apis/protected/v8/fracStudio/*`, sets the
signed-in user as `x-aastrika-creator`) → this service at `/v1/*`.

```mermaid
flowchart LR
  P[orgportal] --> X["uiproxy<br/>adds x-aastrika-creator"] --> A["src/app.ts<br/>request id, access log, helmet,<br/>CORS, JSON body limit"]
  A --> O["requireOwner<br/>401 without the header"] --> R["src/routes/<br/>which handler, Zod body check"]
  R --> C["src/controllers/<br/>HTTP only"] --> S["src/services/<br/>the rules"] --> DB["src/repositories/<br/>Postgres or memory"]
  S -. "errors as { error: { code, message } }" .-> E["middleware/errorHandler.ts"]
```

| Layer | Files | Rule |
| --- | --- | --- |
| App and middleware | `src/app.ts:24-44`, `src/middleware/` | Order matters: request context first, error handler last |
| Routes | `src/routes/index.ts:24-28`, `frac.routes.ts:13-22`, `review.routes.ts:14-19` | Wiring and body validation only |
| Controllers | `src/controllers/` | Read params, call one service method, send the response |
| Services | `src/services/frac.service.ts`, `review.service.ts` | Business rules; long work becomes a job |
| Repositories | `src/repositories/` | All SQL; one file per table, each with a memory twin for tests |

## 4. Flow A: a Creator step (research, roles, competencies, ladders)

Example: the user clicks "Write level ladders".

```mermaid
sequenceDiagram
  participant UI as Portal
  participant C as frac.controller
  participant F as FracService
  participant J as JobRunner
  participant S as runLadders
  participant M as askModel
  participant P as Provider (Claude / Gemini / mock)
  UI->>C: POST /v1/fracs/:id/steps/ladders
  C->>F: startStep(owner, id, "ladders", body)
  F->>F: STEPS["ladders"].notReady? → 409 STEP_NOT_READY
  F->>J: start(job) → jobs row "queued"
  J-->>UI: 202 { jobId }
  Note over J: runs in the background
  J->>S: task(progress, recordUsage) inside jobContext
  loop 8 batches of 4 competencies, 6 at once
    S->>M: callModel(prompt, laddersOutput)
    M->>P: complete(task, tier, prompt, schema)
    P-->>M: JSON + tokens + cost
    M->>J: recordUsage → jobs.usage + ai_calls row
    S->>F: save(batch) merged into the latest FRAC
  end
  J->>J: status "done"; version snapshot; log line "Job spend"
  UI->>C: GET /v1/jobs/:id (polls) → done → reload FRAC
```

| Hop | Where |
| --- | --- |
| Route and controller | `src/routes/frac.routes.ts:19` → `src/controllers/frac.controller.ts:45` |
| Step registry and readiness check | `src/services/frac.service.ts:123` (`STEPS`), `:159` (`startStep`) |
| Job created, 202 returned | `src/services/frac.service.ts:165` → `src/services/queue/job-runner.ts:69` |
| Background run, heartbeat, job context | `src/services/queue/job-runner.ts:98`, `:147` |
| The step logic | `src/services/ai/research.step.ts:48`, `roles.step.ts:39`, `competencies.step.ts:43`, `ladders.step.ts:29` |
| Prompts (personas, METHOD, the Reviewer's scope rules) | `src/services/ai/prompts.ts` (`reviewGuard`, `laddersPrompt`, …) |
| One model call: time it, validate, retry once, record | `src/services/ai/step-context.ts:34` → `src/services/ai/ask-model.ts:37` |
| The provider | `src/providers/text/claude.ts:65` (or `gemini.ts`, `src/mocks/`) |
| Spend per call and per job | `src/services/queue/job-runner.ts:140` (`ai_calls`), `jobs.usage` |
| Saving with team edits kept, snapshot | `src/services/frac.service.ts:167-180` |

Which persona each step uses: research, roles, activities and competencies are Kaushal; ladders are Kaushal
and Vidya in the same call (see the "agents" table in [FRAC_STUDIO_GUIDE.md](FRAC_STUDIO_GUIDE.md)).

## 5. Flow B: the expert check, and Flow C: a Reviewer upload

Both run the same review engine. Only how the FRAC arrives differs.

```mermaid
flowchart TD
  U["Upload .xlsx<br/>POST /v1/frac-reviews"] --> RW["readWorkbook + parseWorkbook<br/>→ ReviewModel"]
  RW --> FP{"Same file and context<br/>reviewed before?"}
  FP -- yes --> SAVED["Return the stored review<br/>200, jobId null"]
  FP -- no --> JOB
  EC["Expert check<br/>POST /v1/fracs/:id/steps/check"] --> TM["fracToModel(FRAC)<br/>→ ReviewModel"] --> JOB["JobRunner job"]
  JOB --> RS["ReviewService.review"]
  RS --> RULES["computeChecks<br/>rule-based checks, in code"]
  RULES --> VID["ChecklistReviewer.review<br/>Vidya: Q1 scope, Q2 accuracy, Q3 state fit<br/>stored answers reused for unchanged competencies"]
  VID --> QC["Quote check in code<br/>drop flags not in the file or already covered"]
  QC --> REP["buildReport<br/>verdict, triage, summary, strengths"]
  REP --> STORE["reviews row (and the FRAC's review for an expert check)"]
```

| Hop | Where |
| --- | --- |
| Upload route, file limits | `src/routes/review.routes.ts:14` → `src/controllers/review.controller.ts:14` |
| Read and parse the workbook | `src/services/review.service.ts:123-132` → `src/services/excel/workbook-reader.ts`, `src/services/review-engine/parse-workbook.ts` |
| Same file, same review (fingerprint) | `src/services/review.service.ts:135` → `src/services/review-engine/fingerprint.ts` |
| Expert check entry | `src/routes/frac.routes.ts:18` → `src/services/frac.service.ts:213` |
| The review itself | `src/services/review.service.ts:75` (`review`) |
| Rule-based checks | `src/services/review-engine/checks.ts` (`computeChecks`), tables in `config/review-rules.json`, `config/outdated.json` |
| Vidya's checklist, answer reuse | `src/services/ai-review.service.ts:112`, `:131` (stored answers), `:155` (store new ones) |
| Quote check | `src/services/ai-review.service.ts:190-201` (`locateQuote`) |
| Verdict and triage | `src/services/review-engine/report.ts:79` (`computeTriage`), `:139` (`buildReport`) |
| "Run a fresh review" | `src/routes/review.routes.ts:19` → `ReviewService.rerun` (asks everything again) |

## 6. Flow D: the Excel download

`GET /v1/fracs/:id/export.xlsx` → `src/services/frac.service.ts:249` → `buildFracWorkbook`
(`src/services/excel/workbook-writer.ts:113`) with the method paragraph from `config/method.txt`. A review's
download uses `buildReviewWorkbook` (`:212`). No AI call.

## 7. Background safety nets

| What | Where | Why |
| --- | --- | --- |
| Heartbeat | `src/services/queue/job-runner.ts` (`setInterval`) | A long model call keeps its job fresh |
| Watchdog | `src/services/job-watchdog.service.ts:19` | A job left running by a crash is failed as `JOB_INTERRUPTED` |
| Concurrency cap | `src/providers/text/limit.ts` | A profile's `maxConcurrent` (1 on the Gemini free tier) |
| Retries | the SDKs (408/429/5xx); `askModel` retries a wrong-shape answer once | Transient errors and malformed answers |

## 8. The tools: reports and checks (not the running service)

The tools read what the service stored and write files; the service never calls them.

```mermaid
flowchart LR
  CLI["npm run ai:report / ai:report:daily / ai:report:run<br/>tools/reports/run-ai-report.ts"] --> REPOS["src/repositories<br/>ai_calls, jobs, reviews, server_runs, fracs"]
  CLI2["npm run review:report -- id<br/>tools/reports/run-review-report.ts"] --> REPOS
  REPOS --> B1["tools/reports/ai-report.ts<br/>pure Markdown builder"]
  REPOS --> B2["tools/reports/review-report.ts<br/>pure Markdown builder"]
  B1 --> OUT["reports/ (daily/, runs/, fracs/)"]
  B2 --> OUT2["reports/reviews/"]
```

| Command | Entry | Writes |
| --- | --- | --- |
| `npm run ai:report` (`--days`, `--since`, `--from/--to`, `--frac <id>`, `--provider`) | `tools/reports/run-ai-report.ts` | `reports/ai-report-<date>.md`, `reports/fracs/` |
| `npm run ai:report:daily` (`--yesterday`, `--day`) | same, `--daily` | `reports/daily/` |
| `npm run ai:report:run` (`--run <id>`) | same, `--run` | `reports/runs/` |
| `npm run review:report -- <id>` | `tools/reports/run-review-report.ts` | `reports/reviews/` |
| `npm run config:check` (CI) | `tools/ops/check-config.ts` | stdout |
| `npm run ai:check` | `tools/ops/ai-check.ts` | stdout |

The data they read is written by the service: every model call in `src/services/ai/ask-model.ts` →
`job-runner.ts` → `ai_calls`; server starts and stops in `src/server.ts` → `server_runs`; review checklist
counts on each report (`report.aiChecklist`).

## 9. Where to change what

| To change | Edit | Code change? |
| --- | --- | --- |
| Which AI answers, models, prices | `config/ai-providers.json`, `AI_PROVIDER` | No |
| Batch sizes, limits, timeouts, report settings | `config/service.json` | No |
| Rule-based review checks, scope lists, outdated names | `config/review-rules.json`, `config/outdated.json` (also feed the Creator prompts) | No |
| FRAC size targets | `config/frac-sizes.json` | No |
| Prompt wording | `src/services/ai/prompts.ts` | Yes |
| A step's logic | `src/services/ai/<step>.step.ts` | Yes |
| A new AI provider | `src/providers/text/<kind>.ts`, `src/providers/registry.ts`, `src/config/ai-providers.ts`, a profile | Yes |
| A new report section | `tools/reports/ai-report.ts` or `review-report.ts` | Yes (tools only) |
| The database | a new `migrations/00N_name.sql`, never edit an applied one | Yes |
