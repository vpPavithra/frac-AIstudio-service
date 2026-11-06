# src/mocks: sample-data AI provider

Everything mock-related lives in this folder. When `AI_PROVIDER=mock` (`npm run dev:mock`), the AI steps
(job research, roles & activities, competencies, level ladders, Vidya's review checklist) get their
answers from here instead of a model. Nothing else in the service knows the mock exists: the provider
registry (`src/providers/registry.ts`) imports `index.ts` at runtime only when it is needed.

**This is sample data, not clinical guidance and not a reference FRAC.**

| File | What it is |
|---|---|
| `content/cadres.json` | The sample data you edit: one profile per cadre, plus the posting keywords |
| `mock-text-provider.ts` | Turns that data into answers in exactly the shape a real model must return |
| `seed.ts` | Optional: one finished FRAC and one review per owner at startup (`MOCK_SEED=true`, memory store) |
| `index.ts` | Entry point the registry loads |
| `mock-flow.test.ts` | Runs the whole flow on the mock and checks the spec rules each step must hold |

## How the switch works

```
AI_PROVIDER (config/service.json "gemini-free"; .env or the npm script override it)
  mock          → this folder; no key, no network          npm run dev:mock
  <profile>     → config/ai-providers.json, e.g.           npm run dev:ai
                  gemini-free / gemini-paid → GEMINI_API_KEY
                  claude                    → ANTHROPIC_API_KEY
                  startup stops if that profile's key is missing
```

Startup logs `"ai":"mock"` or the profile name, and `GET /v1/info` returns `{"aiProvider": …}`.
The mock's cost estimate uses the prices of the `MOCK_PRICED_AS` profile (default `gemini-free`), so a mock
run previews what the real provider would cost.

## Where the key goes

| Where | How |
|---|---|
| Your machine | `GEMINI_API_KEY=…` (or the key the profile names) in the service's `.env` (gitignored; copy `.env.example`). Restart the service, then `npm run ai:check`. |
| A server | The deployment's secret store (Kubernetes secret / Jenkins credential), exposed to the container under the same variable name. Redeploy or restart. |
| Never | Any file in `config/`. They are committed, and startup refuses any `*_API_KEY` placed in them. |

## What switching to a real provider affects

The steps, their order, batching (4 per call, 3 at a time), progress, revise with feedback, keeping
team edits, logs, versions, autosave, computed checks, the report merge and the Excel export are the
same code in both modes, and the portal needs no change. What changes:

| Area | Mock | Real provider (Gemini, Claude, …) |
|---|---|---|
| Who answers each step | `content/cadres.json`, chosen by cadre | The profile's models; research, roles, competencies and the review checklist use the complex tier at higher thinking (`models`, `thinking` in `config/ai-providers.json`) |
| Review checklist (rules r3 §6) | Nothing flagged except one "check this" accuracy flag per batch of 6, quoting a protocol/schedule/dose line; two "(verify)" state-fit items | Vidya answers Q1 scope, Q2 accuracy, Q3 state fit; code keeps only flags whose quote is in the file |
| Prompts | Ignored; the mock reads the structured input | Sent as written in `src/services/ai/prompts.ts` (spec section 3 rules, the brief, the edited research, team feedback) |
| "What should this FRAC cover?" | Picks postings named in it (`postingKeywords`) and puts matching roles and competencies first | Read by the model as part of the brief |
| Job research | Fixed sample sources | With `webSearch: true` in the profile, also searches government domains (`RESEARCH_SEARCH_DOMAINS`, spec 5.2): enforced by Claude's tool, asked for in the instructions on Gemini. The Gemini free tier has no search. |
| Time per step | About 1.5 s per call (`MOCK_DELAY_MS`) | Seconds to minutes; the progress bar shows each batch |
| Cost | Estimate at the `MOCK_PRICED_AS` prices, marked `est.` | Tokens × the profile's `rates`, recorded on every job (`usage` in `GET /v1/jobs/:id`); a free-tier profile marks it `est.` |
| Answer quality checks | Always valid | Each answer is validated against `src/services/ai/schemas.ts`; a bad shape fails the job with `AI_OUTPUT_INVALID` and the spend is still recorded |
| New errors a job can show | None | `AI_AUTH` (key rejected), `AI_BUSY` (rate limit), `AI_REFUSED`, `AI_OUTPUT_TRUNCATED`, `AI_REQUEST_REJECTED`, `AI_UNAVAILABLE` |
| Retries | Not needed | The SDK retries 408/429/5xx `LLM_RETRIES` times (Gemini waits 5 s, then longer, up to `LLM_MAX_RETRY_DELAY_MS`); on Claude a policy decline is re-run on the fallback model |
| Sample seed (`MOCK_SEED`) | Works (memory store) | Ignored |
| Network | None | Outbound HTTPS to the provider (`generativelanguage.googleapis.com`, `api.anthropic.com`) must be allowed from the container |

Settings that only matter with a real provider: the profile in `config/ai-providers.json`, and
`LLM_TIMEOUT_MS`, `LLM_RETRIES`, `LLM_MAX_TOKENS`, `LLM_MAX_RETRY_DELAY_MS`, `RESEARCH_WEB_SEARCH`,
`RESEARCH_SEARCH_DOMAINS`, `RESEARCH_SEARCH_MAX_USES`.
There is no temperature setting: the spec's 0.2–0.4 predates these models, which reject it.

### Testing the AI layer after adding the key

1. `npm run ai:check` (one tiny call per tier), then `npm run dev:ai` and check the log names the profile, e.g. `"ai":"gemini-free"`.
2. Run one compact FRAC through every step in the portal, then a revise with feedback on each step.
3. Run the expert check, then upload the exported Excel through Review a FRAC.
4. Check `usage` and cost on the jobs, and that no job failed with `AI_OUTPUT_INVALID`.
5. Copy the real GNM, ANM and Staff Nurse workbooks into `test/fixtures/` and run `npm test` (spec 6.6).

## Editing the sample data

`content/cadres.json` has one entry per cadre. A brief's cadre is matched against each entry's
`match` list (`"ANM"`, `"AUXILIARY NURSE MIDWIFE"`…); anything else uses `DEFAULT`. GNM, ASHA and
Staff Nurse reuse `DEFAULT`'s roles through `"base": "DEFAULT"` with their own name and postings.

- Research: `cadreFull`, `codePrefix`, `postings`, `summary`, `authorised`, `notAuthorised`,
  `stateContext`, `assumptions`, `verify`, `sources`, `sourceNotes`.
- Roles & activities: `roles[].title`, `roles[].source`, `roles[].activities[]` (observable actions).
- Competencies: `competencies[]` with `label`, `description`, `type` (Domain / Functional /
  Behavioural), `area`, `kcm`. Activities map to the competency sharing the most words.
- Ladders are generated from the competency label (Krathwohl's ladder for Behavioural ones).
- `postingKeywords`: words in "What should this FRAC cover?" that become posting columns (first 3,
  in the order written). Example: "Village outreach and delivery point PHC" gives
  "ANM in the village (community outreach)" and "ANM at delivery-point PHC".
- `{cadre}` and `{state}` are replaced from the brief.

How many roles, activities and competencies a FRAC gets follows the brief size (compact 7/5/18,
standard 12/6/32, full 17/7/50), capped by what the profile has. Restart the service after editing;
`npm test` checks the mock still produces a valid FRAC.

## Running with sample data preloaded

```bash
PORT=3010 npm run dev:mock:seed      # = AI_PROVIDER=mock FRAC_STUDIO_STORE=memory MOCK_SEED=true
```

`MOCK_SEED_OWNERS` must match the user id the portal sends (`x-aastrika-creator`): `local-dev-user`
with orgportal's local proxy rule, or the person's user id behind the uiproxy. A walkthrough:

1. **My FRACs**: the seeded "ANM — Bihar" FRAC (step 6, with its expert check) and a review of its export.
2. **Review a FRAC**: upload `test/fixtures/sample/sample-GNM-dictionary.xlsx` → report → Download review → Open in Create FRAC.
3. **Create FRAC**: cadre ANM, state Bihar, size Compact, and in "What should this FRAC cover?" type
   "Village outreach and delivery point PHC; immunisation and NCD screening" → Create.
4. Run each step from the sidebar button and watch the tracker; revise one with feedback; edit a role
   and re-derive competencies; run the expert check and "Fix these competencies"; download Excel.

## Removing the mocks

1. Delete this folder (`src/mocks`). No other file imports it; tests outside it use
   `test/support/stub-provider.ts`.
2. Optional tidy-up: remove `MOCK_DELAY_MS` and `MOCK_PRICED_AS` from `config/service.json`, `MOCK` plus the
   `MOCK_*` names from `src/config/constants.ts` and its check in `src/scripts/check-config.ts`, and the
   `dev:mock*` / `start:mock` scripts from `package.json`.

After that `AI_PROVIDER` must name a profile whose key is set; `AI_PROVIDER=mock` stops startup with
"AI_PROVIDER=mock but src/mocks is missing."
