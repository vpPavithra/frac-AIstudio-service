import type { AiCall } from "../../src/models/ai-call.model.ts";
import type { Job } from "../../src/models/job.model.ts";
import type { Report } from "../../src/models/report.model.ts";
import type { ReviewRecord } from "../../src/models/review.model.ts";
import { buildAiReport } from "./ai-report.ts";

const call = (over: Partial<AiCall>): AiCall => ({
  jobId: "j1",
  jobKind: "roles",
  provider: "claude-mixed",
  model: "claude-haiku-5-5",
  task: "roles",
  tier: "complex",
  outcome: "ok",
  latencyMs: 2000,
  inputTokens: 1000,
  outputTokens: 400,
  cacheReadTokens: 0,
  thinkingTokens: 300,
  webSearches: 0,
  costUsd: 0.002,
  estimated: true,
  startedAt: "2026-11-06T09:59:58.000Z",
  createdAt: "2026-11-06T10:00:00.000Z",
  ...over,
});

const job = (over: Partial<Job>): Job => ({
  id: "j1",
  ownerId: "u1",
  kind: "roles",
  targetId: null,
  status: "done",
  msg: "",
  done: 1,
  total: 1,
  error: null,
  errorCode: null,
  usage: { calls: 2, costUsd: 0.004, estimated: 1 },
  createdAt: "2026-11-06T10:00:00.000Z",
  updatedAt: "2026-11-06T10:00:30.000Z",
  ...over,
});

const report = {
  triage: "revise",
  findings: [
    { check: "context", sev: "B", title: "x", detail: "", refs: [], fix: "", source: "computed" },
    { check: "context", sev: "M", title: "y", detail: "", refs: [], fix: "", source: "agent" },
  ],
  aiChecklist: {
    competenciesAsked: 12,
    scopeRaised: 6,
    accuracyRaised: 4,
    kept: 5,
    droppedQuoteNotFound: 3,
    droppedCoveredByRule: 1,
    droppedDuplicateScope: 1,
    stateRaised: 4,
    stateKept: 3,
  },
} as unknown as Report;

const review = { id: "r1", kind: "upload", createdAt: "2026-11-06T11:00:00.000Z", report } as unknown as ReviewRecord;

const period = { from: new Date("2026-11-01T00:00:00Z"), to: new Date("2026-11-06T12:00:00Z"), generatedAt: new Date("2026-11-06T12:00:00Z") };

describe("AI response report", () => {
  it("summarises calls by provider and task, failures, jobs, the checklist and findings", () => {
    const md = buildAiReport({
      ...period,
      calls: [call({}), call({ task: "activities", tier: "default", latencyMs: 4000 }), call({ outcome: "AI_BUSY", model: "", inputTokens: 0, outputTokens: 0, costUsd: 0 }), call({ outcome: "invalid" })],
      jobs: [job({}), job({ id: "j2", status: "error", errorCode: "AI_BUSY" })],
      reviews: [review],
    });
    expect(md).toContain("# AI response report, 2026-11-01 to 2026-11-06");
    expect(md).toContain("4 AI calls through claude-mixed: 50% answered in the expected shape");
    expect(md).toContain("2 jobs ran; 1 failed.");
    expect(md).toContain("Costs marked est. are estimates");
    expect(md).toMatch(/\| claude-mixed · claude-haiku-5-5 \| 3 \| 67% \| 1 \| 0 \|/);
    expect(md).toMatch(/\| claude-mixed · \(no answer\) \| 1 \| 0% \| 0 \| 1 \|/);
    expect(md).toMatch(/\| `AI_BUSY` \| 1 \| roles \| Rate limit or quota used up \|/);
    expect(md).toMatch(/\| roles \| 2 \| 1 \| 1 \(AI_BUSY ×1\) \| 30\.0 s \|/);
    expect(md).toContain("| Kept after the quote check | 5 (50%) |");
    expect(md).toContain("| Dropped: quote not in the file | 3 (30%) |");
    expect(md).toContain("| AI judgement (quoted) | 0 | 1 | 0 |");
    expect(md).toContain("Triage across 1 reviews: revise 1.");
    expect(md).toContain("| Total tokens | 4,200 |");
    expect(md).toContain("| Billed (real spend) | $0.0000 |");
    expect(md).toContain("| Estimated (mock or free tier, not billed) | $0.0060 |");
    expect(md).toMatch(/\| of which thinking \| 1,200 \(100% of measured output\) \|/);
  });

  it("totals tokens and cost per step and per FRAC, lists the slowest calls, and (daily) every call in IST", () => {
    const md = buildAiReport({
      ...period,
      to: new Date("2026-11-07T00:00:00Z"),
      utcOffsetMinutes: 330,
      listCalls: true,
      title: "Daily AI report, 2026-11-06",
      targets: { f1: "FRAC ANM · Bihar · standard" },
      calls: [
        call({ jobId: "j1", jobKind: "roles", costUsd: 0.01, latencyMs: 3000 }),
        call({ jobId: "j1", jobKind: "roles", task: "activities", costUsd: 0.02, latencyMs: 9000 }),
        call({ jobId: "j2", jobKind: "ladders", task: "ladders", outcome: "invalid", costUsd: 0.04, latencyMs: 20000, startedAt: "2026-11-06T10:05:00.000Z" }),
      ],
      jobs: [job({ id: "j1", targetId: "f1" }), job({ id: "j2", kind: "ladders", targetId: "f1" })],
      reviews: [],
    });
    expect(md).toContain("# Daily AI report, 2026-11-06");
    expect(md).toContain("Times are IST.");
    expect(md).toMatch(/\| 3 Roles and activities \| claude-mixed \| 1 \| 2 \| 2,000 \| 800 \| 2,000 \| 800 \| est\. \$0\.0300 \| est\. \$0\.0300 \| 12\.0 s \| 30\.0 s \| 75% \| 0 \|/);
    expect(md).toMatch(/\| 5 Level ladders \| claude-mixed \| 1 \| 1 \|/);
    expect(md).toMatch(/\| FRAC ANM · Bihar · standard \| Roles and activities, Level ladders \| 3 \| 3,000 \| 1,200 \| est\. \$0\.0700 \| 1 \|/);
    expect(md).toMatch(/## Slowest 10 calls[\s\S]*\| 20\.0 s \| 11-06 15:35:00 \| ladders \|/);
    expect(md).toMatch(/\| 2026-11-06 \| 3 \| 67% \| 1 \|/);
    // Every call, in start order, times on the IST clock (UTC 09:59:58 → 15:29:58)
    expect(md).toMatch(/## Every call[\s\S]*\| 1 \| 15:29:58 \| 15:30:00 \| roles \| `j1` \| roles \|/);
    expect(md).toMatch(/\| 3 \| 15:35:00 \| 15:30:00 \| ladders \| `j2` \| ladders \| claude-mixed · claude-haiku-5-5 \| \*\*invalid\*\* \|/);
  });

  it("shows cost per user, what revisions added, and warns when a day's billed spend passes the budget", () => {
    const billedCall = (over: Partial<AiCall>) => call({ estimated: false, provider: "claude", model: "claude-sonnet-5-5", ...over });
    const md = buildAiReport({
      ...period,
      dailyBudgetUsd: 1,
      calls: [
        billedCall({ jobId: "j1", jobKind: "ladders", costUsd: 0.6 }),
        billedCall({ jobId: "j2", jobKind: "ladders", costUsd: 0.2 }), // a rewrite of the same FRAC's ladders
        billedCall({ jobId: "j3", jobKind: "review", costUsd: 0.3 }),
      ],
      jobs: [
        job({ id: "j1", kind: "ladders", targetId: "f1", ownerId: "u-asha", createdAt: "2026-11-06T09:00:00.000Z" }),
        job({ id: "j2", kind: "ladders", targetId: "f1", ownerId: "u-asha", createdAt: "2026-11-06T09:30:00.000Z" }),
        job({ id: "j3", kind: "review", targetId: "r1", ownerId: "u-ravi" }),
      ],
      reviews: [],
    });
    expect(md).toContain("**Over the daily budget of $1.00:** 2026-11-06 billed $1.10.");
    expect(md).toMatch(/\| 5 Level ladders \| 1 \| 1 \| 1\.00 \| \$0\.6000 \| \$0\.2000 \| 25% \|/);
    expect(md).toMatch(/\| `u-asha` \| 1 \| 0 \| 2 \| 2 \| 2,000 \| 800 \| \$0\.8000 \| \$0\.8000 \|/);
    expect(md).toMatch(/\| `u-ravi` \| 0 \| 1 \| 1 \| 1 \|/);
  });

  it("compares the day with the day before", () => {
    const md = buildAiReport({
      ...period,
      calls: [call({ costUsd: 0.3, estimated: false }), call({ costUsd: 0.1, estimated: false, outcome: "AI_BUSY" })],
      jobs: [],
      reviews: [],
      previous: { label: "2026-11-05", calls: [call({ costUsd: 0.2, estimated: false })], jobs: [] },
    });
    expect(md).toContain("## Compared with 2026-11-05");
    expect(md).toContain("| AI calls | 1 | 2 | +1 (+100%) |");
    expect(md).toContain("| Answered OK | 100% | 50% | −50 pts |");
    expect(md).toContain("| Billed | $0.2000 | $0.4000 | +$0.2000 (+100%) |");
    expect(md).toContain("| Failed jobs | 0 | 0 | no change |");
  });

  it("does not warn on estimates, however high", () => {
    const md = buildAiReport({ ...period, dailyBudgetUsd: 0.001, calls: [call({ costUsd: 5 })], jobs: [], reviews: [] });
    expect(md).not.toContain("Over the daily budget");
  });

  it("says plainly when nothing was recorded", () => {
    const md = buildAiReport({ ...period, calls: [], jobs: [], reviews: [] });
    expect(md).toContain("No AI calls were recorded in this period.");
    expect(md).toContain("No review in this period recorded checklist counts.");
  });
});
