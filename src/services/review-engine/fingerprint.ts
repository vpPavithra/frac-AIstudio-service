import { createHash } from "node:crypto";
import type { ReviewContext, ReviewModel } from "../../models/review.model.ts";
import type { ReviewRules } from "./rules.ts";

// "Same file, same review" (rules r3 §9). A review is stored with this fingerprint; uploading the same
// file with the same context returns the stored review instead of asking the model again.
// Last step of the review flow: ReviewService computes it before a review (to look up a stored one,
// unless the caller asked for a fresh run) and stamps it on the finished report (report.fingerprint).
// The model ignores temperature, so this store, not the model, is what makes a review repeatable.

/** Bump whenever the engine code or the prompts change; it is part of every fingerprint. */
export const ENGINE_VERSION = "r3";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * sha256({v, postings, roles, competencies, ctx}), first 40 hex characters. `v` also carries a hash of
 * the rule tables, so editing config/review-rules.json or config/outdated.json never reuses a review
 * made under the old rules (the spec bumps ENGINE_VERSION by hand; config edits need no deploy here).
 */
export function reviewFingerprint(model: ReviewModel, ctx: ReviewContext, rules: ReviewRules): string {
  const v = `${ENGINE_VERSION}:${sha256(JSON.stringify(rules)).slice(0, 12)}`;
  return sha256(
    JSON.stringify({
      v,
      postings: model.postingLabels,
      roles: model.roles,
      competencies: model.competencies,
      ctx: { cadre: ctx.cadre ?? "", state: ctx.state ?? "", notes: ctx.notes ?? "" },
    }),
  ).slice(0, 40);
}
