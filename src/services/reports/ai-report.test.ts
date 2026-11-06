import type { AiCall } from "../../models/ai-call.model.ts";
import type { Job } from "../../models/job.model.ts";
import type { Report } from "../../models/report.model.ts";
import type { ReviewRecord } from "../../models/review.model.ts";
import { buildAiReport } from "./ai-report.ts";

const call = (over: Partial<AiCall>): AiCall => ({
  jobId: "j1",
  jobKind: "roles",
  provider: "gemini-free",
  model: "gemini-3.8-flash",
  task: "roles",
  tier: "complex",
  outcome: "ok",
  latencyMs: 2000,
  inputTokens: 1000,
  outputTokens: 400,
  cacheReadTokens: 0,
  webSearches: 0,
  costUsd: 0.002,
  estimated: true,
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

const period = { from: new Date("2026-11-01T00:00:00Z"), to: new Date("2026-11-06T00:00:00Z"), generatedAt: new Date("2026-11-06T12:00:00Z") };

describe("AI response report", () => {
  it("summarises calls by provider and task, failures, jobs, the checklist and findings", () => {
    const md = buildAiReport({
      ...period,
      calls: [call({}), call({ task: "activities", tier: "default", latencyMs: 4000 }), call({ outcome: "AI_BUSY", model: "", inputTokens: 0, outputTokens: 0, costUsd: 0 }), call({ outcome: "invalid" })],
      jobs: [job({}), job({ id: "j2", status: "error", errorCode: "AI_BUSY" })],
      reviews: [review],
    });
    expect(md).toContain("# AI response report, 2026-11-01 to 2026-11-06");
    expect(md).toContain("4 AI calls through gemini-free: 50% answered in the expected shape");
    expect(md).toContain("2 jobs ran; 1 failed.");
    expect(md).toContain("Costs marked est. are estimates");
    expect(md).toMatch(/\| gemini-free · gemini-3\.8-flash \| 3 \| 67% \| 1 \| 0 \|/);
    expect(md).toMatch(/\| gemini-free · \(no answer\) \| 1 \| 0% \| 0 \| 1 \|/);
    expect(md).toMatch(/\| `AI_BUSY` \| 1 \| roles \| Rate limit or quota used up \|/);
    expect(md).toMatch(/\| roles \| 2 \| 1 \| 1 \(AI_BUSY ×1\) \| 30\.0 s \|/);
    expect(md).toContain("| Kept after the quote check | 5 (50%) |");
    expect(md).toContain("| Dropped: quote not in the file | 3 (30%) |");
    expect(md).toContain("| AI judgement (quoted) | 0 | 1 | 0 |");
    expect(md).toContain("Triage across 1 reviews: revise 1.");
  });

  it("says plainly when nothing was recorded", () => {
    const md = buildAiReport({ ...period, calls: [], jobs: [], reviews: [] });
    expect(md).toContain("No AI calls were recorded in this period.");
    expect(md).toContain("No review in this period recorded checklist counts.");
  });
});
