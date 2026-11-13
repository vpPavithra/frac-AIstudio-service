// Job progress messages shown in the UI (spec 8). The check and review lines follow rules r3 §6, where
// the AI part of a review is a fixed checklist. Review decisions (Nov 2026): the UI names "the agent", not the
// personas (Kaushal, Vidya), which stay only in the prompts.
// Used by FracService (Creator steps and expert check), the step files (progress updates) and ReviewService.

/** The `msg` a job shows while it runs; the functions take the count shown in the text. */
export const JOB_MESSAGES = {
  research: "The agent is gathering the job description, postings and sources…",
  researchDocuments: "The agent is reading your documents to see what they cover…",
  researchGaps: (parts: string) => `The agent is researching what your documents leave out: ${parts}…`,
  roles: "The agent is drafting the roles from the job description…",
  activities: (n: number) => `The agent is writing activities for ${n} roles…`,
  competencies: "The agent is deriving competencies from the activities…",
  mapping: "The agent is mapping activities to your competencies…",
  ladders: (n: number) => `The agent is writing level ladders for ${n} competencies…`,
  verifyRoles: "The agent is checking the roles and activities against your documents and the research…",
  check: "Running the expert check (rule-based checks, then the agent's checklist)…",
  review: "Reviewing — rule-based checks, then the agent's checklist…",
} as const;

/** Reviewer notes the expert check always sends (spec 5.6). */
export const EXPERT_CHECK_NOTES = "Generated in FRAC Studio. Be strict.";
