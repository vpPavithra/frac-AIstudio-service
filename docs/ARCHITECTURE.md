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
| Service | this repo | Holds the Anthropic key, runs the long jobs, owns the Postgres tables. |

## Service layout

Layered like [aastrika-ai-service](https://github.com/Sphere/aastrika-ai-service): routes wire, controllers
handle HTTP, services hold the rules, repositories own the queries, validations own the shapes.

```
config/service.json    every non-secret setting (models, rates, limits, timeouts, CORS)            ← done
config/outdated.json   OUTDATED list, read per review (OUTDATED_CONFIG_PATH overrides)             ← done
migrations/            numbered SQL: 001 schema, 002 jobs.error_code                                 ← done
src/config/            settings.ts (service.json → env, refuses secrets), constants.ts, db.ts        ← done
src/routes/            URL → middleware → controller wiring, under /v1                              ← done
src/controllers/       HTTP only: frac, review, job                                                  ← done
src/validations/       Zod request schemas (frac, review)                                            ← done
src/middleware/        owner (x-aastrika-creator), validate, errors, request-context, request-logger ← done
src/services/          review.service (Reviewer + shared engine), frac.service (Creator, My FRACs)  ← done
src/engine/            deterministic, no I/O: types, refs, parse-workbook, checks, report, convert   ← done
src/io/                workbook-reader / workbook-writer (exceljs, spec 7)                           ← done
src/repositories/      fracs, versions, reviews, jobs: pg + in-memory (FRAC_STUDIO_STORE=memory)    ← done
src/jobs/              job runner, spec 8 messages, stuck-job watchdog                               ← done
src/utils/             api-error (one error shape), logger, request-context                          ← done
src/agents/            AgentReviewer seam + ComputedOnlyReviewer stand-in                           ← done
src/prompts/           pure *.prompts.ts builders, verbatim from the prototype, golden snapshots    (with LLM)
src/providers/         LlmProvider + ClaudeProvider (tiers from config), retry, fixtures replay      (with LLM)
```

Until the LLM layer lands, reviews carry the computed findings only (the verdict says so), and
`POST /v1/fracs/:id/steps/{research|roles|competencies|ladders}` answer 501. `steps/check` works.

The engine is the "computed counts" half of the design: everything countable is decided there, and
the agents get its findings as "already computed, do not recount".

## API (spec 8, mounted under /v1, reached from the portal as /apis/protected/v8/fracStudio/...)

```
POST   /v1/fracs                          GET /v1/fracs           GET|PATCH /v1/fracs/:id
POST   /v1/fracs/:id/steps/{research|roles|competencies|ladders|check}   → {jobId}
GET    /v1/fracs/:id/export.xlsx          GET /v1/fracs/:id/versions  POST /v1/fracs/:id/versions/:v/restore
POST   /v1/frac-reviews (multipart)       GET /v1/frac-reviews    GET /v1/frac-reviews/:id
GET    /v1/frac-reviews/:id/export.xlsx   POST /v1/frac-reviews/:id/open-in-creator
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
| 1 | No retries / JSON repair | `src/llm` retry + repair; jobs keep finished batches and retry only failed ones |
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
- Web search domains for the research step need confirming before production.
