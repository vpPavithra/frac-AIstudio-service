// MOCK PROVIDER: sample answers when AI_PROVIDER=mock (`npm run dev:mock`); no model, no key.
// Content lives in ./content/cadres.json. How to edit or remove the mock: README.md in this folder.
// It answers every AI task (Creator steps 2-5 and the Reviewer checklist) from the request's structured
// `input`, ignoring the prompt text, in the same JSON shapes the step schemas validate. Usage is estimated
// from text length, priced at the MOCK_PRICED_AS profile's list prices (pricing.ts) and marked `estimated`.
// Reads MOCK.delayMs.
import type { ProviderRates } from "../config/ai-providers.ts";
import { MOCK } from "../config/constants.ts";
import { priceUsd } from "../providers/text/pricing.ts";
import type { AiTask, CompletionRequest, CompletionResult, TextProvider } from "../providers/text/types.ts";

/** The shape of content/cadres.json. */
export interface MockContent {
  /** Words in the brief's scope that name a posting, e.g. "sub-centre" → "{cadre} at Sub-Centre (outreach)". */
  postingKeywords?: Record<string, string>;
  cadres: Record<string, Partial<CadreProfile>>;
}

interface MockRole { title: string; source: string; activities: string[] }
interface MockCompetency { label: string; description: string; type: string; area: string; kcm: string }
interface MockSource { title: string; issuer: string; year: string; use: string; tier: string }
/** One cadre's sample answers. `match` lists name fragments; `base` names a profile to inherit fields from. */
interface CadreProfile {
  match: string[];
  base?: string;
  cadreFull: string;
  codePrefix: string;
  postings: string[];
  summary: string;
  authorised: string[];
  notAuthorised: string[];
  stateContext: string[];
  assumptions: string[];
  verify: string[];
  sources: MockSource[];
  sourceNotes: string;
  roles: MockRole[];
  competencies: MockCompetency[];
}

/** Rough English average, only for the mock's token estimate. */
const CHARS_PER_TOKEN = 4;
/** Common long words ignored when matching activities and scope to profile items. */
const STOP_WORDS = new Set(["with", "from", "that", "this", "each", "their", "into", "under", "after", "within", "using"]);

/** Lower-case words longer than 3 letters, minus STOP_WORDS: the mock's crude similarity measure. */
const words = (text: string) =>
  new Set(text.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3 && !STOP_WORDS.has(w)));

/** Replaces {cadre} and {state} placeholders from cadres.json with the brief's values. */
const fill = (text: string, vars: { cadre: string; state: string }) =>
  text.replaceAll("{cadre}", vars.cadre).replaceAll("{state}", vars.state || "the state");

/**
 * The first `count` items, preferring those that share words with the brief's scope (so a smaller
 * size keeps what the team asked for), kept in the profile's order.
 */
function byScope<T>(items: T[], scope: string, textOf: (item: T) => string, count: number): T[] {
  const sw = words(scope);
  if (!sw.size) return items.slice(0, count);
  const score = (item: T) => [...words(textOf(item))].filter((w) => sw.has(w)).length;
  const keep = new Set(items.map((item, i) => ({ i, s: score(item) })).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, count).map((x) => x.i));
  return items.filter((_, i) => keep.has(i));
}

/** Pauses so the progress bar visibly moves. 0 in tests. */
const pause = () => new Promise((resolve) => setTimeout(resolve, MOCK.delayMs));

/** TextProvider that answers from sample data. Created by index.ts createMockProvider. */
export class MockTextProvider implements TextProvider {
  readonly name = "mock" as const;
  private readonly profiles: Record<string, CadreProfile>;
  private readonly postingKeywords: Record<string, string>;

  /**
   * Resolves `base` once: a profile is its base's fields overlaid with its own.
   * `rates` prices the estimate (the MOCK_PRICED_AS provider profile).
   */
  constructor(
    file: MockContent,
    private readonly rates: ProviderRates,
  ) {
    this.postingKeywords = file.postingKeywords ?? {};
    this.profiles = Object.fromEntries(
      Object.entries(file.cadres).map(([key, p]) => [key, { ...(p.base ? file.cadres[p.base] : {}), ...p } as CadreProfile]),
    );
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    await pause();
    const input = (request.input ?? {}) as Record<string, unknown>;
    const json = this.answer(request.task, input);
    // Tokens estimated from text length; the cost is what they would cost on the MOCK_PRICED_AS provider (no thinking, no searches)
    const usage = {
      inputTokens: Math.ceil(request.prompt.length / CHARS_PER_TOKEN),
      outputTokens: Math.ceil(JSON.stringify(json).length / CHARS_PER_TOKEN),
    };
    return { json, model: "mock", usage, costUsd: priceUsd(this.rates, request.tier, usage), estimated: true };
  }

  /** Routes a task to its answer builder; each returns the JSON shape that task's schema expects. */
  private answer(task: AiTask, input: Record<string, unknown>): unknown {
    switch (task) {
      case "research":
        return this.research(input);
      case "roles":
        return this.roles(input);
      case "activities":
        return this.activities(input);
      case "competencies":
        return this.competencies(input);
      case "ladders":
        return this.ladders(input);
      case "review-competencies":
        return this.reviewCompetencies(input);
      case "review-state":
        return this.reviewState(input);
    }
  }

  /** The cadre's profile, matched on its name; DEFAULT when none matches. */
  private profile(cadre: string): CadreProfile {
    const upper = cadre.toUpperCase();
    const hit = Object.entries(this.profiles).find(([key, p]) => key !== "DEFAULT" && p.match.some((m) => upper.includes(m)));
    return hit ? hit[1] : this.profiles.DEFAULT;
  }

  /** Postings the brief's scope names (in the order written), else the profile's own. */
  private postingsFor(scope: string, p: CadreProfile, vars: { cadre: string; state: string }): string[] {
    const lower = scope.toLowerCase();
    // Longest keywords first, so "delivery point PHC" is one posting, not also "PHC"
    const taken: { at: number; end: number; label: string }[] = [];
    for (const [word, label] of Object.entries(this.postingKeywords).sort((a, b) => b[0].length - a[0].length)) {
      const at = lower.search(new RegExp(`\\b${word.replace(/[-]/g, "\\-")}\\b`));
      if (at >= 0 && !taken.some((t) => at < t.end && at + word.length > t.at)) taken.push({ at, end: at + word.length, label });
    }
    const named = taken.sort((a, b) => a.at - b.at).map((hit) => fill(hit.label, vars));
    const unique = [...new Set(named)];
    return (unique.length ? unique : p.postings.map((label) => fill(label, vars))).slice(0, 3);
  }

  /** Step 2 answer: the profile's research, with the brief's scope and any feedback echoed so revise is visible. */
  private research(input: Record<string, unknown>) {
    const vars = { cadre: String(input.cadre ?? ""), state: String(input.state ?? "") };
    const p = this.profile(vars.cadre);
    const scope = String(input.scope ?? "").trim();
    const feedback = input.feedback ? ` Revised with team feedback: ${String(input.feedback)}` : "";
    return {
      cadreFull: fill(p.cadreFull, vars),
      codePrefix: p.codePrefix || vars.cadre,
      summary: fill(p.summary, vars) + (scope ? ` The team asked this FRAC to cover: ${scope}.` : ""),
      postings: this.postingsFor(scope, p, vars).map((label, i) => ({ key: `P${i + 1}`, label })),
      sources: p.sources,
      authorised: p.authorised.map((s) => fill(s, vars)),
      notAuthorised: p.notAuthorised.map((s) => fill(s, vars)),
      stateContext: p.stateContext.map((s) => fill(s, vars)),
      sourceNotes: p.sourceNotes + feedback,
      assumptions: [...(scope ? [`Scope taken from the brief: ${scope}`] : []), ...p.assumptions.map((s) => fill(s, vars))],
      verify: p.verify.map((s) => fill(s, vars)),
    };
  }

  /** Step 3a answer: `count` profile roles, preferring those that match the brief's scope. */
  private roles(input: Record<string, unknown>) {
    const p = this.profile(String(input.cadre ?? ""));
    const count = Number(input.count ?? p.roles.length);
    const picked = byScope(p.roles, String(input.scope ?? ""), (r) => `${r.title} ${r.activities.join(" ")}`, count);
    return { roles: picked.map((r) => ({ title: r.title, source: r.source })) };
  }

  /**
   * Activities for the requested roles; a role the team added or renamed gets generic activities.
   * Those generic ones carry source "Added by team", the same marker roles.step.ts keeps on revise.
   */
  private activities(input: Record<string, unknown>) {
    const p = this.profile(String(input.cadre ?? ""));
    const count = Number(input.count ?? 6);
    const postings = (input.postings as string[] | undefined) ?? ["P1"];
    const roles = (input.roles as { code: string; title: string }[] | undefined) ?? [];
    return {
      roles: roles.map((role) => {
        const known = p.roles.find((r) => r.title.toLowerCase() === role.title.toLowerCase());
        const topic = role.title.charAt(0).toLowerCase() + role.title.slice(1);
        const texts = known
          ? known.activities
          : [`Plan the work to ${topic}`, `Carry out the tasks to ${topic}`, `Record the work done to ${topic}`,
            `Report problems met while trying to ${topic}`, `Coordinate with the team to ${topic}`, `Review results of efforts to ${topic}`];
        return {
          code: role.code,
          activities: texts.slice(0, count).map((text, i) => ({
            text,
            postings: Object.fromEntries(postings.map((key, k) => [key, k === 0 || (i + k) % 2 === 0 ? "Yes" : "No"])),
            source: known?.source ?? "Added by team",
            tier: i % 3 === 2 ? "Programme guideline" : "JD",
          })),
        };
      }),
    };
  }

  /**
   * Competencies from the profile, coded {prefix}1…; each activity maps to the competency sharing
   * the most words with it, then every unused competency takes an activity from one used twice,
   * so every activity has one competency and every competency is used (spec 5.4).
   */
  private competencies(input: Record<string, unknown>) {
    const p = this.profile(String(input.cadre ?? ""));
    const prefix = String(input.prefix ?? "C");
    const activities = (input.activities as { code: string; text: string }[] | undefined) ?? [];
    const count = Math.min(Number(input.count ?? p.competencies.length), p.competencies.length, Math.max(activities.length, 1));
    const comps = byScope(p.competencies, String(input.scope ?? ""), (c) => `${c.label} ${c.description} ${c.area}`, count)
      .map((c, i) => ({ code: `${prefix}${i + 1}`, ...c }));
    const compWords = comps.map((c) => words(`${c.label} ${c.description}`));

    const assigned = activities.map((a, i) => {
      const aw = words(a.text);
      let best = i % comps.length;
      let bestScore = 0;
      compWords.forEach((cw, k) => {
        const score = [...aw].filter((w) => cw.has(w)).length;
        if (score > bestScore) [best, bestScore] = [k, score];
      });
      return best;
    });
    for (let k = 0; k < comps.length; k++) {
      if (assigned.includes(k)) continue;
      const donor = assigned.findIndex((c) => assigned.filter((x) => x === c).length > 1);
      if (donor >= 0) assigned[donor] = k;
    }
    // Spec 3.7: usually L3; L4 for supervising/reviewing work; L5 only for audit or mentoring
    const levelFor = (text: string) => (/audit|mentor/i.test(text) ? 5 : /supervise|review|verify|investigate|manage/i.test(text) ? 4 : 3);
    return {
      competencies: comps,
      mapping: activities.map((a, i) => ({ a: a.code, c: comps[assigned[i]].code, l: levelFor(a.text) })),
    };
  }

  /** Five cumulative levels per competency; Behavioural ones follow Krathwohl's affective ladder (spec 3.5). */
  private ladders(input: Record<string, unknown>) {
    const list = (input.competencies as { code: string; label: string; type: string }[] | undefined) ?? [];
    const feedback = input.feedback ? `\n- Revised for team feedback: ${String(input.feedback).slice(0, 120)}` : "";
    return {
      ladders: list.map((c) => {
        const t = c.label.toLowerCase();
        const behavioural = c.type.trim().toUpperCase().startsWith("B");
        const levels = behavioural
          ? [
              { label: `Attends to ${t} in daily work`, desc: `Notices situations that call for ${t}\n- Listens to feedback about it` },
              { label: `Responds with ${t} when prompted`, desc: `Shows ${t} when a supervisor or client asks\n- Accepts correction without defensiveness` },
              { label: `Demonstrates ${t} consistently without prompting`, desc: `Shows ${t} with every client and colleague\n- Explains why it matters to the team${feedback}` },
              { label: `Upholds ${t} in difficult situations`, desc: `Maintains ${t} under workload or conflict\n- Resolves lapses in the team constructively` },
              { label: `Models and promotes ${t} across the team`, desc: `Mentors colleagues on ${t}\n- Builds ${t} into team routines and reviews` },
            ]
          : [
              { label: `Identifies when ${t} is needed`, desc: `Identifies cases that need ${t}\n- Lists the equipment and records required` },
              { label: `Performs ${t} under supervision`, desc: `Performs each step with a supervisor present\n- Follows the checklist and records findings` },
              { label: `Performs ${t} independently to protocol`, desc: `Performs ${t} without supervision\n- Recognises deviations and refers in time${feedback}` },
              { label: `Manages complex ${t} situations`, desc: `Manages complications and atypical cases\n- Prioritises when several clients need ${t}` },
              { label: `Audits and improves ${t} practice`, desc: `Audits ${t} records against standards\n- Mentors colleagues and proposes improvements` },
            ];
        return { code: c.code, levels };
      }),
    };
  }

  /**
   * Vidya's checklist (rules r3 §6.1). Answers like a careful reviewer: nothing to flag for most
   * competencies, and per batch one "check this" accuracy flag on the first L3/L4 line that names a
   * protocol, schedule or dose, quoting it word for word so it passes the quote check.
   */
  private reviewCompetencies(input: Record<string, unknown>) {
    const comps = (input.competencies as { code: string; text: string }[] | undefined) ?? [];
    const lineOf = (text: string) => text.split("\n").find((l) => /^L[34]: /.test(l) && /protocol|schedule|dose/i.test(l)) ?? "";
    const flagged = comps.find((c) => lineOf(c.text).split(/\s+/).length >= 8)?.code;
    return {
      items: comps.map((c) => {
        const words = lineOf(c.text).replace(/^L\d: /, "").split(/\s+/).filter(Boolean).slice(0, 10);
        const flag = c.code === flagged;
        return {
          code: c.code,
          scope: [],
          accuracy: flag
            ? [{ quote: words.join(" "), issue: "Confirm the schedule and protocol named here against the current national guideline", correct: "Cite the current national guideline for this step (verify)" }]
            : [],
        };
      }),
    };
  }

  /** State fit (rules r3 §6.2): fixed categories, every item marked "(verify)". */
  private reviewState(input: Record<string, unknown>) {
    const state = String(input.state ?? "the state");
    const codes = (input.competencyCodes as string[] | undefined) ?? [];
    return {
      items: [
        { category: "Disease burden", item: `Name the diseases endemic in ${state} that this cadre screens or refers for (verify).`, refs: codes.slice(0, 1) },
        { category: "State schemes", item: `Add the ${state} health schemes and portals the cadre uses day to day (verify).`, refs: [] },
      ],
    };
  }
}
