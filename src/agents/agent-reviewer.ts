import type { AgentReview } from "../engine/report.js";
import type { Finding, ReviewModel, Stats } from "../engine/types.js";

export interface AgentReviewInput {
  model: ReviewModel;
  computed: Finding[];
  stats: Stats;
  cadre?: string;
  state?: string;
  notes?: string;
}

/** The judgement half of the review (spec 6.4): Kaushal + Vidya, complex tier. */
export interface AgentReviewer {
  review(input: AgentReviewInput): Promise<AgentReview>;
}

/**
 * Stand-in until the LLM reviewer lands. The real prompt has to be ported verbatim from the
 * prototype (METHOD, L244–255), so nothing here imitates it: the report carries the computed
 * findings only and says so in the verdict.
 */
export class ComputedOnlyReviewer implements AgentReviewer {
  async review(input: AgentReviewInput): Promise<AgentReview> {
    const serious = input.computed.some((f) => f.sev !== "m");
    return {
      cadre: input.cadre ?? "",
      verdict: "Computed checks only: the Kaushal and Vidya review is not enabled on this server yet.",
      triage: serious ? "revise" : "use",
      summary: `${input.computed.length} computed finding(s). Scope, clinical accuracy, granularity and ladder logic have not been judged.`,
      findings: [],
      strengths: [],
    };
  }
}
