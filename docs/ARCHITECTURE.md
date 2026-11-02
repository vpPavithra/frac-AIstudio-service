# FRAC Studio: architecture

Source spec: `FRAC_Creator_and_Reviewer_spec.md` v1 (28 Oct 2026, Sarvesh Deshpande).
Behavioural reference: the `frac-studio.html` prototype (line refs `Lnnn` in the spec point into it).

## Where each piece lives

```
orgportal (Angular 20)           sunbird-cb-uiproxy                frac-studio-service (this repo)
app/frac-studio                  /apis/proxies/v8/frac-studio/*    /v1/...
  Creator | Reviewer | My FRACs ──► auth, user id, multipart ──────► engine + agents + jobs + Postgres
                                   pass-through, no logic             │
                                                                      └─(later) publish to entity-v2
                                                                         via /entity/v1/* (FRAC master data)
```

| Layer | Repo | Notes |
|---|---|---|
| UI | `sunbird-cb-orgportal`, `project/ws/app/src/lib/routes/frac-studio/` | NgModule, `*ngIf`, constructor DI, `_ws-design-system-v2` mixins, native `<select>`. Route `app/frac-studio` gated by a lowercase role. |
| Proxy | `sunbird-cb-uiproxy`, `src/proxies_v8/proxies_v8.ts` | `proxiesV8.use('/frac-studio/*', …)` → `CONSTANTS.FRAC_STUDIO_API_BASE`; forwards the user id/token headers, like `proxyCreatorEtlFrac`. |
| Service | this repo | Holds the Anthropic key, runs the long jobs, owns the Postgres tables. |

## Service layout

```
config/outdated.json   OUTDATED list, read at runtime (OUTDATED_CONFIG_PATH overrides)
migrations/            Postgres schema (fracs, frac_versions, reviews, jobs)
src/engine/            deterministic, no I/O: types, refs, parse-workbook, checks, report, convert   ← done
src/io/                workbook-reader (exceljs, values only)                                       ← done
src/io/                workbook-writer (FRAC + review Excel, spec 7)                                ← done
src/agents/            AgentReviewer seam + ComputedOnlyReviewer stand-in                           ← done
                       prompts.ts (METHOD, SOURCE_LIBRARY, personas; verbatim from the prototype),
                       research / roles / activities / competencies / ladders / review steps
src/llm/               Anthropic client: model tiers, retry with backoff, JSON repair, usage → cost
src/jobs/              in-process job runner + progress (status, msg, done, total), spec 8 messages ← done
                       partial-batch recovery comes with the LLM steps
src/repositories/      fracs, versions, reviews, jobs: pg + in-memory (FRAC_STUDIO_STORE=memory)    ← done
src/services/          review.service (Reviewer + shared engine), frac.service (Creator, My FRACs)  ← done
src/routes/            spec section 8 API under /v1                                                 ← done
```

Until the LLM layer lands, reviews carry the computed findings only (the verdict says so), and
`POST /v1/fracs/:id/steps/{research|roles|competencies|ladders}` answer 501. `steps/check` works.

The engine is the "computed counts" half of the design: everything countable is decided there, and
the agents get its findings as "already computed, do not recount".

## API (spec 8, mounted under /v1, reached via /apis/proxies/v8/frac-studio/v1/...)

```
POST   /v1/fracs                          GET /v1/fracs           GET|PATCH /v1/fracs/:id
POST   /v1/fracs/:id/steps/{research|roles|competencies|ladders|check}   → {jobId}
GET    /v1/fracs/:id/export.xlsx          GET /v1/fracs/:id/versions  POST /v1/fracs/:id/versions/:v/restore
POST   /v1/frac-reviews (multipart)       GET /v1/frac-reviews    GET /v1/frac-reviews/:id
GET    /v1/frac-reviews/:id/export.xlsx   POST /v1/frac-reviews/:id/open-in-creator
GET    /v1/jobs/:id
```

Owner comes from the proxy-forwarded user id header, never from a query param (`?owner=me` in the spec).
The service trusts `x-authenticated-userid`, so it must be reachable only through the proxy. On the
proxy side, set that header from `req.session.userId`: uiproxy's `extractUserIdFromRequest` prefers a
client-sent `wid` header, which would let a browser act as another user.

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
