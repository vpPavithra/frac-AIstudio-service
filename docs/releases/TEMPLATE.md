# frac-studio-service <X.Y.Z>: <one-line name>

<!-- Copy to docs/releases/release-<X.Y.Z>.md at release-cut time. Fill every section; write "None." where
     nothing changed rather than deleting the heading. Short SHAs on every bullet. Delete these comments. -->

| | |
| --- | --- |
| **Status** | Draft / Released <YYYY-MM-DD> |
| **Build branch** | `release-<X.Y.Z>` (Jenkins deploys from the branch) |
| **Tag** | `v<X.Y.Z>` |
| **Baseline** | `v<previous X.Y.Z>` or "first release" |
| **Commits** | <n> |
| **AI provider in this release** | `<AI_PROVIDER profile>`: <complex model> / <default model> |
| **AI response report** | [`reports/ai-report-<date>.md`](../../reports/ai-report-<date>.md) |
| **Author** | <name> |

## Summary

<2–3 plain sentences for a non-engineer: what FRAC Creator and Reviewer users get from this release, and
how the AI answered compared with the last release.>

## ✨ Features

- **<scope>**: <what users or the team can now do> (`<sha>`)

## 🐛 Fixes

- **<scope>**: <what was wrong, what happens now> (`<sha>`)

## 🧠 AI changes

<!-- Anything that changes what the model is asked or how its answer is judged. These move the numbers
     in the next section, so name each one. -->

| Area | Change | Expected effect | SHA |
| --- | --- | --- | --- |
| Provider / models | <e.g. claude → claude-mixed; model id change> | | |
| Prompts | <METHOD / SOURCE_LIBRARY / step prompt change> | | |
| Review rules | <config/review-rules.json, config/outdated.json edits> | | |
| Limits and batching | <AI_BATCH_*, REVIEW_*, LLM_* changes> | | |
| Prices | <rates in config/ai-providers.json> | | |

## 📊 How the AI responded

<!-- Run `npm run ai:report -- --since <baseline release date> --out reports/release-<X.Y.Z>-ai.md` on the
     environment the release was tested on, and copy the headline numbers here. Mock runs do not count:
     their tokens and times say nothing about a real model. -->

| Measure | Previous release | This release | Change |
| --- | --- | --- | --- |
| Provider · models | | | |
| AI calls in the test period | | | |
| Answered in the expected shape | | | |
| Wrong-shape answers (`AI_OUTPUT_INVALID`) | | | |
| Failed calls (by code) | | | |
| Average / p95 time per call | | | |
| Cost of one compact FRAC, research to expert check | | | |
| Cost of one review upload | | | |
| Checklist flags kept after the quote check | | | |
| Checklist flags dropped as "quote not in the file" | | | |
| Jobs failed (by code) | | | |

**What improved, and why:** <one bullet per measure that moved, tied to an AI change above>

**What got worse, and what we will do:** <or "Nothing.">

## 🚧 Blockers

<!-- Open blockers at release time, from AI_SERVICE_TRACKER.md. Closed ones go under "Resolved". -->

| ID | Blocker | Impact | Owner | Since | Status |
| --- | --- | --- | --- | --- | --- |
| B-<n> | | | | | Open |

**Resolved in this release:** <B-n: how it was resolved (`<sha>`)>

## ⚠️ Deploy notes and risk

- **Migrations:** <none | `migrations/00N_….sql`: what it adds; runs once, safe to re-run>
- **New or changed settings:** <none | keys in config/service.json or config/ai-providers.json>
- **Secrets:** <none | e.g. `ANTHROPIC_API_KEY` must be in the secret store>
- **Outbound network:** <none | e.g. `generativelanguage.googleapis.com`, `api.anthropic.com`>
- **API contract with orgportal / uiproxy:** <none | change + which orgportal version needs it>
- **Breaking changes:** <none | describe + migration step>

## ✅ Pre-deploy checklist

- [ ] `npm run check` green (typecheck, lint, config check, tests)
- [ ] `npm run ai:check` passes against the production provider profile
- [ ] One compact FRAC and one review run end to end on staging with the real provider
- [ ] `npm run ai:report` attached above, numbers copied, compared with the previous release
- [ ] Migrations applied on staging (`npm run migrate`, or `node migrate.js` in the image)
- [ ] Docker image built, `/health` answers
- [ ] Open blockers above accepted for this release, or the release waits
- [ ] Rollback ref confirmed: `release-<previous X.Y.Z>`

## Release and rollback

**Deploy:** Jenkins job pointed at the build branch `release-<X.Y.Z>`. Apply migrations first.

**Rollback:** re-run the job on `release-<previous X.Y.Z>`. Migrations only add tables and columns, so the
previous build runs on the newer schema.

---

_Add a row to the Releases table in `AI_SERVICE_TRACKER.md` when this is released._
