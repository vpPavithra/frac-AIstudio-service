# src/mocks: sample-data AI provider

Everything mock-related lives in this folder. When no `ANTHROPIC_API_KEY` is set, the AI steps
(job research, roles & activities, competencies, level ladders, Vidya's review checklist) get their
answers from here instead of Claude. Nothing else in the service knows the mock exists: the provider
registry (`src/providers/registry.ts`) imports `index.ts` at runtime only when it is needed.

**This is sample data, not clinical guidance and not a reference FRAC.**

| File | What it is |
|---|---|
| `content/cadres.json` | The sample data you edit: one profile per cadre, plus the posting keywords |
| `mock-text-provider.ts` | Turns that data into answers in exactly the shape Claude must return |
| `seed.ts` | Optional: one finished FRAC and one review per owner at startup (`MOCK_SEED=true`, memory store) |
| `index.ts` | Entry point the registry loads |
| `mock-flow.test.ts` | Runs the whole flow on the mock and checks the spec rules each step must hold |

## How the switch works

```
AI_PROVIDER (config/service.json, default "auto")
  auto   → ANTHROPIC_API_KEY set?  yes → Claude (src/providers/text/claude.ts)
                                   no  → this folder (if it exists), else startup stops with a clear message
  claude → Claude; startup stops if the key is missing
  mock   → this folder, even if a key is set
```

Startup logs `"ai":"claude"` or `"ai":"mock"`, and `GET /v1/info` returns `{"aiProvider": …}`.

## Where the token goes

| Where | How |
|---|---|
| Your machine | `ANTHROPIC_API_KEY=…` in the service's `.env` (gitignored; copy `.env.example`). Restart the service. |
| A server | The deployment's secret store (Kubernetes secret / Jenkins credential), exposed to the container as the `ANTHROPIC_API_KEY` environment variable. Redeploy or restart. |
| Never | `config/service.json`. It is committed, and startup refuses any secret placed in it. |

## What adding the token affects

The steps, their order, batching (4 per call, 3 at a time), progress, revise with feedback, keeping
team edits, logs, versions, autosave, computed checks, the report merge and the Excel export are the
same code in both modes, and the portal needs no change. What changes:

| Area | Mock (no key) | Claude (key set) |
|---|---|---|
| Who answers each step | `content/cadres.json`, chosen by cadre | Claude Sonnet 5.5 for every step; research, roles, competencies and the review checklist run at higher effort (`ANTHROPIC_*_MODEL`, `LLM_*_EFFORT`) |
| Review checklist (rules r3 §6) | Nothing flagged except one "check this" accuracy flag per batch of 6, quoting a protocol/schedule/dose line; two "(verify)" state-fit items | Vidya answers Q1 scope, Q2 accuracy, Q3 state fit; code keeps only flags whose quote is in the file |
| Prompts | Ignored; the mock reads the structured input | Sent as written in `src/services/ai/prompts.ts` (spec section 3 rules, the brief, the edited research, team feedback) |
| "What should this FRAC cover?" | Picks postings named in it (`postingKeywords`) and puts matching roles and competencies first | Read by the model as part of the brief |
| Job research | Fixed sample sources | Also searches the web on government domains only (`RESEARCH_SEARCH_DOMAINS`, spec 5.2); cites only what it retrieved |
| Time per step | About 1.5 s per call (`MOCK_DELAY_MS`) | Seconds to minutes; the progress bar shows each batch |
| Cost | 0 | Tokens × `RATE_*_USD_PER_1M`, recorded on every job (`usage` in `GET /v1/jobs/:id`) |
| Answer quality checks | Always valid | Each answer is validated against `src/services/ai/schemas.ts`; a bad shape fails the job with `AI_OUTPUT_INVALID` and the spend is still recorded |
| New errors a job can show | None | `AI_AUTH` (key rejected), `AI_BUSY` (rate limit), `AI_REFUSED`, `AI_OUTPUT_TRUNCATED`, `AI_REQUEST_REJECTED`, `AI_UNAVAILABLE` |
| Retries | Not needed | The SDK retries 408/409/429/5xx `LLM_RETRIES` times; a policy decline is re-run on the server's fallback model |
| Sample seed (`MOCK_SEED`) | Works (memory store) | Ignored |
| Network | None | Outbound HTTPS to `api.anthropic.com` must be allowed from the container |

Settings that only matter with Claude: `ANTHROPIC_COMPLEX_MODEL`, `ANTHROPIC_DEFAULT_MODEL`,
`LLM_COMPLEX_EFFORT` (high), `LLM_DEFAULT_EFFORT` (medium), `LLM_TIMEOUT_MS`, `LLM_RETRIES`,
`RESEARCH_WEB_SEARCH`, `RESEARCH_SEARCH_DOMAINS`, `RESEARCH_SEARCH_MAX_USES`, `RATE_*_USD_PER_1M`.
There is no temperature setting: the spec's 0.2–0.4 predates these models, which reject it.

### Testing the AI layer after adding the key

1. Start the service and check the log says `"ai":"claude"`.
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
FRAC_STUDIO_STORE=memory MOCK_SEED=true MOCK_SEED_OWNERS=local-dev-user PORT=3010 npm run dev
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
2. Optional tidy-up: remove `MOCK_DELAY_MS` from `config/service.json`, and `MOCK` plus the three
   `MOCK_*` names from `src/config/constants.ts`.

After that the service needs `ANTHROPIC_API_KEY` to start; without it, startup stops with
"No AI provider: set ANTHROPIC_API_KEY in the environment, or restore src/mocks for sample data."
