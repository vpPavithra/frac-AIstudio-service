import type { AiCall } from "../../models/ai-call.model.ts";
import type { Finding, Report } from "../../models/report.model.ts";
import type { ReviewRecord } from "../../models/review.model.ts";
import { buildReviewReport } from "./review-report.ts";

const finding = (over: Partial<Finding>): Finding => ({ check: "context", sev: "M", title: "t", detail: "d", refs: ["C1"], fix: "f", source: "computed", ...over });

const report = (over: Partial<Report>): Report =>
  ({
    title: "x",
    cadre: "ANM",
    state: "Bihar",
    at: "2026-11-06T12:20:00.000Z",
    stats: { roles: 12, activities: 72, competencies: 32, indicators: 400, B: 4, F: 5, D: 23, other: 0 },
    verdict: "Revise before use — 1 blockers, 1 major and 0 minor findings.",
    triage: "revise",
    summary: "Checked 12 roles.",
    checks: [{ key: "context", name: "Guidelines & context", n: 2, status: "Fix before use", cls: "blocker" }],
    findings: [finding({ sev: "B", title: "Beyond ANM scope: Operative or MTP procedures", refs: ["ANM14"] }), finding({ source: "agent", title: "Clinical or programme facts to correct" })],
    strengths: ["Bloom's verbs: no issues found"],
    engine: "r3",
    fingerprint: "abcdef1234567890",
    aiChecklist: { competenciesAsked: 32, scopeRaised: 1, accuracyRaised: 3, kept: 2, droppedQuoteNotFound: 1, droppedCoveredByRule: 1, droppedDuplicateScope: 0, stateRaised: 6, stateKept: 6 },
    ...over,
  }) as Report;

const review = (id: string, r: Report, createdAt: string): ReviewRecord =>
  ({ id, ownerId: "u", fracId: "f1", kind: "expert-check", sourceName: "x", ctx: {}, sourceModel: null, report: r, createdAt }) as ReviewRecord;

const call = (over: Partial<AiCall>): AiCall => ({
  jobId: "j",
  jobKind: "check",
  provider: "claude",
  model: "claude-sonnet-5-5",
  task: "review-competencies",
  tier: "complex",
  outcome: "ok",
  latencyMs: 7000,
  inputTokens: 5000,
  outputTokens: 600,
  cacheReadTokens: 0,
  thinkingTokens: 200,
  webSearches: 0,
  costUsd: 0.016,
  estimated: false,
  startedAt: "2026-11-06T12:19:55.000Z",
  createdAt: "2026-11-06T12:20:02.000Z",
  ...over,
});

describe("review analysis report", () => {
  it("explains the latest review: verdict, triage reason, checks, every finding, the AI checklist and its cost", () => {
    const md = buildReviewReport({
      targetKind: "frac",
      targetId: "f1",
      targetName: "FRAC ANM · Bihar · standard",
      generatedAt: new Date("2026-11-06T13:00:00Z"),
      utcOffsetMinutes: 330,
      items: [{ review: review("r1", report({}), "2026-11-06T12:20:00.000Z"), calls: [call({}), call({ task: "review-state", costUsd: 0.04 })], runs: 1 }],
    });
    expect(md).toContain("# Review analysis: FRAC ANM · Bihar · standard");
    expect(md).toContain("1 expert check; 2 AI calls in total, $0.0560.");
    expect(md).toContain("**Triage:** Revise. Revise because there is 1 blocker and 1 major findings");
    expect(md).toContain("| Guidelines & context | Fix before use | 2 |");
    expect(md).toContain("| Rule-based check | 1 | 0 | 0 | 1 |");
    expect(md).toContain("| AI judgement (quoted) | 0 | 1 | 0 | 1 |");
    expect(md).toMatch(/\| 1 \| Blocker \| Rule-based check \| Guidelines & context \| Beyond ANM scope: Operative or MTP procedures \| ANM14 \|/);
    expect(md).toContain("| Dropped: quote not in the file | 1 (25%) |");
    expect(md).toMatch(/\| 1 \| 17:49:55 \| review-competencies \| ok \| 7\.0 s \| 5,000 \| 600 \| \$0\.0160 \|/);
    expect(md).not.toContain("## History");
  });

  it("explains a rebuild caused by one syllabus-verb activity, and tracks several expert checks in a history table", () => {
    const rebuild = report({ triage: "rebuild", findings: [finding({ sev: "m", title: "Activities read as syllabus outcomes", refs: ["A7"] })] });
    const md = buildReviewReport({
      targetKind: "frac",
      targetId: "f1",
      targetName: "FRAC ANM · Bihar · standard",
      generatedAt: new Date("2026-11-06T13:00:00Z"),
      items: [
        { review: review("r1", rebuild, "2026-11-06T10:00:00.000Z"), calls: [], runs: 0 },
        { review: review("r2", report({}), "2026-11-06T12:00:00.000Z"), calls: [call({})], runs: 1 },
      ],
    });
    expect(md).toContain("## History");
    expect(md).toMatch(/\| 1 \| 2026-11-06 10:00:00 \| Rebuild from the job \| 0 \| 0 \| 1 \| 0 \| 0 \| – \|/);
    expect(md).toContain("## Latest review");
    expect(md).toContain("## Earlier review 1");
    expect(md).toContain('Rebuild because the finding "Activities read as syllabus outcomes" is raised (any severity forces a rebuild under r3 §7).');
    expect(md).toContain("No model calls are linked to this review");
  });
});
