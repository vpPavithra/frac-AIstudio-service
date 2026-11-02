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
| `src/services/` | The rules: Creator (`frac.service.ts`), Reviewer (`review.service.ts`). |
| `src/engine/` | Deterministic review: workbook parser, mapping-cell parser, computed checks, report. |
| `src/io/` | Excel read and write (exceljs). |
| `src/repositories/` | Postgres and in-memory stores behind one interface. |
| `src/jobs/` | In-process job runner, progress messages, stuck-job watchdog. |
| `src/agents/` | The AI review seam (`ComputedOnlyReviewer` until the LLM layer lands). |
| `src/config/` | `settings.ts` loads `config/service.json`; `constants.ts` exposes every setting. |
| `config/` | `service.json` (settings), `outdated.json` (outdated law and programme names). |
| `migrations/` | Numbered SQL, applied by `npm run migrate`. |
| `test/` | API, Postgres-path (pg-mem), sample and acceptance tests. |

## Run and test

```bash
npm install
FRAC_STUDIO_STORE=memory npm run dev     # no Postgres needed; http://localhost:3005/health
npm run check                            # typecheck, lint, config check, tests
npm run migrate                          # against a real Postgres (POSTGRES_* in .env)
```

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
| `STEP_NOT_AVAILABLE` | 501 | An AI step that is not built yet |
| `INTERNAL_ERROR` | 500 | Unexpected; logged with the request id |

Failed jobs carry `errorCode` too: `JOB_INTERRUPTED` (watchdog), `JOB_FAILED`, or the `ApiError` code.

## The rules in one breath

Layered (routes → controllers → services → repositories), Zod at the boundary, `ApiError` with codes,
settings in `config/service.json` and secrets only in the environment, owner header required, numbered
migrations, no `console.*`, no Claude trailer, no commit unless asked, deploy once after full testing.
See `CLAUDE.md` and `docs/ARCHITECTURE.md`.
