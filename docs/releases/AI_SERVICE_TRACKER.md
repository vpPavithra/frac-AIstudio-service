# FRAC Studio AI service: updates, blockers and releases

The running record for the FRAC Creator and Reviewer AI service. Add to it as work lands, not at release
time. Release notes (`release-<X.Y.Z>.md`, from [TEMPLATE.md](TEMPLATE.md)) are cut from this file.

**How to keep it current**

| When | Do |
| --- | --- |
| A change merges | Add a row to **Updates** (newest first) with its short SHA and what it does to the AI |
| Something blocks progress | Add a row to **Blockers** with the next free `B-<n>`; close it with the date and SHA |
| After a test run on a real provider | `npm run ai:report -- --since <date>`, then add a row to **AI quality over time** |
| A release is cut | Copy `TEMPLATE.md` to `release-<X.Y.Z>.md`, fill it from here, add a row to **Releases** |

Nothing is deployed yet: FRAC Studio deploys once, after the full testing checklist in orgportal's
`FRAC_STUDIO_BUILD_TRACKER.html` passes.

## Releases

| Version | Status | Date | AI provider | Answered OK | Compact FRAC cost | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 0.2.0 | Draft | – | `gemini-free` · `gemini-3.6-flash` | not measured | not measured | [release-0.2.0.md](release-0.2.0.md) |
| 0.1.0 | Not deployed | 2026-11-02 | none (computed checks only) | – | – | First build: review engine, Excel, API |

## AI quality over time

One row per `npm run ai:report` on a test run. Mock rows only prove the pipeline; real-provider rows are the
ones a release is judged on.

| Report date | Provider · models | Calls | Answered OK | Wrong shape | Failed calls | Avg / p95 time | Flags kept | Quote not in file | Report |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-06 | claude · claude-sonnet-5-5, standard ANM FRAC, research → expert check (server run from 17:39) | 21 | 100% | 0 | 0 | 21.5 s avg; ladders 44 s wall | 2 of 2 | 0% | [ai-report-2026-11-06.md](../../reports/ai-report-2026-11-06.md): $0.84 billed, 184,130 tokens |
| 2026-11-06 | gemini-free · gemini-3.6-flash, standard ANM FRAC (research → 7 of 8 ladder calls) | 14 | 93% (13) | 0 | 1 (`AI_BUSY`, daily quota) | calls run one at a time; 14 min for the run | – | – | none (measured in the DB) |
| 2026-11-06 | gemini-free · gemini-3.6-flash (`ai:check` only) | 2 | 100% | 0 | 0 | – | – | – | none (key check) |
| 2026-11-06 | mock (sample data) | 48 | 100% | 0 | 0 | 0.2 s / 0.2 s | 23 of 23 | 0% | [ai-report-2026-11-06.md](../../reports/ai-report-2026-11-06.md) |

## Blockers

| ID | Opened | Blocker | Impact | Owner | Status |
| --- | --- | --- | --- | --- | --- |
| B-1 | 2026-11-04 | Real Meghalaya ANM, Bihar ANM and GNM workbooks for the r3 acceptance tests | The rules file's expected numbers (e.g. 28 rule-based findings on Meghalaya ANM) cannot be checked | Sarvesh | Open |
| B-2 | 2026-11-02 | Verbatim METHOD, SOURCE_LIBRARY and method paragraph from `frac-studio.html` | Prompts and the Excel method paragraph are stand-ins; answer quality is not final | Sarvesh | Open |
| B-3 | 2026-11-04 | Clinical team answers: ME68 operative-procedure flags on define/assist indicators (the "previous caesarean" case is fixed with an `allow`, 6 Nov); "planning" read as a KCM name; ASHA "instead" texts marked (verify) | Possible false findings on real dictionaries | Clinical team | Open |
| B-4 | 2026-11-06 | First real-provider run of a full FRAC and review | No real-model numbers yet: cost per FRAC, answer quality, repeatability | Pavithra | Open: key in `.env` and verified with `ai:check` (6 Nov) |
| B-8 | 2026-11-06 | Gemini free tier allows 20 requests a day per model per project; a standard FRAC needs about 21 calls (compact about 14) | A full FRAC cannot finish in one day on one free model; the ladder step failed with `AI_BUSY` at call 14 | Pavithra | Open: options are a billed key, or splitting the tiers across two free models (40 a day) |
| B-7 | 2026-11-06 | `gemini-3.8-flash` overloaded on Google's side (503 high demand, 504 timeouts) | `gemini-free` runs `gemini-3.6-flash` instead; same price | Google | Open: retry `ai:check` on 3.8 later |
| B-5 | 2026-11-06 | Research web search: domains to confirm; the Gemini free tier has no search, and Gemini cannot enforce domains | Research on `gemini-free` relies on the model's own knowledge | Product | Open |
| B-6 | 2026-11-06 | `workbook-reader` test for a sheet named "History" fails now and then | CI can go red on an unrelated change | Pavithra | Open |

## Updates

| Date | SHA | Area | Change | Effect on the AI |
| --- | --- | --- | --- | --- |
| 2026-11-09 | (uncommitted) | Review rules | Expert check on ASHA · Karnataka (`1262b514`) gave 2 scope Blockers and a KCM-name Minor that were false: the scope rules read sentences that rule an act out ("does not … inject", "without … injections", "correct any drift to … prescribing") as the ASHA doing it, and `DOMAIN_LOOKS_KCM` read "Family planning" as the KCM name "Planning". Fixes: negation and drift `allow` on the ASHA injections and ASHA/ANM prescribing rules; clinical planning phrases excluded. Verified offline on the stored FRAC: rule-based findings 4 → 1 (ASHA7 "Scheme entitlement facilitation" too broad, a real content finding) | Triage on that FRAC moves from Revise to Use with minor edits; no false Blockers for well-scoped ASHA text |
| 2026-11-06 | (uncommitted) | Cost | Repeat expert checks reuse stored checklist answers for unchanged competencies (`REVIEW_REUSE_ANSWERS`, `migrations/008`); fresh reviews ask everything. New `claude-mixed` profile (Haiku 5.5 for activities and ladders): 4 ladders for $0.004 vs about $0.04 on Sonnet, no blockers, but it kept the MgSO4 slip already in the ladder | A re-check after a fix drops from about $0.16 to the changed batch; about half the FRAC cost with `claude-mixed` |
| 2026-11-06 | `3867a87` | Review rules, prompts | Expert-check blockers on the Claude FRAC (ANM15, ANM26, ANM14). Root causes: the Creator prompts never saw the Reviewer's scope rules, so Claude wrote "Manage emergencies / complications" and "the emergency drugs"; the operative rule fired on "previous caesarean" in a risk-factor list. Fixes: `reviewGuard` puts the cadre's scope rules (act + "write instead") and the outdated names into the activities, competencies and ladders prompts; `allow` for a previous / prior caesarean on the operative rule. Verified: rule fix 3 → 2 blockers offline; regenerating ANM15 and ANM26 with the guard ($0.03) → 0 blockers | Creator output passes the expert check's scope rules |
| 2026-11-06 | (uncommitted) | Reporting | Totals table (tokens in, out, thinking, total; cost, billed, estimated); `--provider` filter; server runs recorded (`migrations/007_server_runs.sql`) and `npm run ai:report:run` for one run start to stop; `--from` / `--to` windows; `--frac <id>` costs one FRAC's complete flow; `npm run review:report -- <id>` analyses one review or a FRAC's expert checks; reports keep Claude only by default (`REPORT_PROVIDERS`) | The run report shows exactly one server run; [frac-e5dd92cd-cost.md](../../reports/fracs/frac-e5dd92cd-cost.md) costs a full FRAC at $0.84 |
| 2026-11-06 | `8495431` | Reporting | Start time and thinking tokens per call (`migrations/005`, `006`); wall time and thinking share per step; daily report compared with the day before; "AI call started / finished" log lines tagged with the job; report sections: by day (cost and billed), tokens and cost per step and provider, per FRAC and review, revisions, by user, slowest calls, every call, daily budget warning (`REPORT_DAILY_BUDGET_USD`); `npm run ai:report:daily` (IST days) | Cost per step and per FRAC visible every day |
| 2026-11-06 | `044bbf0` | Reliability, speed | Root cause of "ladders answer did not have the expected shape (Expected object, received null)": 1 of 8 Claude ladder calls returned text that was not valid JSON. Fixes: Claude structured output for ladders, roles, competencies and the review checklist (JSON always valid); a tolerant JSON reader (preambles, braces in strings, raw line breaks, trailing commas); one automatic retry on a wrong-shape answer (`LLM_INVALID_RETRIES`); the reason is logged. Speed: 6 calls at once (was 3), research at most 3 searches (was 5), call time excludes queue wait; `claude-fast` profile for the effort comparison | Fewer failed steps; ladders and review about one wave shorter; research cheaper |
| 2026-11-06 | `044bbf0` | Providers | `gemini-free` moved to `gemini-3.6-flash`; `AI_UNAVAILABLE` names the model and HTTP status; clearer `keyEnv` error | Real Gemini answers on the free tier; overloads are told apart from key problems |
| 2026-11-06 | `044bbf0` | Reporting | Per-call AI log (`ai_calls`), checklist flag counts on each review, `npm run ai:report`, release template and this tracker | Every call's provider, model, time, tokens, cost and outcome is now measured |
| 2026-11-06 | `58d2441` | Providers | Switchable profiles (`gemini-free` default, `gemini-paid`, `claude`, `mock`); Gemini provider; `dev:mock` / `dev:ai` / `ai:check` | Gemini can answer; free tier runs one call at a time with no web search |
| 2026-11-06 | `6878558` | Docs | File header comments, codebase guide | None |
| 2026-11-06 | `6db13e9` | Config, fixes | Batch sizes and limits in config; job heartbeat; AI flags dropped only by rules marked `suppressesAiFlags` | Fewer AI flags wrongly dropped for non-frontline cadres; long calls no longer marked interrupted |
| 2026-11-05 | `127ddc7` | AI steps, review r3 | Creator steps 2–5 on the AI; Vidya's fixed checklist with quote checks; same file, same review; cost per call | The AI writes research, roles, competencies and ladders; review flags must quote the file |
| 2026-11-02 | `1dff216` | Reviewer | Read workbooks with a sheet named "History" | None |
| 2026-11-02 | `5a58030` | First build | Review engine, Excel in and out, v1 API | None (computed checks only) |

## Known gaps (not blockers)

- Uploaded JDs and government orders are not yet passed to the research prompt (spec 5.2).
- No JSON repair: a wrong-shape answer fails the job; the team re-runs the step.
- When one batch fails, batches already running finish and are billed; there is no cancellation.
