# FRAC Studio: architecture

Source spec: `FRAC_Creator_and_Reviewer_spec.md` v1 (28 Oct 2026, Sarvesh Deshpande).
Behavioural reference: the `frac-studio.html` prototype (line refs `Lnnn` in the spec point into it).

## Where each piece lives

```
orgportal (Angular 20)           sunbird-cb-uiproxy                frac-studio-service (this repo)
app/frac-studio                  /protected/v8/fracStudio/*        /v1/...
  Creator | Reviewer | My FRACs ──► auth, user id, multipart ──────► engine + agents + jobs + Postgres
                                   pass-through, no logic             │
                                                                      └─(later) publish to entity-v2
                                                                         via /entity/v1/* (FRAC master data)
```

| Layer | Repo | Notes |
|---|---|---|
| UI | `sunbird-cb-orgportal`, `project/ws/app/src/lib/routes/frac-studio/` | NgModule, `*ngIf`, constructor DI, `_ws-design-system-v2` mixins, native `<select>`. Route `app/frac-studio` gated by a lowercase role. |
| Proxy | `sunbird-cb-uiproxy`, `src/protectedApi_v8/fracStudio/fracStudio.ts` | `protectedApiV8.use('/fracStudio', …)` → `CONSTANTS.FRAC_STUDIO_API_BASE` (default `${KONG_API_BASE}/frac-studio`) + `/v1`. Built on the AI Studio helpers (`forwardAny`): owner as `x-aastrika-creator` from the session, multipart rebuilt, downloads streamed, upstream errors relayed. |
| Service | this repo | Holds the AI provider key (Gemini or Claude), runs the long jobs, owns the Postgres tables. |

## Service layout

Layered like [aastrika-ai-service](https://github.com/Sphere/aastrika-ai-service): routes wire, controllers
handle HTTP, services hold the rules, repositories own the queries, validations own the shapes.

```
config/service.json    every non-secret setting (AI_PROVIDER, limits, timeouts, batching, CORS)    ← done
config/ai-providers.json  one profile per AI provider: models, thinking, prices, key name, search   ← done
config/frac-sizes.json roles / activities / competencies per brief size                           ← done
config/outdated.json   OUTDATED list, read per review (OUTDATED_CONFIG_PATH overrides)             ← done
config/review-rules.json  r3 rule tables: scope per cadre, ladder rules, job areas (REVIEW_RULES_CONFIG_PATH) ← done
docs/spec/             the spec, the r3 review rules, and R3_GAP_ANALYSIS.md (what is built against them)
migrations/            numbered SQL: 001 schema, 002 jobs.error_code, 003 reviews.fingerprint,      ← done
                       004 ai_calls (per-call AI log)
src/config/            settings.ts (service.json → env, refuses secrets), constants.ts, db.ts,       ← done
                       ai-providers.ts, frac-sizes.ts
src/routes/            URL → middleware → controller wiring, under /v1                              ← done
src/controllers/       HTTP only: frac, review, job                                                  ← done
src/validations/       Zod request schemas (frac, review)                                            ← done
src/middleware/        auth (x-aastrika-creator), validate, errorHandler, requestContext, requestLogger, upload ← done
src/models/            frac, review, report, job types (spec 4)                                      ← done
src/services/          frac.service (Creator, My FRACs), review.service (Reviewer + shared engine),  ← done
                       job-watchdog.service, ai-review.service (r3 checklist: Vidya Q1/Q2/Q3 + quote check)
src/services/review-engine/  deterministic, no I/O: rules, refs, parse-workbook, checks, report,      ← done
                       convert, fingerprint (engine r3)
src/services/excel/    workbook-reader / workbook-writer (exceljs, spec 7)                           ← done
src/services/queue/    job runner, spec 8 job messages                                               ← done
src/repositories/      frac / review / job .repository.ts: Postgres + in-memory per entity           ← done
src/utils/             response (ApiError, one error shape), logger, context (request id)            ← done
src/services/ai/       prompt builders, step logic, output schemas, batching                         ← done
src/providers/         TextProvider seam: AI_PROVIDER picks a profile (gemini.ts, claude.ts) or mock ← done
src/mocks/             sample-data provider for `npm run dev:mock`; deletable                      ← done
tools/                 not the running service: reports/ (ai:report, review:report), ops/ (config:check, ai:check), fixtures/ ← done
```

## Review engine r3 (docs/spec/FRAC_Reviewer_rules_r3.md)

Anything a list or a pattern can decide is decided in code (`review-engine/checks.ts`), so rule-based
findings are identical on every run. The AI answers only a fixed checklist (`ai-review.service.ts`):
Vidya's Q1 scope and Q2 accuracy per laddered competency (6 per call, 3 in parallel) and Q3 state fit
(once, only for a named state). Every AI flag must quote the competency; code keeps a flag only if the
quote is in that competency's text and no rule already covers it, then merges the rest into at most
three fixed-title findings. Verdict, triage, summary and strengths are computed (`report.ts`).

Same file, same review: an upload's fingerprint (engine version + rule tables + parsed model + context)
is stored with the review; the same upload returns the stored review (`fromCache`, HTTP 200, no job)
until `POST /v1/frac-reviews/:id/rerun` or an upload with `fresh=true` asks again. Neither Claude
Sonnet 5.5 nor the profiles' Gemini models are given a temperature, so the stored review is what makes
results repeatable (the spec's temperature 0 is moot).

## API (spec 8, mounted under /v1, reached from the portal as /apis/protected/v8/fracStudio/...)

```
POST   /v1/fracs                          GET /v1/fracs           GET|PATCH /v1/fracs/:id
POST   /v1/fracs/:id/steps/{research|roles|competencies|ladders|check}   → {jobId}
GET    /v1/fracs/:id/export.xlsx          GET /v1/fracs/:id/versions  POST /v1/fracs/:id/versions/:v/restore
POST   /v1/frac-reviews (multipart)       GET /v1/frac-reviews    GET /v1/frac-reviews/:id
GET    /v1/frac-reviews/:id/export.xlsx   POST /v1/frac-reviews/:id/open-in-creator
POST   /v1/frac-reviews/:id/rerun         (r3 "Run a fresh review")
GET    /v1/jobs/:id
```

Owner comes from the proxy-forwarded user id header, never from a query param (`?owner=me` in the spec).
The service trusts `x-aastrika-creator`, so it must be reachable only through the proxy. The proxy
fills it with `resolveCreatorId` (session user id, else the token subject) and overwrites anything the
browser sent. It deliberately avoids `extractUserIdFromRequest`, which prefers a client-sent `wid`
header and would let a browser act as another user.

## Prototype gaps (spec 10) and where they are handled

| # | Gap | Handling |
|---|---|---|
| 1 | No retries / JSON repair | Each provider's SDK retries 408/429/5xx (`LLM_RETRIES`); a bad answer fails the job with `AI_OUTPUT_INVALID` and its spend is kept; ladder batches are saved as they finish. No JSON repair yet. |
| 2 | Revising roles wipes competencies | roles step keeps competencies, re-runs mapping only; UI confirms before discarding |
| 3 | Fix clears the review | finding gets `fixed: true`; `summariseChecks` ignores fixed findings; "Re-run check" |
| 4 | Fix only rewrites ladders | non-ladder findings route to step 3/4 with pre-filled feedback |
| 5 | Multi-ref mapping cells | `parseRefs` returns every ref; `fracToModel` uses it (done) |
| 6 | Past reviews can't reopen | `reviews.source_model` column + `modelToFrac` (done) |
| 7 | No add/delete/reorder for roles & competencies | UI + PATCH |
| 8 | Description regex grabs level column | excluded in `parse-workbook` (done, tested) |
| 9 | Orphaned storage parts | gone with Postgres |
| 10 | Expert check not saved as a review | saved with `reviews.kind = 'expert-check'`; My FRACs can filter it out |

## Open items

- Fixture workbooks (GNM, ANM, Staff Nurse) → `test/fixtures/` to enable `test/acceptance.test.ts`.
- `frac-studio.html` for the verbatim METHOD / SOURCE_LIBRARY / method-paragraph text.
- Mount the workbook writer from the export API routes once route/repository wiring is implemented.
- Product questions in spec 11 (assessment type per level, authorisation source, Hindi sheet, multi-reviewer).
- Web search domains for the research step need confirming before production. Gemini cannot enforce them (asked for in the instructions); the Gemini free tier has no search.
- First real runs (Gemini free tier, then Claude): cost per FRAC, repeatability, answer quality per provider.

Running, providers, pricing and configuration: [FRAC_STUDIO_GUIDE.md](FRAC_STUDIO_GUIDE.md).
