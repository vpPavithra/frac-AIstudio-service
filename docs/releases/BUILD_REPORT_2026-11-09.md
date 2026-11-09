# FRAC Studio build report — 9 Nov 2026

| | |
| --- | --- |
| Scope | FRAC Studio across three repos: orgportal (UI), sunbird-cb-uiproxy (route), frac-studio-service (API, AI, review engine) |
| Service | `vpPavithra/frac-AIstudio-service`, branch `feat/frac-studio-workbook-export`, 27 commits, last `f4866bc` |
| Orgportal | branch `feat/frac-studio`, 5 feature/fix commits plus docs, last `00318ece` |
| uiproxy | branch `feat/frac-studio-proxy`, `e7bdfc3` (route `/protected/v8/fracStudio/*`) |
| Deploy | Not deployed. One deploy after complete testing |
| Prepared by | Pavithra |

## Summary

FRAC Studio builds and reviews FRAC competency dictionaries for frontline health cadres. The whole flow works end to
end on the real Claude model: brief, research, roles and activities, competencies, level ladders, expert check and
Excel download in the Creator, and upload-and-grade in the Reviewer. A complete standard FRAC costs about $0.84 and
takes about 4 minutes. Today's work fixed false Blockers in the review rules, made the expert check ask for a re-run
after fixes, and widened the activities table. What remains before go-live is the clinical team's sign-off on the
rules and prompts, the acceptance tests on real workbooks, and a full app walkthrough.

## Status at a glance

| Area | Status | Notes |
| --- | --- | --- |
| Creator flow (6 steps) | ✅ Working on Claude | Steps, revise with feedback, autosave, history and restore, Excel export |
| Reviewer (upload and grade) | ✅ Working | Rule-based checks, Vidya's checklist, computed verdict; same file returns the stored review |
| Review engine r3 | ✅ Working, rules being tuned | 2 false-positive rules fixed today (see below) |
| AI providers | ✅ Mock, Gemini free, Gemini paid, Claude, Claude mixed | Switch with `AI_PROVIDER`; no code change |
| Cost and usage reporting | ✅ Working | Per call, per step, per FRAC, per review, daily and per server run |
| Service quality gate | ✅ Pass | Typecheck, lint, config check, 165 tests passed, 3 skipped |
| Orgportal quality gate | 🟡 Partial | Typecheck and lint pass; Jest and the production build run at commit (repo rule) |
| Orgportal unit tests for FRAC Studio | 🔴 None | 24 source files, 0 spec files |
| Clinical sign-off | 🔴 Open | Scope lists, outdated list, prompts (see blockers) |
| Deploy | ⚪ Not started | By design: one deploy after complete testing |

## What is built

### Service (frac-studio-service)

- **API:** 21 endpoints under `/v1` (FRACs, steps, expert check, export, versions, reviews, jobs, info) plus `/health`.
  Every record is scoped to the user the proxy names. Full reference: `docs/API_REFERENCE.md`.
- **Creator AI steps:** research (with web search on Claude), roles, activities in batches, competencies with
  mapping, ladders in batches. Kaushal writes; Vidya checks clinical facts in ladders and answers the review checklist.
- **Review engine r3:** rule-based checks (Bloom's verbs, structure, ladder, scope, outdated names, coverage), the AI
  checklist with the quote check and answer reuse, and a verdict computed in code.
- **Jobs:** background jobs with progress, heartbeat, watchdog and spend per job.
- **Storage:** Postgres (8 migrations applied) or in memory. pgAdmin guide: `docs/DATABASE.md`.
- **Reports:** `npm run ai:report` (daily, per run, per FRAC), `npm run review:report -- <id>`.

### Orgportal (`/app/home/frac-studio`)

- Creator with the six-step tracker, editors for research, roles and activities, competencies and ladders, job
  progress with tokens and cost, version history, and the expert check report with "Fix these competencies".
- Reviewer upload, saved reviews, "Open in Creator", "Run a fresh review", review download.
- View-only role (`frac_read`) hides every button that changes a FRAC.

### uiproxy

- `/apis/protected/v8/fracStudio/*` forwards to the service and sets `x-aastrika-creator` from the session.

## Changes in this build (9 Nov)

Service commits `e2c85ee` (review rules), `0c67832` (out-of-date expert check), `a12ad3f` (docs), `9a2a254`
(reports). Orgportal: see its branch `feat/frac-studio`.

| Repo | Change | Why |
| --- | --- | --- |
| Service | Review rules: the ASHA injections rule and the ASHA and ANM prescribing rules ignore sentences that rule the act out ("does not … inject", "without … injections", "correct any drift to … prescribing") | 5 false Blockers on the ASHA Karnataka FRAC; triage moved from Revise to Use with minor edits |
| Service | KCM-name rule no longer reads "family / birth / discharge / care / delivery planning" as the KCM competency "Planning" | False Minor on ASHA9; closes the open "planning" question |
| Service | New `reviewStale` flag: a ladders fix or a hand edit after the expert check marks it out of date; the next check clears it | "Fix these competencies" left the old report in place and offered Download Excel with findings already fixed |
| Orgportal | Expert check tab: out-of-date note, "Re-run expert check" button, download held until the re-run | Same as above |
| Orgportal | Activities table: tighter cell padding and wider P1–P3, tier and competency columns | Dropdowns showed only "Y"/"N" and "Programme gui…" |
| Service docs | `API_REFERENCE.md` (every endpoint and AI call), `DATABASE.md` (pgAdmin), tracker and r3 gap analysis updated | Team reference |

Tests added: negated scope sentences, clinical "planning" labels, and the full check → fix → out of date → re-check
flow on the mock provider.

## AI usage and cost to date (local runs, 6–9 Nov)

| Provider | Calls | Answered OK | Tokens in | Tokens out | Cost | Billed |
| --- | --- | --- | --- | --- | --- | --- |
| Claude (Sonnet 5.5) | 91 | 98.9% | 608,652 | 255,308 | $3.88 | Yes |
| Gemini free tier | 14 | 92.9% | 26,826 | 58,237 | $0.24 | No (estimate) |
| Mock | 69 | 100% | 134,116 | 32,950 | $0.22 | No (estimate) |

- 34 FRACs created, 29 expert-checked. 173 jobs; 2 failed (1 Gemini quota `AI_BUSY`, 1 ladders `AI_OUTPUT_INVALID`
  before the structured-output fix).
- One complete standard FRAC on Claude: $0.84 for 21 calls (ANM Arunachal), $0.86 (Staff Nurse Karnataka), and
  $0.96 for the first pass of ASHA Karnataka on 9 Nov (research searched the web: $0.19 instead of $0.13). With the
  fixes and two re-checks that FRAC came to $1.21 for 28 calls (`reports/fracs/frac-1262b514-cost.md`). The re-checks
  reused 58 of 96 stored checklist answers.
- Output tokens are about 70% of the cost. The two levers with no effect on the flow or the answers are prompt
  caching (about $0.03–0.08 per FRAC) and refusing a second job on the same FRAC. The large savings (Haiku for
  ladders, lower effort) need a quality comparison first. Details: `docs/API_REFERENCE.md` §7.

## Known issues and open items

| # | Item | Impact | Owner | Status |
| --- | --- | --- | --- | --- |
| 1 | "Fix these competencies" always rewrites ladders, so it cannot fix a label finding (e.g. "too broadly defined") or a state-fit finding | A paid run that leaves the finding open | Pavithra | Design proposed, awaiting go-ahead |
| 2 | A second step can start on the same FRAC while one runs | Double billing, two jobs writing one FRAC | Pavithra | Proposed (A1) |
| 3 | Clinical answers: ME68 operative flags on define/assist indicators; ASHA "instead" texts marked (verify) | Possible false findings | Clinical team | Open ("planning" fixed today) |
| 4 | No scope rules for Staff Nurse, GNM, CHO | Nurse FRACs get no scope checks or scope guidance | Clinical team | Open |
| 5 | Verbatim METHOD, SOURCE_LIBRARY and method paragraph from `frac-studio.html` | Prompts and the Excel method text are stand-ins | Sarvesh | Open |
| 6 | Real Meghalaya ANM, Bihar ANM and GNM workbooks for the r3 acceptance tests | Expected rule counts cannot be checked | Sarvesh | Open |
| 7 | Claude research recorded 0 web searches in the 6 Nov run | Research may rely on model memory | Pavithra | Searching on 9 Nov (3 searches, ASHA Karnataka); watch it in the daily report |
| 8 | Orgportal FRAC Studio has no unit tests | UI regressions are caught only by hand | Pavithra | Open |
| 9 | Flaky workbook-reader "History" sheet test | CI can go red on an unrelated change | Pavithra | Open |
| 10 | Gemini free tier: 20 requests a day per model | A standard FRAC (21 calls) cannot finish in a day | — | Accepted; Claude is the go-live provider |

## Next steps

1. Decide on items 1 and 2 above, then build them.
2. Prompt caching, then a `claude` vs `claude-mixed` quality comparison on 2–3 FRACs (about $5).
3. Clinical sign-off on items 3–5; acceptance tests with the real workbooks (item 6).
4. Orgportal Jest specs for the Creator page and the API service.
5. Full app walkthrough including the view-only role, then the single deploy.

## Pre-deploy checklist

- [ ] Service `npm run check` green (✅ today: 165 passed, 3 skipped)
- [ ] Orgportal Jest and production build green
- [ ] uiproxy branch merged and its route test green
- [ ] `ANTHROPIC_API_KEY` in the secret store; `AI_PROVIDER` set; `AI_REQUIRE_REAL=true`
- [ ] `POSTGRES_*` for the shared database; migrations 001–008 applied
- [ ] `frac_admin` and `frac_read` in DevOps `window.env.portalRoles` and in the menu config
- [ ] Spending cap or daily budget alert agreed
- [ ] Acceptance tests on the real workbooks pass
- [ ] Rollback refs recorded (service, orgportal and uiproxy branches)
