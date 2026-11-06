# Cost of one FRAC, complete flow: Staff Nurse · Karnataka · standard (12 roles, 72 activities, 32 competencies), 2026-11-06 18:30 to 2026-11-06 18:36

Generated 2026-11-06 18:39 IST by `npm run ai:report`. Times are IST. No prompt or answer text is stored or shown.

**Providers in this report:** claude only. Calls, jobs and reviews from other providers are left out.

## Summary

21 AI calls through claude: 100% answered in the expected shape, average 20.6 s per call, 134,179 tokens in and 56,589 out, $0.8642 in total. 5 jobs ran; 0 failed.

## Totals

| Total | Value |
| --- | --- |
| AI calls | 21 |
| Answered OK | 21 (100%) |
| Tokens in | 134,179 |
| Tokens out | 56,589 |
| of which thinking | 10,433 (18% of measured output) |
| Total tokens | 190,768 |
| Web searches | 3 |
| Total cost | $0.8642 |
| Billed (real spend) | $0.8642 |
| Estimated (mock or free tier, not billed) | $0.0000 |

## By day

| Day | Calls | Answered OK | Not OK | Avg time | Tokens in | Tokens out | Cost | Billed | Jobs | Providers |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-06 | 21 | 100% | 0 | 20.6 s | 134,179 | 56,589 | $0.8642 | $0.8642 | 5 (0 failed) | claude |

## By step: tokens and cost

| Step | Provider | Runs | Calls | Tokens in | Tokens out | Tokens in per run | Tokens out per run | Cost | Cost per run | Model time per run | Wall time per run | Thinking share | Web searches |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2 Research | claude | 1 | 1 | 17,159 | 9,525 | 17,159 | 9,525 | $0.1596 | $0.1596 | 83.6 s | 83.6 s | 32% | 3 |
| 3 Roles and activities | claude | 1 | 4 | 17,513 | 9,786 | 17,513 | 9,786 | $0.1329 | $0.1329 | 70.4 s | 33.5 s | 0% | 0 |
| 4 Competencies | claude | 1 | 1 | 6,808 | 9,447 | 6,808 | 9,447 | $0.1081 | $0.1081 | 53.8 s | 53.8 s | 47% | 0 |
| 5 Level ladders | claude | 1 | 8 | 43,524 | 23,413 | 43,524 | 23,413 | $0.3212 | $0.3212 | 175.4 s | 38.6 s | 0% | 0 |
| 6 Expert check | claude | 1 | 7 | 49,175 | 4,418 | 49,175 | 4,418 | $0.1425 | $0.1425 | 48.8 s | 19.3 s | 66% | 0 |

All steps: 134,179 tokens in, 56,589 out, $0.8642.
Model time per run adds up every call's time; calls run in parallel, so wall time (what the user waited, finished runs only) can be shorter. Thinking share is the part of the output the model spent thinking ("–" when not measured); a high share is where lower effort saves most.

## Per FRAC and review

| FRAC or review | Steps run | Calls | Tokens in | Tokens out | Cost | Calls not OK |
| --- | --- | --- | --- | --- | --- | --- |
| FRAC Staff Nurse · Karnataka · standard | Research, Roles and activities, Competencies, Level ladders, Expert check | 21 | 134,179 | 56,589 | $0.8642 | 0 |

## Revisions

| Step | First runs | Later runs | Later runs per FRAC | Cost of first runs | Cost of later runs | Later runs' share of cost |
| --- | --- | --- | --- | --- | --- | --- |
| 2 Research | 1 | 0 | 0.00 | $0.1596 | $0.0000 | 0% |
| 3 Roles and activities | 1 | 0 | 0.00 | $0.1329 | $0.0000 | 0% |
| 4 Competencies | 1 | 0 | 0.00 | $0.1081 | $0.0000 | 0% |
| 5 Level ladders | 1 | 0 | 0.00 | $0.3212 | $0.0000 | 0% |
| 6 Expert check | 1 | 0 | 0.00 | $0.1425 | $0.0000 | 0% |

A later run is any run of the same step on the same FRAC after the first: a revise, a rewrite, "Fix these competencies", or a re-run after a failure.

## By user

| User | FRACs | Reviews | Jobs | Calls | Tokens in | Tokens out | Cost | Billed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `local-dev-user` | 1 | 0 | 5 | 21 | 134,179 | 56,589 | $0.8642 | $0.8642 |

## By provider and model

| Provider · model | Calls | Answered OK | Wrong shape | Errors | Avg time | p95 time | Avg tokens in | Avg tokens out | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| claude · claude-sonnet-5-5 | 21 | 100% | 0 | 0 | 20.6 s | 53.8 s | 6,389 | 2,695 | $0.8642 |

## By task

| Task | Calls | Answered OK | Wrong shape | Errors | Avg time | p95 time | Avg tokens in | Avg tokens out | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ladders | 8 | 100% | 0 | 0 | 21.9 s | 32.4 s | 5,441 | 2,927 | $0.3212 |
| review-competencies | 6 | 100% | 0 | 0 | 6.7 s | 10.4 s | 5,281 | 592 | $0.0989 |
| activities | 3 | 100% | 0 | 0 | 20.9 s | 25.9 s | 4,330 | 2,916 | $0.1135 |
| research | 1 | 100% | 0 | 0 | 83.6 s | 83.6 s | 17,159 | 9,525 | $0.1596 |
| roles | 1 | 100% | 0 | 0 | 7.6 s | 7.6 s | 4,522 | 1,039 | $0.0194 |
| competencies | 1 | 100% | 0 | 0 | 53.8 s | 53.8 s | 6,808 | 9,447 | $0.1081 |
| review-state | 1 | 100% | 0 | 0 | 8.8 s | 8.8 s | 17,490 | 868 | $0.0437 |

## Slowest 10 calls

| Time | Started | Task | Provider · model | Tokens out | Outcome |
| --- | --- | --- | --- | --- | --- |
| 83.6 s | 11-06 18:30:55 | research | claude · claude-sonnet-5-5 | 9,525 | ok |
| 53.8 s | 11-06 18:34:42 | competencies | claude · claude-sonnet-5-5 | 9,447 | ok |
| 32.4 s | 11-06 18:35:49 | ladders | claude · claude-sonnet-5-5 | 4,338 | ok |
| 25.9 s | 11-06 18:32:58 | activities | claude · claude-sonnet-5-5 | 2,896 | ok |
| 24.0 s | 11-06 18:35:49 | ladders | claude · claude-sonnet-5-5 | 3,287 | ok |
| 22.6 s | 11-06 18:35:49 | ladders | claude · claude-sonnet-5-5 | 2,967 | ok |
| 21.8 s | 11-06 18:35:49 | ladders | claude · claude-sonnet-5-5 | 2,889 | ok |
| 20.7 s | 11-06 18:35:49 | ladders | claude · claude-sonnet-5-5 | 2,897 | ok |
| 20.5 s | 11-06 18:32:58 | activities | claude · claude-sonnet-5-5 | 3,118 | ok |
| 18.7 s | 11-06 18:36:07 | ladders | claude · claude-sonnet-5-5 | 2,458 | ok |

## Calls that failed or came back in the wrong shape

No call failed or came back in the wrong shape.

## Jobs

| Job | Runs | Done | Failed (codes) | Avg time (done) | Avg AI calls | Avg cost |
| --- | --- | --- | --- | --- | --- | --- |
| research | 1 | 1 | 0 | 83.6 s | 1.0 | $0.1596 |
| roles | 1 | 1 | 0 | 33.5 s | 4.0 | $0.1328 |
| competencies | 1 | 1 | 0 | 53.8 s | 1.0 | $0.1081 |
| ladders | 1 | 1 | 0 | 38.6 s | 8.0 | $0.3210 |
| check | 1 | 1 | 0 | 19.3 s | 7.0 | $0.1426 |

## Review checklist: what the AI raised and what was kept

| Measure | Value |
| --- | --- |
| Reviews with checklist counts | 1 |
| Competencies sent to the checklist | 32 |
| Scope flags raised (Q1) | 0 |
| Accuracy flags raised (Q2) | 0 |
| Kept after the quote check | 0 (–) |
| Dropped: quote not in the file | 0 (–) |
| Dropped: a rule already covers it | 0 (–) |
| Dropped: duplicate of a scope rule hit | 0 (–) |
| State-fit items raised / kept (Q3) | 6 / 6 |

A high "quote not in the file" share means the model is describing problems the workbook does not contain;
the quote check removes those before they reach a finding.

## Findings in the reviews

| Found by | Blocker | Major | Minor |
| --- | --- | --- | --- |
| Rule-based check | 0 | 2 | 0 |
| AI judgement (quoted) | 0 | 0 | 1 |

Triage across 1 reviews: use 1.

## Every call

Started is when the call was sent to the model; Time is the model's own time (a wait for a free slot is not counted).

| # | Started | Finished | Job | Job id | Task | Provider · model | Outcome | Time | Tokens in | Tokens out | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 18:30:55 | 18:32:18 | research | `4836b116` | research | claude · claude-sonnet-5-5 | ok | 83.6 s | 17,159 | 9,525 | $0.1596 |
| 2 | 18:32:51 | 18:32:58 | roles | `56b4b7e8` | roles | claude · claude-sonnet-5-5 | ok | 7.6 s | 4,522 | 1,039 | $0.0194 |
| 3 | 18:32:58 | 18:33:15 | roles | `56b4b7e8` | activities | claude · claude-sonnet-5-5 | ok | 16.4 s | 4,307 | 2,733 | $0.0359 |
| 4 | 18:32:58 | 18:33:19 | roles | `56b4b7e8` | activities | claude · claude-sonnet-5-5 | ok | 20.5 s | 4,330 | 3,118 | $0.0398 |
| 5 | 18:32:58 | 18:33:24 | roles | `56b4b7e8` | activities | claude · claude-sonnet-5-5 | ok | 25.9 s | 4,354 | 2,896 | $0.0377 |
| 6 | 18:34:42 | 18:35:36 | competencies | `4f71dbc6` | competencies | claude · claude-sonnet-5-5 | ok | 53.8 s | 6,808 | 9,447 | $0.1081 |
| 7 | 18:35:49 | 18:36:07 | ladders | `b1e431fb` | ladders | claude · claude-sonnet-5-5 | ok | 17.3 s | 5,280 | 2,226 | $0.0328 |
| 8 | 18:35:49 | 18:36:22 | ladders | `b1e431fb` | ladders | claude · claude-sonnet-5-5 | ok | 32.4 s | 5,333 | 4,338 | $0.0540 |
| 9 | 18:35:49 | 18:36:10 | ladders | `b1e431fb` | ladders | claude · claude-sonnet-5-5 | ok | 20.7 s | 5,562 | 2,897 | $0.0401 |
| 10 | 18:35:49 | 18:36:13 | ladders | `b1e431fb` | ladders | claude · claude-sonnet-5-5 | ok | 24.0 s | 5,378 | 3,287 | $0.0436 |
| 11 | 18:35:49 | 18:36:12 | ladders | `b1e431fb` | ladders | claude · claude-sonnet-5-5 | ok | 22.6 s | 5,579 | 2,967 | $0.0408 |
| 12 | 18:35:49 | 18:36:11 | ladders | `b1e431fb` | ladders | claude · claude-sonnet-5-5 | ok | 21.8 s | 5,670 | 2,889 | $0.0402 |
| 13 | 18:36:07 | 18:36:25 | ladders | `b1e431fb` | ladders | claude · claude-sonnet-5-5 | ok | 18.7 s | 5,524 | 2,458 | $0.0356 |
| 14 | 18:36:10 | 18:36:28 | ladders | `b1e431fb` | ladders | claude · claude-sonnet-5-5 | ok | 17.8 s | 5,198 | 2,351 | $0.0339 |
| 15 | 18:36:32 | 18:36:39 | check | `313cc7fa` | review-competencies | claude · claude-sonnet-5-5 | ok | 6.4 s | 6,462 | 706 | $0.0200 |
| 16 | 18:36:32 | 18:36:40 | check | `313cc7fa` | review-competencies | claude · claude-sonnet-5-5 | ok | 7.3 s | 5,768 | 617 | $0.0177 |
| 17 | 18:36:32 | 18:36:40 | check | `313cc7fa` | review-competencies | claude · claude-sonnet-5-5 | ok | 7.4 s | 5,764 | 562 | $0.0171 |
| 18 | 18:36:32 | 18:36:43 | check | `313cc7fa` | review-competencies | claude · claude-sonnet-5-5 | ok | 10.4 s | 6,229 | 1,311 | $0.0256 |
| 19 | 18:36:32 | 18:36:36 | check | `313cc7fa` | review-competencies | claude · claude-sonnet-5-5 | ok | 3.7 s | 2,506 | 55 | $0.0056 |
| 20 | 18:36:32 | 18:36:37 | check | `313cc7fa` | review-competencies | claude · claude-sonnet-5-5 | ok | 4.7 s | 4,956 | 299 | $0.0129 |
| 21 | 18:36:43 | 18:36:51 | check | `313cc7fa` | review-state | claude · claude-sonnet-5-5 | ok | 8.8 s | 17,490 | 868 | $0.0437 |
