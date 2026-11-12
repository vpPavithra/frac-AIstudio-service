# Review decisions (Nov 2026): what they do to AI cost and tokens

Last updated: 11 Nov 2026. Covers the eight decisions from the FRAC Studio review and the upload templates.
What changed and where in the code: [releases/REVIEW_DECISIONS_2026-11.md](releases/REVIEW_DECISIONS_2026-11.md).

## The short answer

Two of the decisions save money every time a team uses them:

- **Standard documents.** An uploaded Roles, Competencies or Sources sheet replaces its AI step.
- **Position matching.** A matched position reuses roles that already exist.

With all three sheets uploaded, a standard FRAC on Claude costs about **$0.30 instead of $0.96 (−69%)**. Reusing a
matched FRAC alone saves about **$0.14 (−14%)**. Five decisions do not touch the AI at all. Letting the agent choose the
size can go either way: it saves money on narrow jobs and costs more on broad ones.

## The baseline

All figures are for Claude Sonnet 5.5 (profile `claude`). Prices come from `config/ai-providers.json`:
- $2 per million input tokens;
- $10 per million output tokens;
- $10 per 1,000 web searches.

The baseline is the first pass of the ASHA Karnataka FRAC (standard size, 12 roles, 72 activities, 32 competencies),
measured on 9 Nov 2026 by `npm run ai:report` (`reports/fracs/frac-1262b514-cost.md`):

| Step | Calls | Tokens in | Tokens out | Web searches | Cost |
| --- | --- | --- | --- | --- | --- |
| 2 Research | 1 | 26,499 | 11,132 | 3 | $0.194 |
| 3 Roles & activities | 4 (1 roles + 3 activity batches) | 18,368 | 9,982 | 0 | $0.137 |
| 4 Competencies | 1 | 6,962 | 9,826 | 0 | $0.112 |
| 5 Level ladders (first run) | 8 | ≈ 52,000 | ≈ 25,800 | 0 | $0.361 |
| 6 Expert check (first run) | 7 (6 checklist batches + state fit) | ≈ 60,000 | ≈ 4,000 | 0 | $0.160 |
| **Total** | **21** | | | **3** | **$0.96** |

Output tokens are about 70% of the bill, so whatever stops the model writing (a step skipped, a shorter answer)
saves the most. Most of research's 26,500 input tokens are the pages its 3 web searches bring back, about 7,000
tokens per search.

## Decision by decision

| # | Decision | AI calls | Tokens | Effect per standard FRAC |
| --- | --- | --- | --- | --- |
| 1 | Upload Document (JD or order) in the brief | Same | Research input: + up to 7,500 (the document, capped by `DOC_MAX_CHARS`); − about 14,000 (web searches cut from 3 to 1 by `RESEARCH_SEARCH_MAX_USES_WITH_DOCS`) | **≈ −$0.03 to −$0.04** |
| 2 | Name label "Agent" | Same | Same (the prompts are unchanged) | $0 |
| 3 | Roles preview (popup on the Level ladders tab) | None (built in the browser) | None | $0 |
| 4 | View Source link | Same | Research output + about 50 (one address per source); links are checked with plain HTTP requests, not the AI | ≈ $0.0005 |
| 5 | "Cadre" → "Positions" | Same | Same (labels only; the prompts are unchanged) | $0 |
| 6a | Standard Sources sheet | Same | Web search off: 3 searches and about 21,000 input tokens saved; the answer leaves `sources` empty, about 1,000 output tokens fewer | **≈ −$0.08** |
| 6b | Standard Roles sheet with activities | Roles step: 4 → **0** | − about 28,000 | **−$0.137** |
| 6b′ | Roles sheet, some roles without activities | Roles call skipped; activity batches only for the empty roles | Pro rata | About −$0.03, plus about −$0.03 per 4 roles that already have activities |
| 6c | Standard Competencies sheet, no ladders | Competencies call (complex) → one **mapping** call (default tier) | Output about 9,800 → about 1,000–2,000 | **≈ −$0.08 to −$0.09** (on `claude-mixed` the mapping runs on Haiku: ≈ −$0.11) |
| 6d | Competencies sheet with all five levels filled | Ladders: 8 calls → **0** | − about 78,000 | **−$0.361** more (pro rata when only some competencies have ladders: about $0.011 each) |
| 7 | Remove Standard / Full: the agent chooses the size | Same | Research output + about 30 | Depends on the job: compact **≈ $0.63**, standard ≈ $0.96, full **≈ $1.38** |
| 8 | Position matching: an earlier FRAC | Roles step: 4 → **0** | − about 28,000 | **−$0.137** |
| 8′ | Position matching: the Positions master | Roles call skipped; activity batches only for roles with no activities | Pro rata | −$0.03 to −$0.137 |
| | Templates (download) | None | None | $0 |

### How the size estimates were worked out

The step costs above scale with the sizes in `config/frac-sizes.json`:

| Size | Roles | Activities per role | Competencies |
| --- | --- | --- | --- |
| compact | 7 | 5 | 18 |
| standard | 12 | 6 | 32 |
| full | 17 | 7 | 50 |

The ladders and the expert check scale with the number of competencies, and the roles step with the number of
activities. Research costs the same at every size.

Before this change every FRAC defaulted to standard. With the agent choosing, a narrow job (one setting, one
programme) comes out compact and costs about a third less. A broad, multi-programme job comes out full and costs
more, but that is the size the job needed.

### Combined

| Situation | Steps the AI runs | Estimated cost | Change |
| --- | --- | --- | --- |
| Nothing uploaded, no match (as before) | All | $0.96 | — |
| A JD attached | All, research with 1 search | ≈ $0.92 | −4% |
| Matched an earlier FRAC | Research, competencies, ladders, check | ≈ $0.83 | −14% |
| Sources + Roles sheets | Research (no search), competencies, ladders, check | ≈ $0.74 | −23% |
| Roles + Competencies sheets (with ladders) | Research, mapping, check | ≈ $0.38 | −60% |
| All three sheets (with ladders) | Research (no search), mapping, check | **≈ $0.30** | **−69%** |

Answer reuse on the expert check (`REVIEW_REUSE_ANSWERS`) still applies on top, so re-checks cost less as before.

## Side effects to know about

- **Quality follows the documents.** A sheet is used as it is. A weak standard sheet gives a weak FRAC and is
  not "improved" by the AI. The expert check still runs on everything, so its findings show where a sheet is
  thin.
- **A long document costs more than it saves.** Each brief document is capped at 30,000 characters (about 7,500
  tokens), and the prompt carries at most that much from all documents together. At the cap, the document costs
  about $0.015 per research run, still less than the two searches it replaces.
- **Fewer searches means fewer captured links.** View Source links come from pages the search actually opened.
  With a Sources sheet there is no search, so links come from the sheet's URL column. With one search, fewer links
  are filled automatically, and the team can type the rest.
- **A revise still costs the full step.** "Revise with feedback" on roles rebuilds them with the AI even when they
  came from a sheet or a match. This is deliberate, so the team can still ask for a fresh draft.
- **Mapping to fixed competencies can leave some unused.** A standard dictionary may hold more competencies than
  the activities need. The expert check reports unused ones, and that is expected with a standard sheet.

## Checking it after the change

`npm run ai:report` shows the effect per step, with no code change:
- **Fewer calls:** the "By step" table shows fewer calls for roles and ladders when sheets or a match were used.
- **Mapping calls:** a competencies run that only maps shows a call with task `mapping`.
- **Searches:** the "Web searches" column shows 1 or 0 for research.

The mock walkthrough tests (`src/mocks/review-decisions.test.ts`) assert which AI calls each case makes:
- a Roles sheet: activities only for the empty roles;
- a Competencies sheet: one `mapping` call, and ladders only where the sheet had none;
- a Sources sheet: search set to 0;
- a matched FRAC: no roles call.

The dollar figures above are estimates from the measured baseline. One paid Claude run of each case (about $3 in
total) would replace them with measured numbers. It runs only with your go-ahead.
