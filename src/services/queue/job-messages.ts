// Job progress messages shown in the UI (spec 8). The check and review lines follow rules r3 §6, where
// the AI part of a review is Vidya's fixed checklist (the spec's text predates r3 and names both agents).

export const JOB_MESSAGES = {
  research: "Kaushal is gathering the job description, postings and sources…",
  roles: "Kaushal is drafting the roles from the job description…",
  activities: (n: number) => `Kaushal is writing activities for ${n} roles…`,
  competencies: "Kaushal is deriving competencies from the activities…",
  ladders: (n: number) => `Kaushal and Vidya are writing level ladders for ${n} competencies…`,
  check: "Running the expert check (rule-based checks, then Vidya's checklist)…",
  review: "Reviewing — rule-based checks, then Vidya's checklist…",
} as const;

/** Reviewer notes the expert check always sends (spec 5.6). */
export const EXPERT_CHECK_NOTES = "Generated in FRAC Studio. Be strict.";
