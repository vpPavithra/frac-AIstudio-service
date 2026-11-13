// "CHECK ROLES AGAINST THE JOB DESCRIPTION" on the Roles tab (Nov 2026): one complex-tier call that checks the roles and activities
// (usually from a team's Roles sheet) against the job description and the research, and lists problems. It never
// changes roles; FracService.startRolesVerify saves the result as frac.rolesCheck. No web search.
import type { FracDocument } from "../../models/document.model.ts";
import type { Frac, FracRolesCheck } from "../../models/frac.model.ts";
import type { TextProvider } from "../../providers/text/types.ts";
import type { RecordUsage } from "../queue/job-runner.ts";
import { askModel } from "./ask-model.ts";
import { rolesVerifyPrompt } from "./prompts.ts";
import { rolesVerifyOutput } from "./schemas.ts";

/** Why the check cannot run yet, or null: it needs activities, and research or a job description to check them against. */
export function rolesVerifyNotReady(frac: Frac, documents: FracDocument[]): string | null {
  if (!frac.roles.some((r) => r.activities.length)) return "Add roles with activities before verifying them";
  if (!frac.research && !documents.some((d) => d.kind === "brief")) return "Research the job or attach a job description before verifying the roles";
  return null;
}

export async function verifyRoles(frac: Frac, documents: FracDocument[], provider: TextProvider, recordUsage: RecordUsage): Promise<FracRolesCheck> {
  const docs = documents.filter((d) => d.kind === "brief").map((d) => ({ name: d.filename, text: d.text }));
  const out = await askModel({
    provider, task: "verify-roles", tier: "complex", prompt: rolesVerifyPrompt(frac, docs),
    input: { cadre: frac.cadre, state: frac.state, roles: frac.roles, postings: frac.postings, documents: docs.map((d) => d.name) },
  }, rolesVerifyOutput, recordUsage);
  return { at: new Date().toISOString(), summary: out.summary, findings: out.findings };
}
