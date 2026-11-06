# Review engine r3: gap analysis and build status

**Checked on:** 4 November 2026 · **Built:** 4 November 2026 · **Committed:** 6 November 2026 (service `127ddc7`, orgportal `110c8e94`)
**Sources:** `FRAC_Creator_and_Reviewer_spec.md` (updated revision) and `FRAC_Reviewer_rules_r3.md` (3 Nov 2026), both in this folder.
**Checked against:** frac-studio-service `src/services/review-engine/*`, `ai-review.service.ts`, `review.service.ts`,
`excel/workbook-writer.ts`, `config/outdated.json`, and the orgportal `frac-studio` review report.

## What changed in the spec

The updated spec changes **only the Reviewer** (sections 6.1, 6.3, 6.4, 6.5, 6.6, 7, 9). The Creator steps (section 5) are the same.

- **r1 (what we built):** computed checks, then one open-ended Kaushal + Vidya call that wrote findings, verdict, triage, summary and strengths.
- **r3 (new):** everything decidable by a list or pattern moves into code. The AI answers three fixed questions
  (Q1 scope, Q2 accuracy, Q3 state fit), every flag must quote the file, and code writes the titles, severities,
  verdict, triage, summary and strengths. A fingerprint cache makes the same file give the same review.

## Who does the AI work, and where the raw data comes from

Line numbers point into the updated `FRAC_Creator_and_Reviewer_spec.md` in this folder.

**Both agents are AI.** Line 32: "Agents are personas inside prompts, not separate services." Kaushal is a
FRAC/HR architect (line 33). Vidya checks clinical and programme accuracy for Indian frontline health (line 34).
Line 16: "AI agents build a full FRAC competency dictionary…". Neither is a person, and neither collects field data.

| Where | Agent | Spec |
|---|---|---|
| Step 2 research, step 3 roles and activities, step 4 competencies | Kaushal alone, one model call each (activities batched) | lines 218, 253, 283 |
| Step 5 level ladders | Kaushal writes and Vidya checks each clinical fact, inside the same call | line 316 |
| Expert check and Reviewer (**changed in r3**, built) | Vidya alone, answering the fixed Q1 scope / Q2 accuracy checklist per competency, plus the Q3 state-fit call. Code writes the titles, severities, verdict and summary. The old spec had one open-ended Kaushal + Vidya call here (old line 457). | line 481; rules §6 |
| Job progress messages in the UI | Name Kaushal and Vidya as the ones working. The check/review lines now say "rule-based checks, then Vidya's checklist" (the spec text at line 633 predates r3) | lines 627–633 |
| Excel files that go to experts | **No agent names**: "Rule-based check" / "AI judgement (quoted)" | line 596; rules §8 |

**The raw data comes from people, not from a field agent:**
- The team fills in the brief and can upload JDs and government orders (§5.1, line 214). **Not built yet.**
- Web search is the AI side gathering material, restricted to government sites during research (§5.2, line 251). **Built.**

Status key: ✅ built · 🟡 partly · ❌ not built · ⚠️ deviation (with reason).

## 1. Parser (rules §2, spec 6.1) — `review-engine/parse-workbook.ts`

| Rule | Status |
|---|---|
| Read all competency sheets (`level\s*1\|applicable level\|theme\s*1`) | ✅ |
| KCM-format rows (`format:"kcm"`, `themes[]`, `applicableLevel`, `levels: []`), type from sheet name | ✅ |
| `Position:` cell in the first 12 rows → `model.position` | ✅ |
| Single `Roles/Activities` column + `Description` layout | ✅ |
| Posting columns exclude `desc` | ✅ |
| `model.hasMapping` | ✅ |
| Bloom and ladder counts use laddered competencies only; KCM counted separately (`stats.kcm`) | ✅ |
| Indicators joined inline with " -" (the entity-service master data format) | ✅ added (not in the rules file) |

## 2. Cadre family (rules §3) — `review-engine/rules.ts`

| Rule | Status |
|---|---|
| `cadreFamily(ctx.cadre \|\| position \|\| title)` → asha / anm / cho / nurse / none | ✅ |

## 3. Rule-based checks (rules §4) — `review-engine/checks.ts`

| Rule | Status |
|---|---|
| BANNED adds `knowledge of`, `has knowledge` | ✅ |
| No Role–Activity sheet (M) | ✅ |
| Syllabus activities ("Activities read as syllabus outcomes"), "Competency type is missing", no B/F, thin roles | ✅ |
| Competencies are too broadly defined (a–e) | ✅ Untyped competencies are treated as Domain |
| `DOMAIN_LOOKS_KCM` (m), frontline `KCM_FUNCTIONAL_NOT_FRONTLINE` (m) | ✅ |
| Incomplete ladders, repeated L5, same label twice (laddered only) | ✅ |
| KCM-format competencies with no job ladder (M) | ✅ |
| Level ladders are shifted upward (`LADDER_RULES` 1–3) | ✅ |
| Scope rules per act, sentence by sentence, with `allow` (ANM/MPW/LHV, ASHA) | ✅ ASHA "instead" texts are not in the rules file; written and marked "(verify)" |
| OUTDATED: the r1 patterns + NRT, RMNCH+A, NRHM, VHND, Five Rights, partograph-without-LCG, ISO/device law | ✅ with `onlyIfAbsent` and `frontlineOnly` |
| No mapping column → one minor, mapping checks skipped | ✅ |
| Core {cadre} areas with no dedicated competency (`AREAS`) | ✅ |
| Rule tables in editable config | ✅ `config/review-rules.json` + `config/outdated.json` |

## 4. AI judgement (rules §6, spec 6.4) — `ai-review.service.ts`, `ai/prompts.ts`

| Rule | Status |
|---|---|
| Per-competency call: Vidya, 6 per call, 3 parallel, Q1 + Q2, quotes of 6–25 words | ✅ |
| Prompt names the code checks and the exact scope hits, "do NOT repeat" | ✅ |
| State call (Q3), five categories, max 6, only for a named state | ✅ |
| Quote check (normalised, 4+ words, in that competency's text) | ✅ |
| Drop flags covered by OUTDATED, ladder rules 2–3, or a code scope hit at the same code and level | ✅ |
| Merge into ≤ 3 fixed-title findings (B / M / m) | ✅ |
| Reviewer temperature 0 | ⚠️ No temperature is sent to any provider (Claude Sonnet 5.5 rejects it; the Gemini profiles leave it unset). The spec says the fingerprint store is what guarantees repeatability, and that is built. |

## 5. Report (rules §7) — `review-engine/report.ts`

| Rule | Status |
|---|---|
| Sort: severity, then check order, then rule-based before AI | ✅ |
| Computed triage, verdict, summary, strengths | ✅ |
| Per-check status | ✅ |

## 6. Same file, same review (rules §9) — `review-engine/fingerprint.ts`, `review.service.ts`

| Rule | Status |
|---|---|
| `ENGINE_VERSION` + `fingerprint`, 40 hex | ✅ Also hashes the rule tables, so a config edit never reuses an old review |
| Same upload returns the stored review (`fromCache: true`, HTTP 200, `jobId: null`) | ✅ Per owner |
| "Run a fresh review": `POST /v1/frac-reviews/:id/rerun`, or upload with `fresh=true` | ✅ |
| Stored in Postgres keyed by fingerprint | ✅ `migrations/003_review_fingerprint.sql` |

## 7. Excel and UI labels (rules §8, spec 6.5, 7)

| Rule | Status |
|---|---|
| Excel Method row (engine version + fingerprint) on Review and Expert check sheets | ✅ |
| Excel "Found by": "Rule-based check" / "AI judgement (quoted)", no agent names | ✅ |
| orgportal finding label: "Rule-based check" / "AI judgement · quoted from the file" | ✅ `review-report.component` |
| orgportal provenance line | ✅ under the summary |
| orgportal saved-review note + "Run a fresh review" link; handle `jobId: null` | ✅ `reviewer.component` loads the saved review directly |
| orgportal job panel copy for check / review | ✅ `FRAC_STUDIO_JOB_COPY` |

## 8. Acceptance tests (rules §10)

| Test | Status |
|---|---|
| r3 rules, parser layouts, checklist verification | ✅ `review-engine/rules-r3.test.ts`, `ai-review.service.test.ts`, `report.test.ts` |
| Mock flow: expert check (4 calls: 3 batches + state), fromCache, rerun | ✅ `src/mocks/mock-flow.test.ts` |
| Meghalaya ANM FRAC (28 rule-based findings, triage revise) | ❌ fixture not in the repo — ask Sarvesh |
| Bihar ANM, GNM r3 assertions | ❌ fixtures not in the repo |
| Repeatability CI test (`review.repeatability.test`) | ❌ needs the fixtures and a real key |

## 9. Verified on real data: the entity-service competency master

`POST /apis/proxies/v8/entity/v1/search` (`entityType: Competency`) returns 129 competencies in this shape:
`{code, name, description, type, area, levels: [{levelNumber, levelName, levelDescription}]}`. It maps one to
one onto the review model (name → label, levels → L1–L5 label/desc). Run through r3 as ANM, Bihar:

- Triage **revise**: 7 blockers, 11 major, 7 minor.
- As the acceptance tests expect: C37 "National Health Programs" flagged as a scheme list (§10.2); ME70's
  Lunacy Act, Mental Health Act 1987 and NDPS 1965 as three Blockers (§10.3).
- Level labels: L1 111/129 start with a non-measurable verb. Six generic L5 labels repeated across 4–16 competencies.
- Outdated: TT (C2, ME2), RNTCP and NPCDCS (C37, ME29), VHND (C36), partograph without LCG (C3, ME3).
- Missing ANM areas: NCD screening, TB and vector-borne disease.
- The master mixes cadres (C* ANM, ME* GNM, ICDS*, UP-C*), so a per-cadre review needs filtering by code family.

**Questions for the clinical team from this run:**
- "Operative or MTP procedures" fires on ME68 indicators that only *define* or *assist with* forceps/vacuum
  delivery ("Remembers the definition…", "Assists the clinical practitioner during…"). Add an `allow` for
  knowledge/assist verbs?
- `DOMAIN_LOOKS_KCM` matches "planning", so "Birth Planning and Preparedness" is flagged as a KCM name.
- Data quality: type "Behavourial" (one record), area "Publich Health" (75 records).

## Open items carried from the rules file (§11)

CHO and Staff Nurse scope lists; optional state rule packs; a cadre-subject rule for GNM-style dictionaries;
confirm the r3 repeatability numbers on the provider in use. The service now runs on Gemini (`gemini-free`
by default) or Claude (`AI_PROVIDER`); the rules file measured them with Gemini, so a first run on the free
tier is a like-for-like check.
