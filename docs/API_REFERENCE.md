# FRAC Studio API and AI call reference

Every HTTP endpoint the service exposes and every AI call it makes: the payload, when the portal calls it, why, and
what happens inside. The last section lists what to improve. Checked against the code on 9 Nov 2026
(`src/routes/`, `src/validations/`, `src/controllers/`, `src/services/ai/`, `src/services/ai-review.service.ts`).

For the path a request takes through the code, with file and line, see [CODE_FLOW.md](CODE_FLOW.md).

---

## 1. How a call reaches the service

```
orgportal (browser)                         sunbird-cb-uiproxy                     frac-studio-service
FracStudioApiService                        protectedApi_v8/fracStudio             Express, port 3005 (3010 locally)
/apis/protected/v8/fracStudio/<path>   →    checks the session, sets          →    /v1/<path>
                                            x-aastrika-creator = user id
```

- **Identity.** Every `/v1` route needs the `x-aastrika-creator` header. The uiproxy sets it from the signed-in
  session and overwrites anything the browser sent. Missing header: `401 NOT_SIGNED_IN`. Every record is scoped to
  that user; another user's FRAC, review or job answers `404`, so ids cannot be probed.
- **Bodies.** JSON, up to `MAX_JSON_MB` (5 MB). Each body is checked with Zod before the controller runs; unknown
  fields are dropped. A bad body answers `400` with the field at fault.
- **Long work runs as a job.** AI steps, the expert check and reviews answer `202 { jobId }` at once. The portal
  then polls `GET /v1/jobs/:id` every 2 seconds (`FRAC_STUDIO_POLL_MS`) until the job is `done` or `error`. The work
  carries on if the page is closed.
- **Errors** all have one shape: `{ "error": { "code": "BRIEF_LOCKED", "message": "…" } }`.

Portal client: `project/ws/app/src/lib/routes/frac-studio/services/frac-studio-api.service.ts` (orgportal).

---

## 2. Endpoint list

| # | Method and path | Portal method | Answer | AI calls |
| --- | --- | --- | --- | --- |
| 1 | `GET /health` | (probes only) | 200 | none |
| 2 | `GET /v1/info` | (startup log, checks) | 200 | none |
| 3 | `POST /v1/fracs` | `createFrac` | 201 | none |
| 4 | `GET /v1/fracs` | `listFracs` | 200 | none |
| 5 | `GET /v1/fracs/:id` | `getFrac` | 200 | none |
| 6 | `PATCH /v1/fracs/:id` | `patchFrac` | 200 | none |
| 7 | `POST /v1/fracs/:id/steps/research` | `runStep(id, 'research')` | 202 job | 1 |
| 8 | `POST /v1/fracs/:id/steps/roles` | `runStep(id, 'roles')` | 202 job | 1 + one per 4 roles |
| 9 | `POST /v1/fracs/:id/steps/competencies` | `runStep(id, 'competencies')` | 202 job | 1 |
| 10 | `POST /v1/fracs/:id/steps/ladders` | `runStep(id, 'ladders', { codes? })` | 202 job | one per 4 competencies |
| 11 | `POST /v1/fracs/:id/steps/check` | `startCheck` | 202 job | one per 6 competencies, + 1 for a state |
| 12 | `GET /v1/fracs/:id/export.xlsx` | `exportFrac` | 200 file | none |
| 13 | `GET /v1/fracs/:id/versions` | `listVersions` | 200 | none |
| 14 | `POST /v1/fracs/:id/versions/:versionId/restore` | `restoreVersion` | 200 | none |
| 15 | `POST /v1/frac-reviews` | `startReview` | 202 job, or 200 stored review | one per 6 competencies, + 1 for a state |
| 16 | `GET /v1/frac-reviews` | `listReviews` | 200 | none |
| 17 | `GET /v1/frac-reviews/:id` | `getReview` | 200 | none |
| 18 | `GET /v1/frac-reviews/:id/export.xlsx` | `exportReview` | 200 file | none |
| 19 | `POST /v1/frac-reviews/:id/open-in-creator` | `openInCreator` | 200 | none |
| 20 | `POST /v1/frac-reviews/:id/rerun` | `rerunReview` | 202 job | as #15 |
| 21 | `GET /v1/jobs/:id` | `getJob` / `pollJob` | 200 | none |

---

## 3. Endpoints in detail

### 1. `GET /health`

- **When:** Docker `HEALTHCHECK` and Kubernetes probes. Not behind the identity check.
- **Why:** says the process is up. It does not touch Postgres.
- **Answer:** `{ "status": "ok", "service": "frac-studio-service" }`. Not written to the access log.

### 2. `GET /v1/info`

- **When:** to confirm which AI is answering (mock, Gemini or Claude) before a test run.
- **Answer:** `{ "aiProvider": "claude-mixed" }`, the `AI_PROVIDER` profile name, or `"mock"`.

### 3. `POST /v1/fracs` — create a FRAC (Step 1, Brief)

- **When:** the user fills in the brief on the Creator tab and presses the first button.
- **Why:** stores the brief that every later step is written for. No AI runs.
- **Body:**

| Field | Type | Rule |
| --- | --- | --- |
| `cadre` | string | Required, 1–200 characters (e.g. `"ANM"`) |
| `state` | string | Optional; blank becomes `"India (national baseline)"` |
| `size` | `"compact"` \| `"standard"` \| `"full"` | Default `"standard"`; sets the role, activity and competency targets (`config/frac-sizes.json`) |
| `prompt` | string | Optional scope note, up to 20,000 characters; passed into every later prompt |

```json
{ "cadre": "ANM", "state": "Bihar", "size": "standard", "prompt": "Sub-centre posting; include HBNC." }
```

- **Answer `201`:** `{ "id": "<uuid>", "frac": { …the whole FRAC… } }`.
- **Stored:** a row in `fracs` (the document in `doc`).

### 4. `GET /v1/fracs` — My FRACs

- **When:** the My FRACs list opens.
- **Answer:** `{ "fracs": [ …summaries, newest first… ] }`, only the caller's own.

### 5. `GET /v1/fracs/:id` — open a FRAC

- **When:** a FRAC is opened from My FRACs, and after each job finishes, to reload the result.
- **Answer:** `{ "frac": { … }, "activeJobId": "<uuid>" | null }`. `activeJobId` is the step or check still
  running on it, so a reloaded page (or a second tab) follows that job instead of offering the buttons again. The document has `cadre`, `state`, `size`, `prompt`, `cadreFull`, `codePrefix`,
  `postings`, `research`, `roles[].activities[]`, `competencies[].levels`, `review`, `reviewStale`, `rolesDirty`, `log`, `step`.
  `reviewStale` is `true` when the content changed after the expert check (a fix, a revise or a hand edit); the
  portal then shows the old findings as out of date, offers "Re-run expert check" and holds the download until it runs.
- **Errors:** `404 NOT_FOUND` if it doesn't exist or belongs to someone else.

### 6. `PATCH /v1/fracs/:id` — save hand edits (autosave)

- **When:** 1.4 seconds after the user stops typing in any editor (brief, Research tab, roles, competencies,
  ladders), and when the user ticks "Mapping checked".
- **Why:** keeps the team's edits. Steps read the saved FRAC, so the next-step button waits for this save.
- **Body:** any subset of these fields; only what is sent changes.

| Field | Notes |
| --- | --- |
| `cadre`, `state`, `size`, `prompt` | The brief. Refused with `409 BRIEF_LOCKED` once research exists |
| `cadreFull`, `codePrefix` (≤20) | From research; editable |
| `postings` | At most 3: `[{ "key": "P1", "label": "Sub-centre" }]` |
| `research` | `{ summary, sourceNotes, sources[], authorised, notAuthorised, stateContext, assumptions }`, or `null` |
| `roles` | `[{ code, title, source, activities: [{ code, text, postings, source, tier, comp }] }]`, ≤200 roles, ≤200 activities each |
| `competencies` | `[{ code (required), label, description, type, area, kcm, levels: [{label, desc}] ×≤5 \| null }]`, ≤500 |
| `rolesDirty` | Only `false` is accepted: the team confirms the mapping after a roles change |

```json
{ "competencies": [ { "code": "ANM7", "label": "Conduct normal delivery", "levels": [ { "label": "Assists…", "desc": "…" } ] } ] }
```

- **Answer:** `{ "frac": { …the saved FRAC… } }`. A change to `research`, `postings`, `roles` or `competencies` after an
  expert check sets `reviewStale`; re-sending unchanged content does not.

### 7–10. `POST /v1/fracs/:id/steps/:step` — run an AI step (Steps 2–5)

- **When:** the sidebar's next-step button ("Research the job", "Build roles & activities", "Derive competencies",
  "Write level ladders"), or "Revise" with feedback on a finished step.
- **Why:** Kaushal (and Vidya, for ladders) writes that part of the FRAC. See section 5 for each AI call.
- **Body (all optional):**

| Field | Type | Used by |
| --- | --- | --- |
| `feedback` | string, ≤5,000 characters | Any step: turns the run into a revise ("make activities shorter") |
| `codes` | string[] of competency codes | Ladders only: rewrite just these ("Revise ANM7", "Fix these competencies") |

```json
{ "feedback": "Add HBNC home visits under the community role." }
{ "codes": ["ANM7", "ANM12"], "feedback": "MgSO4 is given by the MO, not the ANM." }
```

- **Answer `202`:** `{ "jobId": "<uuid>" }`, then poll #21.
- **Before the job starts** (answers at once):
  - `409 STEP_NOT_READY` when an earlier step is missing: roles need research (or an imported FRAC),
    competencies need a role with activities, ladders need a competency.
  - `404 NOT_FOUND` for an unknown step name.
  - `409 JOB_RUNNING` when a step or check is already running on this FRAC; `error.details` has its `jobId` and
    `kind`, and the portal follows that job. A job silent for two heartbeats (2 minutes) is taken as dead, marked
    `JOB_INTERRUPTED`, and the new one starts. Migration 009 enforces one active job per FRAC or review.
- **What the job does:** reads the FRAC, calls the AI, then merges the result into the latest saved FRAC (edits made
  meanwhile are kept), appends to `frac.log`, saves a version (e.g. "Level ladders (revised)"), and records the
  tokens and cost. Running research locks the brief.
- **Stored:** `fracs.doc` updated, a `frac_versions` row, a `jobs` row, one `ai_calls` row per AI call.

| Step | What changes in the FRAC |
| --- | --- |
| research | `cadreFull`, `codePrefix` (≤4 capital letters, fallback `C`), `postings` (≤3, renamed P1–P3), `research` (lists one item per line; "verify" items added to assumptions as `VERIFY: …`) |
| roles | `roles` renumbered R1…Rn, activities A1…An across all roles. Team-added activities kept. Every mapping cleared, the expert check result cleared. Competencies kept, and `rolesDirty` set |
| competencies | `competencies`, and each activity's `comp` set to `CODE@Ln`. A competency keeps its ladder only if its code and label are unchanged. On a revise, new codes start after the highest existing one |
| ladders | `levels` for the competencies asked for (without `codes`: only those with no ladder). Saved after every batch. Marks an earlier expert check out of date (`reviewStale`) |

### 11. `POST /v1/fracs/:id/steps/check` — expert check (Step 6)

- **When:** "Run expert check" in the Creator.
- **Why:** grades the FRAC being built exactly as an uploaded one would be graded (rule-based checks, then Vidya's
  checklist, then the computed verdict), with the note "Generated in FRAC Studio. Be strict."
- **Body:** none (`{}`).
- **Answer `202`:** `{ "jobId": "<uuid>" }`. `400 NO_COMPETENCIES` when there is none.
- **Stored:** the report on `fracs.doc.review` (and `reviewStale` cleared, unless the FRAC was edited while the check ran), a `reviews` row (`kind = 'expert-check'`, also shown in My FRACs),
  a version named "Expert check", the job and its AI calls.

### 12. `GET /v1/fracs/:id/export.xlsx` — download the FRAC

- **When:** "Download Excel".
- **Answer:** the workbook (`Content-Disposition` with the file name). Sheets: FRAC, Competencies, Method & Sources,
  and Expert check (when one has run). The method paragraph comes from `config/method.txt`, re-read on every export.

### 13. `GET /v1/fracs/:id/versions` — history

- **When:** the History panel opens.
- **Answer:** `{ "versions": [ { "id": 42, "fracId": "…", "step": 5, "reason": "Level ladders (revised)", "createdAt": "…" }, … ] }`,
  newest first.

### 14. `POST /v1/fracs/:id/versions/:versionId/restore` — restore a version

- **When:** "Restore" on a history entry.
- **Why:** undoes a bad revise. The current state is first saved as "Before restore", so a restore can be undone too.
- **Body:** none. `versionId` must be a positive whole number (`400` otherwise).
- **Answer:** `{ "frac": { …restored FRAC… } }`.

### 15. `POST /v1/frac-reviews` — upload a workbook for review (Reviewer)

- **When:** the Reviewer tab's upload.
- **Why:** grades an existing FRAC workbook from outside the studio.
- **Body:** `multipart/form-data`.

| Field | Rule |
| --- | --- |
| `file` | Required, one `.xlsx`, up to `MAX_UPLOAD_MB` (15 MB). Held in memory only, never written to disk |
| `cadre`, `state` | Optional, ≤200 characters. Without a cadre the parser looks for a "Position:" cell |
| `notes` | Optional, ≤5,000 characters, passed to the checklist prompt |
| `fresh` | `"true"` ignores a stored review of the same file and context |

- **Answers:**
  - `202 { reviewId, jobId, warnings, fromCache: false }`: a new review is running; poll the job.
  - `200 { reviewId, jobId: null, warnings, fromCache: true, reviewedAt }`: the same file with the same context was
    reviewed before (matched by fingerprint), so the stored review is returned at once and no AI runs.
  - `400 FILE_REQUIRED`, `400 FILE_TYPE_NOT_ALLOWED`, `413 PAYLOAD_TOO_LARGE`.
- **Stored:** a `reviews` row (`kind = 'upload'`) with `ctx`, the parsed `source_model`, the `report` and the
  `fingerprint`.

### 16–18. Review list, detail and download

- `GET /v1/frac-reviews` → `{ "reviews": [ … ] }` for the My FRACs list.
- `GET /v1/frac-reviews/:id` → `{ report, ctx, sourceModel, kind }` when a review opens. `report` holds the
  findings, verdict, triage, summary and strengths.
- `GET /v1/frac-reviews/:id/export.xlsx` → the review as a workbook ("Download review").

### 19. `POST /v1/frac-reviews/:id/open-in-creator`

- **When:** "Open in Creator" on a review.
- **Why:** turns an uploaded workbook into an editable FRAC, so the team can fix the findings with the Creator.
- **Answer:** `{ "fracId": "<uuid>" }`; the portal then opens that FRAC.

### 20. `POST /v1/frac-reviews/:id/rerun`

- **When:** "Run a fresh review" on a stored review.
- **Why:** asks the model again and replaces the stored report. Skips the answer cache.
- **Answer `202`:** `{ reviewId, jobId, warnings: [], fromCache: false }`.

### 21. `GET /v1/jobs/:id` — job progress

- **When:** every 2 seconds while a step, check or review runs.
- **Answer:**

```json
{
  "status": "running", "msg": "Kaushal and Vidya are writing level ladders for 32 competencies…", "done": 8, "total": 32,
  "error": null, "errorCode": null, "kind": "ladders", "targetId": "<frac or review id>",
  "usage": { "calls": 2, "inputTokens": 9300, "outputTokens": 5800, "webSearches": 0, "costUsd": 0.077 }
}
```

`usage.estimated` is `1` when the cost is an estimate (mock or Gemini free tier) and absent otherwise.

- `status` is `queued`, `running`, `done` or `error`. On `error`, `errorCode` says why (section 6).
- A job that stops reporting for `JOB_STALE_AFTER_MS` (15 min) is marked `JOB_INTERRUPTED` by the watchdog.

---

## 4. Which endpoint the portal calls, step by step

| User action | Calls |
| --- | --- |
| Open FRAC Studio | `GET /v1/fracs`, `GET /v1/frac-reviews` |
| Fill the brief, continue | `POST /v1/fracs` |
| Type anywhere | `PATCH /v1/fracs/:id` (autosave) |
| Research the job / Revise | `POST …/steps/research` → poll `GET /v1/jobs/:id` → `GET /v1/fracs/:id` |
| Build roles and activities | `POST …/steps/roles` → poll → reload |
| Derive competencies | `POST …/steps/competencies` → poll → reload |
| Write ladders / Rewrite all / Revise {code} | `POST …/steps/ladders` (with `codes` for one or a few) → poll → reload |
| Run expert check | `POST …/steps/check` → poll → reload |
| Fix these competencies (on a finding) | `POST …/steps/ladders` with the cited `codes` and the finding as `feedback` |
| Download Excel | `GET …/export.xlsx` |
| History / Restore | `GET …/versions`, `POST …/versions/:versionId/restore` |
| Upload a workbook | `POST /v1/frac-reviews` → poll (unless `fromCache`) → `GET /v1/frac-reviews/:id` |
| Run a fresh review | `POST /v1/frac-reviews/:id/rerun` → poll → reload |
| Open in Creator | `POST /v1/frac-reviews/:id/open-in-creator` → `GET /v1/fracs/:id` |

---

## 5. AI calls

### How every AI call works

All of them go through one function, `askModel` (`src/services/ai/ask-model.ts`), to the provider that
`AI_PROVIDER` names (`config/ai-providers.json`):

1. The prompt is built in `src/services/ai/prompts.ts`: the persona (Kaushal, Vidya, or both), the brief, the
   cadre's scope, the Reviewer's rules (`reviewGuard`: scope acts and outdated names), METHOD, the step's input, and
   the team's feedback on a revise.
2. The call goes out with the task's **tier**. The complex tier uses the profile's stronger model and higher thinking;
   the default tier the cheaper one. On `claude-mixed`: complex is Sonnet 5.5 (high effort), default is Haiku 5.5
   (medium).
3. Claude answers in a fixed JSON shape (structured output) for every task except research, which uses web search.
   The answer is checked against the task's schema (`src/services/ai/schemas.ts`). A wrong shape is retried once
   (`LLM_INVALID_RETRIES`); a second failure ends the job with `AI_OUTPUT_INVALID`.
4. Network and rate-limit errors are retried up to 3 times (`LLM_RETRIES`), each call with a 10-minute timeout.
5. Tokens, thinking tokens, web searches, cost and time are recorded per call in `ai_calls` and added to the job's
   `usage`, even when the answer is rejected. No prompt or answer text is stored.
6. Batched tasks run `AI_BATCH_PARALLEL` (6) calls at once (the review checklist: `REVIEW_BATCH_PARALLEL`, 6); `maxConcurrent` in the profile caps calls across all
   jobs (1 on the Gemini free tier).

### The seven AI tasks

| Task | Started by | Persona | Tier | Calls | Input | Answer (schema) |
| --- | --- | --- | --- | --- | --- | --- |
| `research` | #7 | Kaushal | complex | 1 | Brief, scope note; on revise the previous research and feedback | `cadreFull`, `codePrefix`, `postings[]`, `summary`, `sources[]`, `authorised[]`, `notAuthorised[]`, `stateContext[]`, `assumptions[]`, `verify[]` |
| `roles` | #8 | Kaushal | complex | 1 | Brief, research, target role count | `roles: [{ title, source }]` (at least 1) |
| `activities` | #8, after roles | Kaushal | default | one per 4 roles (`AI_BATCH_SIZE`) | Those roles, postings, target activities per role | `roles: [{ code, activities: [{ text, postings, source, tier }] }]` |
| `competencies` | #9 | Kaushal | complex | 1 | Every activity, target competency count, codes already used | `competencies: [{ code, label, description, type, area, kcm }]`, `mapping: [{ a, c, l(1–5) }]` |
| `ladders` | #10, and "Fix these competencies" | Kaushal and Vidya | default | one per 4 competencies | Those competencies, research, feedback | `ladders: [{ code, levels: [{ label, desc }] ×5 }]` |
| `review-competencies` | #11, #15, #20 | Vidya | complex | one per 6 competencies (`REVIEW_BATCH_SIZE`) | Cadre, state, those competencies, the rule-based scope hits ("do NOT repeat") | `items: [{ code, scope: [{ quote, act, basis }], accuracy: [{ quote, issue, correct }] }]` |
| `review-state` | #11, #15, #20 | Vidya | complex | 1, skipped for national, blank or "India" | Cadre, state, the competencies | `items: [{ category, item, refs[] }]`, at most 6 |

### What happens to each answer

- **research:** prefix and postings cleaned (see #7–10). Runs Google/Claude web search limited to `nhm.gov.in`,
  `mohfw.gov.in`, `igotkarmayogi.gov.in`, `cbc.gov.in`, up to `RESEARCH_SEARCH_MAX_USES` (3) searches. No search on the
  Gemini free tier.
- **roles + activities:** progress "x of y roles"; codes renumbered across the whole FRAC.
- **competencies:** a mapping that names a competency not in the answer fails the step (`AI_OUTPUT_INVALID`) and
  nothing is saved.
- **ladders:** each ladder must have exactly 5 levels. Ladders for codes outside the batch are dropped; a code the
  model skipped keeps its old ladder. Progress "x of y competencies"; a failure part-way keeps finished batches.
- **review-competencies:** a flag is dropped when its quote is under 4 words (`REVIEW_MIN_QUOTE_WORDS`), is not found
  in that competency's text, or is already covered by a rule (an outdated name, a ladder rule, or a scope hit at the
  same code and level). What's left becomes at most 3 findings with fixed titles. Identical inputs reuse the stored
  answer (`review_answer_cache`, `REVIEW_REUSE_ANSWERS`); a fresh review skips the cache.
- **review-state:** becomes the "Does not reflect {state}" finding (minor).
- **The verdict and triage are never written by the AI.** Code computes them from the findings
  (`src/services/review-engine/report.ts`).

### Measured cost of one complete FRAC (Claude, 6 Nov 2026)

ANM · Arunachal Pradesh · standard (12 roles, 72 activities, 32 competencies), `claude` profile (Sonnet on both
tiers), from `reports/fracs/frac-e5dd92cd-cost.md`:

| Step | Calls | Tokens in | Tokens out | Cost | Wall time |
| --- | --- | --- | --- | --- | --- |
| Research | 1 | 16,909 | 9,525 | $0.13 | 76 s |
| Roles and activities | 4 | 15,036 | 10,077 | $0.13 | 30 s |
| Competencies | 1 | 6,350 | 10,090 | $0.11 | 63 s |
| Level ladders | 8 | 37,383 | 23,269 | $0.31 | 44 s |
| Expert check | 7 | 48,957 | 6,534 | $0.16 | 24 s |
| **Total** | **21** | **124,635** | **59,495** | **$0.84** | about 4 min |

A Staff Nurse FRAC (`7f33b6e8`) cost $0.86 for 21 calls. `claude-mixed` moves activities and ladders to Haiku, which
cut the ladders step to well under a cent in a test (4 ladders for $0.004). Reports: `npm run ai:report`,
`npm run ai:report:daily`, `npm run review:report -- <id>`.

---

## 6. Error codes

| Code | HTTP / where | Meaning and what to do |
| --- | --- | --- |
| `NOT_SIGNED_IN` | 401 | No `x-aastrika-creator` header: the call didn't come through the uiproxy |
| `NOT_FOUND` | 404 | No such FRAC, review, job or step, or it belongs to another user |
| `BRIEF_LOCKED` | 409 | The brief can't change once research exists; start a new FRAC |
| `STEP_NOT_READY` | 409 | An earlier step is missing |
| `JOB_RUNNING` | 409 | A step, check or review re-run is already running on this target; `details.jobId` names it |
| `NO_COMPETENCIES` | 400 | The expert check needs at least one competency |
| `FILE_REQUIRED`, `FILE_TYPE_NOT_ALLOWED` | 400 | Upload one `.xlsx` as `file` |
| `PAYLOAD_TOO_LARGE` | 413 | File over 15 MB or body over 5 MB |
| `AI_OUTPUT_INVALID` | job | The answer had the wrong shape twice; nothing from that call is saved. Run again |
| `AI_OUTPUT_TRUNCATED` | job | The answer was cut off; use a smaller size or fewer competencies |
| `AI_REFUSED` | job | The model declined; rephrase the brief or feedback |
| `AI_AUTH` | job | Bad or missing API key |
| `AI_BUSY` | job | Rate limit or used-up quota (Gemini free tier: 20 requests a day per model) |
| `AI_UNAVAILABLE` | job | The provider is overloaded (503/504); the message names the model and status |
| `AI_REQUEST_REJECTED` | job | The provider rejected the request (e.g. unknown model) |
| `JOB_INTERRUPTED` | job | The service restarted or the job went silent for 15 minutes; run it again |
| `JOB_FAILED` | job | Any other failure; the server log has the request and job id |

---

## 7. What to improve and update

Ordered by value. Items marked **bug** cause wrong behaviour today; the rest save cost or time, or make the API
easier to use.

### API

| # | Change | Why | Where |
| --- | --- | --- | --- |
| A1 | ✅ Done 9 Nov: refuse a second job on the same FRAC while one runs (`409 JOB_RUNNING`, returning the running `jobId`) | Today nothing stops it: a double click, or "Revise" pressed during a running step, starts two jobs that both write the FRAC and both bill | `FracService.startStep` / `startCheck`, check `jobs` for `queued`/`running` with that `target_id` |
| A2 | Optimistic locking on `PATCH` (send `updatedAt`, answer `409 STALE` if it changed) | Two tabs, or two people with the same login, overwrite each other's edits without warning | `frac.service.patch`, portal `patchFrac` |
| A3 | Paging on `GET /v1/fracs`, `/v1/frac-reviews` and `/versions` (`?limit&cursor`) | Lists return everything; slow once a user has many FRACs or versions | repositories `list*` |
| A4 | Return the job in the `202` answer (`{ jobId, job }`) | Saves the first poll and shows the starting message at once | `JobRunner.start` |
| A5 | Push progress instead of polling (Server-Sent Events on `GET /v1/jobs/:id/events`) | Polling every 2 s makes about 120 requests for a 4-minute FRAC; needs the uiproxy to pass streams through | new route, uiproxy, portal |
| A6 | `DELETE /v1/fracs/:id` and `DELETE /v1/frac-reviews/:id` | No way to remove test or abandoned FRACs from My FRACs | routes, repositories |
| A7 | An OpenAPI file (`docs/openapi.yaml`) generated from the Zod schemas | The portal types and this document are kept in step by hand | `zod-to-openapi` |
| A8 | Put `x-request-id` in error answers | The user can quote it, and support finds the log line at once | `errorHandler` |
| A9 | Mark `GET /v1/info` with the build version and git sha | Confirms which build is deployed during testing | `routes/index.ts` |

### AI calls

| # | Change | Why | Where |
| --- | --- | --- | --- |
| B1 | **Prompt caching** (`cache_control` on the fixed head of each prompt: persona, METHOD, brief, research) | The 8 ladder calls and 6–7 review calls repeat the same long head. Cached reads bill at 10% of input. Only input is affected, and input is about 30% of a FRAC's cost ($0.25 of $0.84), so the saving is about $0.06–0.09 per FRAC (estimate; measure with `npm run ai:report`). Not used today (`cache_read_tokens` is always 0) | `providers/text/claude.ts`, prompt order in `prompts.ts` (fixed parts first) |
| B2 | Switch the default profile to `claude-mixed` after a quality comparison | Activities and ladders on Haiku cost about a twentieth as much. Known risk: the MgSO4 slip persisted on Haiku ladders, so compare on the expert check first | `config/service.json` `AI_PROVIDER` |
| B3 | Find out why research made 0 web searches in the Claude run | The research step is meant to cite government sources; without search it relies on the model's memory | `claude.ts` web search tool, research prompt |
| B4 | Effort comparison: run the same FRAC on `claude` and `claude-fast` | Thinking is 51% of competencies output and 75% of the expert check; lower effort may give the same quality faster and cheaper | `npm run ai:report` on both runs |
| B5 | Spending caps: a per-job and per-day dollar limit that stops new calls | A loop or a large "full" FRAC can't run up an unexpected bill. The report already warns at `REPORT_DAILY_BUDGET_USD` | `JobRunner`, `askModel` |
| B6 | Message Batches API for the expert check and "Rewrite all ladders" | 50% cheaper for work the user doesn't watch live; the trade-off is minutes-to-hours latency, so only for background runs | new provider method |
| B7 | Write ladders only for changed competencies after a competencies revise, and say so in the progress | Already true for unchanged code and label; make the saving visible ("8 of 32 need new ladders") | `ladders.step.ts`, job message |
| B8 | Build the "already checked in code" sentence of the review prompt from `config/outdated.json` | It lists the outdated names by hand, so a new entry in the file doesn't reach Vidya's prompt | `prompts.ts` `CODE_CHECKS` |
| B9 | Validate `config/outdated.json` and `review-rules.json` with Zod at startup and in `config:check` | A typo in a reviewer-edited file silently drops a condition or fails the review job | `config/outdated.ts`, `tools/ops/check-config.ts` |
| B10 | Scope rule tables for Staff Nurse, GNM and CHO | The nurse family gets no scope checks or scope guidance in the prompts today | `config/review-rules.json`, with the clinical team |
| B11 | Store a hash of each prompt template version in `ai_calls` | Lets the reports compare cost and quality before and after a prompt change | `ask-model.ts`, migration 009 |

### Housekeeping

- Fix the flaky workbook-reader "History" sheet test (blocker B-6 in `docs/releases/AI_SERVICE_TRACKER.md`).
- Bring the shared Claude Doc "FRAC Studio: how each step works" in step with `docs/FRAC_STUDIO_GUIDE.md`.
- Keep this file in step when a route, body field or AI task changes; it is checked by hand today (see A7).
