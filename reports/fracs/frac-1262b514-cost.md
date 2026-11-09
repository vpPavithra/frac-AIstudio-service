# Cost of one FRAC, complete flow: ASHA · Karnataka · standard (12 roles, 72 activities, 32 competencies), 2026-11-09 17:12 to 2026-11-09 17:38

Generated 2026-11-09 17:49 IST by `npm run ai:report`. Times are IST. No prompt or answer text is stored or shown.

**Providers in this report:** claude only. Calls, jobs and reviews from other providers are left out.

## Summary

28 AI calls through claude: 100% answered in the expected shape, average 20.0 s per call, 217,343 tokens in and 74,105 out, $1.2057 in total. 10 jobs ran; 0 failed.

## Totals

| Total | Value |
| --- | --- |
| AI calls | 28 |
| Answered OK | 28 (100%) |
| Tokens in | 217,343 |
| Tokens out | 74,105 |
| of which thinking | 14,153 (19% of measured output) |
| Total tokens | 291,448 |
| Web searches | 3 |
| Total cost | $1.2057 |
| Billed (real spend) | $1.2057 |
| Estimated (mock or free tier, not billed) | $0.0000 |

## By day

| Day | Calls | Answered OK | Not OK | Avg time | Tokens in | Tokens out | Cost | Billed | Jobs | Providers |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-09 | 28 | 100% | 0 | 20.0 s | 217,343 | 74,105 | $1.2057 | $1.2057 | 10 (0 failed) | claude |

## By step: tokens and cost

| Step | Provider | Runs | Calls | Tokens in | Tokens out | Tokens in per run | Tokens out per run | Cost | Cost per run | Model time per run | Wall time per run | Thinking share | Web searches |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2 Research | claude | 1 | 1 | 26,499 | 11,132 | 26,499 | 11,132 | $0.1943 | $0.1943 | 94.5 s | 94.6 s | 38% | 3 |
| 3 Roles and activities | claude | 1 | 4 | 18,368 | 9,982 | 18,368 | 9,982 | $0.1366 | $0.1366 | 64.5 s | 28.2 s | 0% | 0 |
| 4 Competencies | claude | 1 | 1 | 6,962 | 9,826 | 6,962 | 9,826 | $0.1122 | $0.1122 | 59.7 s | 59.7 s | 48% | 0 |
| 5 Level ladders | claude | 4 | 11 | 69,458 | 34,362 | 17,365 | 8,591 | $0.4825 | $0.1206 | 63.3 s | 23.1 s | 0% | 0 |
| 6 Expert check | claude | 3 | 11 | 96,056 | 8,803 | 32,019 | 2,934 | $0.2801 | $0.0934 | 29.4 s | 17.7 s | 59% | 0 |

All steps: 217,343 tokens in, 74,105 out, $1.2057.
Model time per run adds up every call's time; calls run in parallel, so wall time (what the user waited, finished runs only) can be shorter. Thinking share is the part of the output the model spent thinking ("–" when not measured); a high share is where lower effort saves most.

## Per FRAC and review

| FRAC or review | Steps run | Calls | Tokens in | Tokens out | Cost | Calls not OK |
| --- | --- | --- | --- | --- | --- | --- |
| FRAC ASHA · Karnataka · standard | Research, Roles and activities, Competencies, Level ladders, Expert check | 28 | 217,343 | 74,105 | $1.2057 | 0 |

## Revisions

| Step | First runs | Later runs | Later runs per FRAC | Cost of first runs | Cost of later runs | Later runs' share of cost |
| --- | --- | --- | --- | --- | --- | --- |
| 2 Research | 1 | 0 | 0.00 | $0.1943 | $0.0000 | 0% |
| 3 Roles and activities | 1 | 0 | 0.00 | $0.1366 | $0.0000 | 0% |
| 4 Competencies | 1 | 0 | 0.00 | $0.1122 | $0.0000 | 0% |
| 5 Level ladders | 1 | 3 | 3.00 | $0.3606 | $0.1220 | 25% |
| 6 Expert check | 1 | 2 | 2.00 | $0.1598 | $0.1204 | 43% |

A later run is any run of the same step on the same FRAC after the first: a revise, a rewrite, "Fix these competencies", or a re-run after a failure.

## By user

| User | FRACs | Reviews | Jobs | Calls | Tokens in | Tokens out | Cost | Billed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `local-dev-user` | 1 | 0 | 10 | 28 | 217,343 | 74,105 | $1.2057 | $1.2057 |

## By provider and model

| Provider · model | Calls | Answered OK | Wrong shape | Errors | Avg time | p95 time | Avg tokens in | Avg tokens out | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| claude · claude-sonnet-5-5 | 28 | 100% | 0 | 0 | 20.0 s | 59.7 s | 7,762 | 2,647 | $1.2057 |

## By task

| Task | Calls | Answered OK | Wrong shape | Errors | Avg time | p95 time | Avg tokens in | Avg tokens out | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ladders | 11 | 100% | 0 | 0 | 23.0 s | 33.0 s | 6,314 | 3,124 | $0.4825 |
| review-competencies | 8 | 100% | 0 | 0 | 7.1 s | 8.9 s | 5,391 | 700 | $0.1422 |
| activities | 3 | 100% | 0 | 0 | 18.4 s | 18.9 s | 4,606 | 2,953 | $0.1162 |
| review-state | 3 | 100% | 0 | 0 | 10.4 s | 10.9 s | 17,642 | 1,068 | $0.1379 |
| research | 1 | 100% | 0 | 0 | 94.5 s | 94.5 s | 26,499 | 11,132 | $0.1943 |
| roles | 1 | 100% | 0 | 0 | 9.3 s | 9.3 s | 4,551 | 1,124 | $0.0203 |
| competencies | 1 | 100% | 0 | 0 | 59.7 s | 59.7 s | 6,962 | 9,826 | $0.1122 |

## Slowest 10 calls

| Time | Started | Task | Provider · model | Tokens out | Outcome |
| --- | --- | --- | --- | --- | --- |
| 94.5 s | 11-09 17:12:12 | research | claude · claude-sonnet-5-5 | 11,132 | ok |
| 59.7 s | 11-09 17:15:58 | competencies | claude · claude-sonnet-5-5 | 9,826 | ok |
| 33.0 s | 11-09 17:17:07 | ladders | claude · claude-sonnet-5-5 | 4,083 | ok |
| 27.3 s | 11-09 17:17:07 | ladders | claude · claude-sonnet-5-5 | 3,346 | ok |
| 26.5 s | 11-09 17:17:07 | ladders | claude · claude-sonnet-5-5 | 3,413 | ok |
| 26.4 s | 11-09 17:17:32 | ladders | claude · claude-sonnet-5-5 | 3,323 | ok |
| 26.3 s | 11-09 17:17:07 | ladders | claude · claude-sonnet-5-5 | 3,248 | ok |
| 25.4 s | 11-09 17:17:29 | ladders | claude · claude-sonnet-5-5 | 3,379 | ok |
| 25.2 s | 11-09 17:17:07 | ladders | claude · claude-sonnet-5-5 | 3,086 | ok |
| 22.5 s | 11-09 17:17:07 | ladders | claude · claude-sonnet-5-5 | 3,076 | ok |

## Calls that failed or came back in the wrong shape

No call failed or came back in the wrong shape.

## Jobs

| Job | Runs | Done | Failed (codes) | Avg time (done) | Avg AI calls | Avg cost |
| --- | --- | --- | --- | --- | --- | --- |
| research | 1 | 1 | 0 | 94.6 s | 1.0 | $0.1943 |
| roles | 1 | 1 | 0 | 28.2 s | 4.0 | $0.1366 |
| competencies | 1 | 1 | 0 | 59.7 s | 1.0 | $0.1122 |
| ladders | 4 | 4 | 0 | 23.1 s | 2.8 | $0.1206 |
| check | 3 | 3 | 0 | 17.7 s | 3.7 | $0.0934 |

## Review checklist: what the AI raised and what was kept

| Measure | Value |
| --- | --- |
| Reviews with checklist counts | 3 |
| Competencies sent to the checklist | 96 |
| of which reused a stored answer (unchanged) | 58 |
| Scope flags raised (Q1) | 0 |
| Accuracy flags raised (Q2) | 0 |
| Kept after the quote check | 0 (–) |
| Dropped: quote not in the file | 0 (–) |
| Dropped: a rule already covers it | 0 (–) |
| Dropped: duplicate of a scope rule hit | 0 (–) |
| State-fit items raised / kept (Q3) | 18 / 18 |

A high "quote not in the file" share means the model is describing problems the workbook does not contain;
the quote check removes those before they reach a finding.

## Findings in the reviews

| Found by | Blocker | Major | Minor |
| --- | --- | --- | --- |
| Rule-based check | 2 | 3 | 1 |
| AI judgement (quoted) | 0 | 0 | 3 |

Triage across 3 reviews: revise 1, use 2.

## Every call

Started is when the call was sent to the model; Time is the model's own time (a wait for a free slot is not counted).

| # | Started | Finished | Job | Job id | Task | Provider · model | Outcome | Time | Tokens in | Tokens out | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 17:12:12 | 17:13:47 | research | `1bf50fce` | research | claude · claude-sonnet-5-5 | ok | 94.5 s | 26,499 | 11,132 | $0.1943 |
| 2 | 17:14:20 | 17:14:30 | roles | `b3994ae4` | roles | claude · claude-sonnet-5-5 | ok | 9.3 s | 4,551 | 1,124 | $0.0203 |
| 3 | 17:14:30 | 17:14:48 | roles | `b3994ae4` | activities | claude · claude-sonnet-5-5 | ok | 18.1 s | 4,571 | 2,931 | $0.0385 |
| 4 | 17:14:30 | 17:14:49 | roles | `b3994ae4` | activities | claude · claude-sonnet-5-5 | ok | 18.9 s | 4,622 | 2,956 | $0.0388 |
| 5 | 17:14:30 | 17:14:48 | roles | `b3994ae4` | activities | claude · claude-sonnet-5-5 | ok | 18.3 s | 4,624 | 2,971 | $0.0390 |
| 6 | 17:15:58 | 17:16:58 | competencies | `e9377e16` | competencies | claude · claude-sonnet-5-5 | ok | 59.7 s | 6,962 | 9,826 | $0.1122 |
| 7 | 17:17:07 | 17:17:32 | ladders | `d82ac5dd` | ladders | claude · claude-sonnet-5-5 | ok | 25.2 s | 5,578 | 3,086 | $0.0420 |
| 8 | 17:17:07 | 17:17:33 | ladders | `d82ac5dd` | ladders | claude · claude-sonnet-5-5 | ok | 26.3 s | 5,747 | 3,248 | $0.0440 |
| 9 | 17:17:07 | 17:17:34 | ladders | `d82ac5dd` | ladders | claude · claude-sonnet-5-5 | ok | 27.3 s | 5,773 | 3,346 | $0.0450 |
| 10 | 17:17:07 | 17:17:40 | ladders | `d82ac5dd` | ladders | claude · claude-sonnet-5-5 | ok | 33.0 s | 5,881 | 4,083 | $0.0526 |
| 11 | 17:17:07 | 17:17:33 | ladders | `d82ac5dd` | ladders | claude · claude-sonnet-5-5 | ok | 26.5 s | 5,685 | 3,413 | $0.0455 |
| 12 | 17:17:07 | 17:17:29 | ladders | `d82ac5dd` | ladders | claude · claude-sonnet-5-5 | ok | 22.5 s | 5,743 | 3,076 | $0.0422 |
| 13 | 17:17:29 | 17:17:55 | ladders | `d82ac5dd` | ladders | claude · claude-sonnet-5-5 | ok | 25.4 s | 5,676 | 3,379 | $0.0451 |
| 14 | 17:17:32 | 17:17:58 | ladders | `d82ac5dd` | ladders | claude · claude-sonnet-5-5 | ok | 26.4 s | 5,429 | 3,323 | $0.0441 |
| 15 | 17:18:01 | 17:18:10 | check | `215dabf9` | review-competencies | claude · claude-sonnet-5-5 | ok | 8.9 s | 6,038 | 987 | $0.0219 |
| 16 | 17:18:01 | 17:18:08 | check | `215dabf9` | review-competencies | claude · claude-sonnet-5-5 | ok | 7.3 s | 6,570 | 703 | $0.0202 |
| 17 | 17:18:01 | 17:18:09 | check | `215dabf9` | review-competencies | claude · claude-sonnet-5-5 | ok | 8.1 s | 7,295 | 797 | $0.0226 |
| 18 | 17:18:01 | 17:18:07 | check | `215dabf9` | review-competencies | claude · claude-sonnet-5-5 | ok | 5.7 s | 3,079 | 490 | $0.0111 |
| 19 | 17:18:01 | 17:18:08 | check | `215dabf9` | review-competencies | claude · claude-sonnet-5-5 | ok | 7.1 s | 6,288 | 622 | $0.0188 |
| 20 | 17:18:01 | 17:18:08 | check | `215dabf9` | review-competencies | claude · claude-sonnet-5-5 | ok | 7.2 s | 6,080 | 730 | $0.0195 |
| 21 | 17:18:10 | 17:18:21 | check | `215dabf9` | review-state | claude · claude-sonnet-5-5 | ok | 10.9 s | 17,644 | 1,049 | $0.0458 |
| 22 | 17:24:55 | 17:25:12 | ladders | `c80022f3` | ladders | claude · claude-sonnet-5-5 | ok | 17.2 s | 8,932 | 3,259 | $0.0505 |
| 23 | 17:37:01 | 17:37:18 | ladders | `d7ce86ec` | ladders | claude · claude-sonnet-5-5 | ok | 16.8 s | 8,846 | 3,259 | $0.0503 |
| 24 | 17:37:24 | 17:37:31 | check | `4da1ea32` | review-competencies | claude · claude-sonnet-5-5 | ok | 7.5 s | 5,559 | 792 | $0.0190 |
| 25 | 17:37:31 | 17:37:42 | check | `4da1ea32` | review-state | claude · claude-sonnet-5-5 | ok | 10.3 s | 17,639 | 1,071 | $0.0460 |
| 26 | 17:37:50 | 17:37:57 | ladders | `e59c2fc7` | ladders | claude · claude-sonnet-5-5 | ok | 6.6 s | 6,168 | 890 | $0.0212 |
| 27 | 17:38:07 | 17:38:12 | check | `279490e9` | review-competencies | claude · claude-sonnet-5-5 | ok | 5.1 s | 2,220 | 478 | $0.0092 |
| 28 | 17:38:12 | 17:38:22 | check | `279490e9` | review-state | claude · claude-sonnet-5-5 | ok | 10.1 s | 17,644 | 1,084 | $0.0461 |
