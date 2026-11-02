// Job progress messages shown in the UI (spec 8, reuse verbatim).

export const JOB_MESSAGES = {
  research: "Kaushal is gathering the job description, postings and sources…",
  roles: "Kaushal is drafting the roles from the job description…",
  activities: (n: number) => `Kaushal is writing activities for ${n} roles…`,
  competencies: "Kaushal is deriving competencies from the activities…",
  ladders: (n: number) => `Kaushal and Vidya are writing level ladders for ${n} competencies…`,
  check: "Running the expert check (computed checks + Kaushal and Vidya)…",
  review: "Reviewing — computed checks, then Kaushal and Vidya…",
} as const;

/** Reviewer notes the expert check always sends (spec 5.6). */
export const EXPERT_CHECK_NOTES = "Generated in FRAC Studio. Be strict.";
