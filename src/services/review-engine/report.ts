import type { CheckKey, CheckSummary, Finding, Report, Severity, Stats, Triage } from "../../models/report.model.ts";

export const CHECK_NAMES: Record<CheckKey, string> = {
  bloom: "Bloom's verbs",
  structure: "FRAC structure",
  ladder: "Level ladder",
  context: "Guidelines & context",
  coverage: "Coverage & sources",
};

export const TRIAGE_LABELS: Record<Triage, string> = {
  use: "Use with minor edits",
  revise: "Revise",
  rebuild: "Rebuild from the job",
};

const SEV_RANK: Record<Severity, number> = { B: 0, M: 1, m: 2 };
const SEVERITIES = new Set<string>(["B", "M", "m"]);
const CHECKS = new Set<string>(Object.keys(CHECK_NAMES));
const TRIAGES = new Set<string>(["use", "revise", "rebuild"]);
/** Spec 6.4: at most 10 agent findings, most severe first. */
const MAX_AGENT_FINDINGS = 10;

export interface AgentReview {
  cadre: string;
  verdict: string;
  triage: Triage;
  summary: string;
  findings: Finding[];
  strengths: string[];
}

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

/** Coerces the model's JSON into AgentReview: bad sev → m, bad check → structure, source → agent. */
export function normaliseAgentReview(raw: unknown): AgentReview {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const findings = (Array.isArray(r.findings) ? r.findings.slice(0, MAX_AGENT_FINDINGS) : []).map((item): Finding => {
    const f = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const sev = str(f.sev);
    const check = str(f.check);
    return {
      check: (CHECKS.has(check) ? check : "structure") as CheckKey,
      sev: (SEVERITIES.has(sev) ? sev : "m") as Severity,
      title: str(f.title),
      detail: str(f.detail),
      refs: strArr(f.refs),
      fix: str(f.fix),
      source: "agent",
    };
  });
  const triage = str(r.triage);
  return {
    cadre: str(r.cadre),
    verdict: str(r.verdict),
    triage: (TRIAGES.has(triage) ? triage : "revise") as Triage,
    summary: str(r.summary),
    findings,
    strengths: strArr(r.strengths),
  };
}

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => SEV_RANK[a.sev] - SEV_RANK[b.sev]);
}

/** Per-check status = worst severity among that check's open findings. */
export function summariseChecks(findings: Finding[]): CheckSummary[] {
  return (Object.keys(CHECK_NAMES) as CheckKey[]).map((key) => {
    const mine = findings.filter((f) => f.check === key && !f.fixed);
    const worst = mine.reduce<Severity | null>((w, f) => (w === null || SEV_RANK[f.sev] < SEV_RANK[w] ? f.sev : w), null);
    const base = { key, name: CHECK_NAMES[key], n: mine.length };
    switch (worst) {
      case "B":
        return { ...base, status: "Fix before use", cls: "blocker" };
      case "M":
        return { ...base, status: "Needs work", cls: "major" };
      case "m":
        return { ...base, status: "Mostly fine", cls: "minor" };
      default:
        return { ...base, status: "Pass", cls: "pass" };
    }
  });
}

export interface ReportContext {
  title: string;
  cadre?: string;
  state?: string;
}

export function buildReport(ctx: ReportContext, stats: Stats, computed: Finding[], agent: AgentReview, at = new Date()): Report {
  const findings = sortFindings([...computed, ...agent.findings]);
  return {
    title: ctx.title,
    cadre: ctx.cadre || agent.cadre,
    state: ctx.state ?? "",
    at: at.toISOString(),
    stats,
    verdict: agent.verdict,
    triage: agent.triage,
    summary: agent.summary,
    checks: summariseChecks(findings),
    findings,
    strengths: agent.strengths,
  };
}
