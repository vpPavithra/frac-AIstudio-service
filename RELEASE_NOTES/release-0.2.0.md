# frac-studio-service 0.2.0: AI Creator and Reviewer

| | |
| --- | --- |
| **Status** | Draft (not deployed; FRAC Studio deploys once, after full testing) |
| **Build branch** | `release-0.2.0` (to be cut) |
| **Tag** | `v0.2.0` (to be cut) |
| **Baseline** | `0.1.0` (`5a58030`, 2 Nov 2026, never deployed) |
| **Commits** | 5 so far (`127ddc7` … this change) |
| **AI provider in this release** | `gemini-free`: `gemini-3.6-flash` / `gemini-3.6-flash` (key verified 6 Nov 2026; Claude is one setting away) |
| **AI response report** | [`reports/ai-report-2026-11-06.md`](../reports/ai-report-2026-11-06.md) (mock only so far) |
| **Author** | Pavithra Prakash |

## Summary

The Creator can now research a job, draft roles and activities, derive competencies and write level ladders
with AI, and the Reviewer adds Vidya's fixed checklist to the rule-based checks. The AI provider is a
setting: Gemini's free tier by default, Gemini paid or Claude when chosen. Every model call is now measured,
so the next real run will show how the AI answered and what it cost.

## ✨ Features

- **Creator AI steps**: research, roles and activities, competencies and level ladders run as jobs, with revise-with-feedback and versions (`127ddc7`)
- **Reviewer r3**: rule-based checks, then Vidya's Q1 scope / Q2 accuracy / Q3 state-fit checklist, with every AI flag checked against a quote from the file; "same file, same review" (`127ddc7`)
- **Cost per job**: tokens, web searches and USD per call, shown in the portal (`127ddc7`)
- **Switchable AI providers**: `AI_PROVIDER` picks a profile in `config/ai-providers.json`; Gemini provider added (`58d2441`)
- **AI response report**: per-call log, checklist flag counts, `npm run ai:report`, this template and the tracker (this change)

## 🐛 Fixes

- **Excel export**: the Review and Expert check sheets style their findings header again (`6db13e9`)
- **Jobs**: a long model call is no longer marked interrupted by the watchdog (`6db13e9`)
- **Reviewer**: AI flags are no longer dropped by rules that do not apply to the cadre (`6db13e9`)

## 🧠 AI changes

| Area | Change | Expected effect | SHA |
| --- | --- | --- | --- |
| Provider / models | Claude Sonnet 5.5 only → profiles; default `gemini-free` (`gemini-3.6-flash` on both tiers; `gemini-3.8-flash` was overloaded on 6 Nov 2026) | Runs free of charge; lower quality ceiling than a paid model is possible, to be measured | `58d2441` |
| Prompts | Step and checklist prompts written to spec §3; METHOD / SOURCE_LIBRARY are stand-ins (B-2) | Shape-valid answers; final wording pending | `127ddc7` |
| Review rules | r3 rule tables in `config/review-rules.json`, `config/outdated.json`; `suppressesAiFlags` | Rule-based findings identical every run | `127ddc7`, `6db13e9` |
| Limits and batching | `AI_BATCH_*`, `REVIEW_*`, `LLM_*` in config; free tier capped at 1 call in flight | Free-tier runs stay under the per-minute quota, but take longer | `6db13e9`, `58d2441` |
| Prices | Per-profile rates; free-tier cost shown as a paid-price estimate | Cost on screen previews the paid bill | `58d2441` |

## 📊 How the AI responded

Only mock runs so far (48 calls on 6 Nov 2026). They prove the pipeline end to end; they say nothing about a
real model. The first `gemini-free` run (B-4) fills the "This release" column.

| Measure | Previous release | This release | Change |
| --- | --- | --- | --- |
| Provider · models | none | `gemini-free` · `gemini-3.6-flash` | – |
| AI calls in the test period | – | 48 (mock) | – |
| Answered in the expected shape | – | 100% (mock) | – |
| Wrong-shape answers (`AI_OUTPUT_INVALID`) | – | 0 (mock) | – |
| Failed calls (by code) | – | 0 (mock) | – |
| Average / p95 time per call | – | not measured | – |
| Cost of one standard FRAC, research to expert check | – | about $0.35 at `gemini-3.6-flash` paid prices, about 21 calls (measured through 7 of 8 ladder calls: $0.24; last ladder call and the expert check estimated). $0 billed on the free tier | – |
| Cost of one review upload | – | not measured | – |
| Checklist flags kept after the quote check | – | 23 of 23 (mock) | – |
| Checklist flags dropped as "quote not in the file" | – | 0% (mock) | – |
| Jobs failed (by code) | – | 0 of 12 (mock) | – |

**What improved, and why:** first release with AI; no baseline.

**What got worse, and what we will do:** nothing measured yet.

## 🚧 Blockers

| ID | Blocker | Impact | Owner | Since | Status |
| --- | --- | --- | --- | --- | --- |
| B-1 | Real Meghalaya ANM, Bihar ANM and GNM workbooks | r3 acceptance numbers unchecked | Sarvesh | 2026-11-04 | Open |
| B-2 | Verbatim METHOD / SOURCE_LIBRARY / method paragraph | Prompts are stand-ins | Sarvesh | 2026-11-02 | Open |
| B-3 | Clinical answers (ME68, "planning", ASHA texts) | Possible false findings | Clinical team | 2026-11-04 | Open |
| B-4 | First real-provider run of a full FRAC and review | No real-model numbers | Pavithra | 2026-11-06 | Open: key verified with `ai:check` |
| B-5 | Research search domains; no search on the Gemini free tier | Research without web sources | Product | 2026-11-06 | Open |
| B-6 | Flaky "History" sheet workbook test | CI can go red | Pavithra | 2026-11-06 | Open |
| B-8 | Free tier: 20 requests a day per model; a standard FRAC needs about 21 | A FRAC cannot finish in a day on one free model | Pavithra | 2026-11-06 | Open |

**Resolved in this release:** none yet.

## ⚠️ Deploy notes and risk

- **Migrations:** `003_review_fingerprint.sql` (reviews.fingerprint), `004_ai_calls.sql` (per-call AI log). Both only add; safe to re-run.
- **New or changed settings:** `config/ai-providers.json` (new); `AI_PROVIDER` now a profile name; removed `ANTHROPIC_*_MODEL`, `LLM_*_EFFORT`, `RATE_*`.
- **Secrets:** `GEMINI_API_KEY` (or `ANTHROPIC_API_KEY` for `claude`) in the secret store.
- **Outbound network:** `generativelanguage.googleapis.com` (Gemini) or `api.anthropic.com` (Claude).
- **API contract with orgportal / uiproxy:** `POST /v1/frac-reviews/:id/rerun`; review upload may answer `jobId: null` with `fromCache: true`. Needs orgportal `110c8e94` or later.
- **Breaking changes:** none for callers.

## ✅ Pre-deploy checklist

- [ ] `npm run check` green (typecheck, lint, config check, tests)
- [ ] `npm run ai:check` passes against the production provider profile
- [ ] One compact FRAC and one review run end to end on staging with the real provider
- [ ] `npm run ai:report` attached above, numbers copied
- [ ] Migrations applied on staging
- [ ] Docker image built, `/health` answers
- [ ] Open blockers above accepted for this release, or the release waits
- [ ] Rollback ref confirmed: first deploy, so rollback is "scale to zero"

## Release and rollback

**Deploy:** Jenkins job pointed at `release-0.2.0`. Apply migrations first.

**Rollback:** first deploy of the service; turn the FRAC Studio route off in the portal and scale the
service to zero. Migrations only add tables and columns.
