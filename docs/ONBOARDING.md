# Onboarding

## What this is

The backend for **FRAC Studio** in the Aastrika org portal: review an existing FRAC competency dictionary
(.xlsx) and get a graded report, or build a FRAC step by step (brief → research → roles & activities →
competencies → level ladders → expert check → Excel). Spec: `FRAC_Creator_and_Reviewer_spec.md` v1.

```
orgportal /app/home/frac-studio  →  uiproxy /protected/v8/fracStudio/*  →  this service /v1/*  →  Postgres
```

## Repo map

| Path | What lives there |
|---|---|
| `src/routes/` | Which middleware and handler each URL gets. Wiring only. |
| `src/controllers/` | HTTP: read params, call a service, send the response. |
| `src/validations/` | Zod schemas for every request body. |
| `src/services/` | The rules: Creator (`frac.service.ts`), Reviewer (`review.service.ts`), stuck-job watchdog (`job-watchdog.service.ts`), Vidya's review checklist (`ai-review.service.ts`). |
| `src/services/ai/` | Creator steps 2 to 5: prompts, step logic, output schemas, batching. |
| `src/providers/` | The AI seam: `registry.ts` builds the provider `AI_PROVIDER` names (`gemini.ts`, `claude.ts`), plus pricing and the concurrency cap. |
| `src/mocks/` | Sample-data provider for `npm run dev:mock`. |
| `src/services/review-engine/` | Deterministic review: workbook parser, mapping-cell parser, computed checks, report. |
| `src/services/excel/` | Excel read and write (exceljs). |
| `src/services/queue/` | In-process job runner and the progress messages. |
| `src/models/` | Domain types: FRAC, review, report, job. |
| `src/repositories/` | One file per entity (frac, review, job), each with its Postgres and in-memory store. |
| `src/middleware/` | `auth` (owner header), `validate`, `errorHandler`, `requestContext`, `requestLogger`, `upload`. |
| `src/utils/` | `response` (`ApiError`), `logger`, `context` (request id). |
| `src/config/` | `settings.ts` loads `config/service.json`; `constants.ts` exposes every setting; `ai-providers.ts` and `frac-sizes.ts` load their JSON files. |
| `config/` | `service.json` (settings), `ai-providers.json` (provider profiles), `frac-sizes.json`, `review-rules.json` and `outdated.json` (review rule tables), `method.txt`. |
| `migrations/` | Numbered SQL, applied by `npm run migrate`. |
| `test/` | API, Postgres-path (pg-mem), sample and acceptance tests. |

## Run and test

```bash
npm install
cp .env.example .env                     # then fill in POSTGRES_* and, for a real model, GEMINI_API_KEY
FRAC_STUDIO_STORE=memory npm run dev:mock  # sample-data AI, no Postgres; http://localhost:3005/health
npm run dev:mock:seed                    # the same, with a finished FRAC and review preloaded
npm run ai:check                         # one tiny real call to the AI_PROVIDER profile (default gemini-free)
npm run dev:ai                           # the real provider; stops if its key is missing
npm run check                            # typecheck, lint, config check, tests
npm run migrate                          # against a real Postgres (POSTGRES_* in .env)
```

Which AI answers, how to switch, and what each costs: [docs/FRAC_STUDIO_GUIDE.md](docs/FRAC_STUDIO_GUIDE.md).

Every `/v1` call needs the header `x-aastrika-creator: <user id>` (the uiproxy sets it in real use).

## Errors

Every failure is `{ "error": { "code": "...", "message": "..." } }`. Codes the portal can branch on:

| Code | Status | Meaning |
|---|---|---|
| `VALIDATION_FAILED` | 400 | A request field is missing or wrong; `details` lists each problem |
| `NOT_SIGNED_IN` | 401 | No `x-aastrika-creator` header |
| `NOT_FOUND` | 404 | No such FRAC, review, job, version or step for this owner |
| `BRIEF_LOCKED` | 409 | The brief cannot change once research exists |
| `REVIEW_NOT_READY` | 409 | The review job has not finished |
| `NO_COMPETENCIES` | 400 | Expert check needs competencies |
| `FILE_REQUIRED` / `FILE_TYPE_NOT_ALLOWED` / `FILE_UNREADABLE` | 400 | Upload problems |
| `NO_COMPETENCY_SHEET` | 400 | The workbook has no competency sheet |
| `PAYLOAD_TOO_LARGE` | 413 | Over `MAX_UPLOAD_MB` / `MAX_JSON_MB` |
| `STEP_NOT_READY` | 409 | A step was asked for before the step it needs (e.g. roles before research) |
| `INTERNAL_ERROR` | 500 | Unexpected; logged with the request id |

Failed jobs carry `errorCode` too: `JOB_INTERRUPTED` (watchdog), `JOB_FAILED`, or the `ApiError` code.
From the AI provider: `AI_OUTPUT_INVALID` (answer in the wrong shape), `AI_AUTH` (key rejected), `AI_BUSY`
(quota or rate limit), `AI_REFUSED`, `AI_OUTPUT_TRUNCATED`, `AI_REQUEST_REJECTED`, `AI_UNAVAILABLE`.

## The rules in one breath

Layered (routes → controllers → services → repositories), Zod at the boundary, `ApiError` with codes,
settings in `config/service.json` and `config/ai-providers.json`, secrets only in the environment, owner header required, numbered
migrations, no `console.*`, no Claude trailer, no commit unless asked, deploy once after full testing.
See `CLAUDE.md`, `docs/ARCHITECTURE.md` and `docs/CODEBASE_GUIDE.md`.
