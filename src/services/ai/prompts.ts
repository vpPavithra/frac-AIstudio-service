// PROMPT BUILDERS for every AI call: Creator steps 2-5 (research, roles, activities, competencies, ladders)
// and the Reviewer's checklist (ai-review.service.ts, also run by the expert check). Pure string builders;
// the step files call them and pass the text to the TextProvider. Brief size wording comes from
// config/frac-sizes.json (via sizes.ts). Never edit the text inside the templates without the spec owner.
import type { Frac, FracActivity, FracSource, ResearchField } from "../../models/frac.model.ts";
import { DOCUMENTS } from "../../config/constants.ts";
import { loadReviewRules } from "../../config/review-rules.ts";
import { cadreFamily } from "../review-engine/rules.ts";
import { SIZE_TARGETS } from "./sizes.ts";

// Prompt builders, structured as spec 5.2–5.5 and rules r3 §6 describe. METHOD, SOURCE_LIBRARY, KAUSHAL,
// PERSONAS and VIDYA carry the spec's rules (section 3) so any real provider works as is. If the prototype file
// (frac-studio.html L244–265) turns up, its verbatim wording can replace these constants; the
// output shapes below must stay as they are, because the step schemas (schemas.ts) validate them.
// The mock provider ignores prompt text and answers from the structured input instead.

// Spec 1 and 5.2–5.5: steps 2–4 are Kaushal alone; Kaushal + Vidya write the ladders (5.5); the
// Reviewer's checklist is Vidya alone (rules r3 §6).
const KAUSHAL_ROLE = "Kaushal: FRAC and HR architect. Knows the Karmayogi FRAC method, the CBC Karmayogi Competency Model (KCM) and Bloom's taxonomy. Builds positions, roles, activities, competencies and level ladders.";
const VIDYA_ROLE = "Vidya: clinical and public-health programme expert for India. Checks every clinical fact, drug, dose, schedule, law and programme name against current Indian national guidelines and the cadre's legal scope.";

export const KAUSHAL = `You are ${KAUSHAL_ROLE}`;
export const PERSONAS = `You are two experts working together.\n${KAUSHAL_ROLE}\n${VIDYA_ROLE}`;

export const METHOD = `METHOD (non-negotiable rules)
1. JD first. Build order is Position → Roles → Activities → Competencies. Start from the job description and the places the cadre is posted, never from a syllabus. Roles are areas of work ("Conduct VHSND sessions"), never curriculum subjects ("Anatomy & Physiology").
2. Activities use performance verbs (Conduct, Screen, Refer, Maintain). Never Describes / Explains / Knows / Understands.
3. Competency types follow the CBC Karmayogi Competency Model: Behavioural (13 in KCM), Functional (21 in KCM), Domain (department-defined). Mostly Domain, with a real mix of Functional and Behavioural.
4. Five cumulative levels: L1 Foundational, L2 Assisted, L3 Independent, L4 Complex, L5 Expert/Mentor. Declared deviation from Karmayogi's 4-point scale; crosswalk: L1 = Awareness, L2 + L3 = Application, L4 = Leveraging knowledge & taking decisions, L5 = Subject matter expert.
5. Bloom's rule, no exceptions: every level label and every indicator starts with a measurable verb. Banned at every level: Understands, Knows, Learns, Is aware of, Appreciates, Is familiar with. Behavioural competencies use Krathwohl's affective ladder (Receives → Responds → Values → Organises → Internalises), written as observable behaviour.
6. A level description has 2–4 indicators. Each indicator after the first goes on a new line starting with "-". Every indicator is assessable by OSCE, observation, record audit or MCQ.
7. Mapping: each activity maps to exactly one competency at the level the job demands (competency@level, usually L3 or L4). L1/L2 are rarely demanded. L5 only for audit or mentoring activities. Every competency is used by at least one activity.
8. Scope: never include an act beyond the cadre's legal or programme scope. Every activity carries a source tier: JD | Programme guideline | Facility standard (IPHS 2022 / NQAS / LaQshya) | Inferred – verify. Taught in the curriculum is not authorised by the employer.
9. Current names only: Mental Healthcare Act 2017, NDPS Act 1985, MTP (Amendment) Act 2021, PCPNDT 1994, POCSO 2012, Ayushman Arogya Mandir (formerly HWC), NTEP, NP-NCD, NCVBDC, Td (not TT), U-WIN, RCH portal, IPHS 2022, NQAS, LaQshya, MusQan, SUMAN, WHO Labour Care Guide.
10. Never invent page numbers, circular numbers or URLs. If unsure, mark the fact "verify".`;

export const SOURCE_LIBRARY = `SOURCE LIBRARY (where JDs and duties are found)
- IPHS 2022 annexures with job descriptions.
- Ayushman Arogya Mandir guidelines, ASHA modules, ANM/MPW job responsibilities.
- SBA 2010 Annexure IX, Dakshata, LaQshya, MusQan, SUMAN, HBNC/HBYC, IMNCI.
- National programme guidelines (RMNCH+A, UIP, NTEP, NP-NCD, NCVBDC and others).
- INC syllabi: teaching scope only, never proof of authorisation.
- KCM, the FRAC Introduction Pack and the Karmayogi Quality Framework.`;

/** Closing line before every output shape; claude.ts also sends a JSON-only system instruction. */
const JSON_ONLY = "Answer with this JSON object only, no prose:";

/** True until research has chosen the size of a FRAC whose brief left it to the agent. */
const sizeUndecided = (f: Frac) => f.sizeBy === "agent" && !f.research;
const sizeChoices = () =>
  (Object.keys(SIZE_TARGETS) as (keyof typeof SIZE_TARGETS)[]).map((k) => `${k} (${SIZE_TARGETS[k].ranges})`).join("; ");

// Shared prompt blocks. `revise` is empty on a first run, so filter(Boolean) drops it.
const brief = (f: Frac) =>
  `BRIEF\nCadre: ${f.cadreFull || f.cadre}\nState: ${f.state}\nSize: ${sizeUndecided(f) ? "decide from the research" : `${f.size} (${SIZE_TARGETS[f.size].ranges})`}\nWhat this FRAC should cover: ${f.prompt || "-"}`;
const revise = (feedback?: string) =>
  feedback ? `TEAM FEEDBACK (apply it; keep what the team edited unless the feedback says otherwise):\n${feedback}` : "";
const scope = (f: Frac) =>
  `AUTHORISED (treat as authoritative):\n${f.research?.authorised ?? ""}\nNOT AUTHORISED (must be referred):\n${f.research?.notAuthorised ?? ""}`;
const postings = (f: Frac) => f.postings.map((p) => `${p.key} ${p.label}`).join("; ") || "none (the job has no separate postings)";

/**
 * Postings come from the team (review, Nov 2026): only the places of work the brief or the team documents name, as
 * many as they name (one, several or none). The team adds or edits them on the Research tab.
 */
const POSTINGS_RULE = `Postings: list every place of work the brief or the team documents name, and only those (as many as they name, in their order; e.g. "ANM at Sub-Centre (outreach)"). They become the FRAC's Yes/No columns. Do not add postings they do not name, and return an empty list when they name none: the team adds postings themselves.`;

/**
 * The Reviewer's own rule tables (config/review-rules.json scope, config/outdated.json), so the Creator writes
 * what the expert check passes: each act beyond the cadre's scope with what to write instead, and the outdated
 * names with their current ones. Read per prompt, like the review, so a rule edit applies without a restart.
 * Empty for a cadre with no scope rules (e.g. a nurse) apart from the outdated names.
 */
export const reviewGuard = (f: Frac): string => {
  const rules = loadReviewRules();
  const family = cadreFamily(f.cadre) ?? cadreFamily(f.cadreFull);
  const acts = (family ? (rules.scope[family] ?? []) : []).map((r) => `- ${r.act}. Write instead: ${r.instead}.`);
  const outdated = rules.outdated.filter((o) => family || !o.frontlineOnly).map((o) => `- ${o.found} → ${o.correct}`);
  return [
    acts.length
      ? `THE EXPERT CHECK FLAGS THESE AS BEYOND ${f.cadre.toUpperCase()} SCOPE. Do not give the ${f.cadre} these acts, and avoid the wording too: a label such as "Manage emergencies…" is flagged even when its indicators stay within standing orders. Name drugs; never write "emergency drugs".\n${acts.join("\n")}`
      : "",
    outdated.length ? `OUTDATED NAMES THE EXPERT CHECK FLAGS (use the current one):\n${outdated.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
};

/**
 * What the team gave research besides the brief (review decisions, Nov 2026): the text of attached job
 * descriptions or orders, a standard source list, and postings fixed by an uploaded Roles sheet or a matched position.
 */
export interface ResearchExtras {
  documents?: { name: string; text: string }[];
  sources?: FracSource[] | null;
  fixedPostings?: boolean;
  /**
   * Set when documentReadPrompt has already read the documents: what they say, and which parts are covered.
   * Research then works on the gaps only, and the documents' text is not sent again.
   */
  known?: KnownResearch;
}

/** What the document read found, for the gap research call (research.step.ts). */
export interface KnownResearch {
  values: Record<string, unknown>;
  found: ResearchField[];
  partial: ResearchField[];
  missing: ResearchField[];
}

/** How the prompts name each research part. */
const FIELD_NAMES: Record<ResearchField, string> = {
  cadreFull: "cadreFull (full position name)",
  summary: "summary",
  postings: "postings",
  authorised: "authorised",
  notAuthorised: "notAuthorised",
  stateContext: "stateContext",
  sources: "sources",
};

/** The documents' text, in upload order, within DOCUMENTS.maxChars in total. */
const teamDocuments = (docs: { name: string; text: string }[], heading = "TEAM DOCUMENTS (the primary source: read these first, cite them by name in sources, and search only for what they leave out)") => {
  let left = DOCUMENTS.maxChars;
  const parts = docs.flatMap((d) => {
    const text = d.text.slice(0, Math.max(0, left));
    left -= text.length;
    return text ? [`--- ${d.name} ---\n${text}`] : [];
  });
  return parts.length ? `${heading}:\n${parts.join("\n\n")}` : "";
};

/** The gap research block: what the documents already gave, and the parts left to research. */
const knownBlock = (known: KnownResearch, docNames: string[]) => {
  const names = (fields: ResearchField[]) => fields.map((k) => FIELD_NAMES[k]).join(", ") || "none";
  return [
    `ALREADY READ FROM THE TEAM DOCUMENTS (${docNames.join(", ")}). Treat these as authoritative and do not research them again:\n${JSON.stringify(known.values)}`,
    `COVERED BY THE DOCUMENTS (leave these empty in your answer): ${names(known.found)}`,
    `PARTLY COVERED (complete these, keeping everything already there): ${names(known.partial)}`,
    `NOT COVERED (research these): ${names(known.missing)}`,
    "POSTINGS: decided from the brief and the documents, not researched; leave them empty in your answer.",
  ].join("\n");
};

/**
 * Step 2, first part when the team attached documents (review, Nov 2026): read the documents alone, no web
 * search, and say for each research part whether they cover it. research.step.ts then researches only the gaps.
 */
export const documentReadPrompt = (f: Frac, documents: { name: string; text: string }[], fixedPostings = false) => {
  const decideSize = sizeUndecided(f);
  return [KAUSHAL, brief(f), METHOD,
    teamDocuments(documents, "TEAM DOCUMENTS (read these only)"),
    fixedPostings && f.postings.length ? `POSTINGS (fixed by the team; return them unchanged): ${postings(f)}` : "",
    decideSize ? `SIZE: choose the size that fits the breadth of this job as the documents describe it: ${sizeChoices()}.` : "",
    POSTINGS_RULE,
    `Read the team documents and fill each field with what they state. Use only the brief and the documents: no outside knowledge, no guesses. In "coverage" mark each field "found" when the documents cover it fully, "partial" when they cover some of it, and "missing" when they say nothing about it; leave a missing field empty. Postings are "found" when the brief or documents name where the position works, "missing" otherwise. Put anything stated but unclear or possibly outdated in "verify".`,
    `${JSON_ONLY}
{"cadreFull":"","codePrefix":"2–4 capital letters","summary":"what the documents say about the job",
 "postings":[{"key":"P1","label":""}],
 "authorised":[""],"notAuthorised":[""],"stateContext":[""],"sourceNotes":"","assumptions":[""],"verify":[""],
 "coverage":{"cadreFull":"found | partial | missing","summary":"","postings":"","authorised":"","notAuthorised":"","stateContext":""}${decideSize ? ',\n "size":"compact | standard | full","sizeReason":"one sentence"' : ""}}`].filter(Boolean).join("\n\n");
};

/** Step 2 (spec 5.2). On revise it carries the whole previous research (team edits included) plus the feedback. */
export const researchPrompt = (f: Frac, feedback?: string, extras: ResearchExtras = {}) => {
  const decideSize = sizeUndecided(f);
  const sources = extras.sources?.length ? extras.sources : null;
  const known = extras.known;
  const docs = extras.documents ?? [];
  return [KAUSHAL, brief(f), METHOD, SOURCE_LIBRARY,
    f.research ? `PREVIOUS RESEARCH:\n${JSON.stringify(f.research)}` : "", revise(feedback),
    known ? knownBlock(known, docs.map((d) => d.name)) : teamDocuments(docs),
    sources ? `SOURCES (the team's standard list: work from these only, do not search, and leave "sources" empty in the answer):\n${sources.map((x) => `- ${x.title} (${[x.issuer, x.year].filter(Boolean).join(", ")})`).join("\n")}` : "",
    extras.fixedPostings && f.postings.length ? `POSTINGS (fixed by the team; return them unchanged): ${postings(f)}` : "",
    decideSize ? `SIZE: choose the size that fits the breadth of this job: ${sizeChoices()}. A narrow, single-setting job is compact; a broad multi-programme job is full.` : "",
    known ? "" : POSTINGS_RULE,
    `Research the job. Find the applicable JD documents; list what the cadre is and is not authorised to do; list what changes for this state (programmes, cadre names, endemic diseases, languages, portals). For the national baseline, say what each state must customise. Cite only documents you actually found; put anything unsure in "verify".${known ? " Work only on the parts that are partly covered or not covered; in sources list what you used beyond the team documents." : ""}${sources ? "" : " When web search is available, use it to open the JD and the main programme guidelines before you list them, and give each source the address of the page you opened."}`,
    `${JSON_ONLY}
{"cadreFull":"","codePrefix":"2–4 capital letters","summary":"6–10 sentences",
 "postings":[{"key":"P1","label":""}],
 "sources":[${sources ? "" : '{"title":"","issuer":"","year":"","use":"","tier":"","url":"the exact address of the page your search opened for it, copied from the search result; empty if you did not open one"}'}],
 "authorised":[""],"notAuthorised":[""],"stateContext":[""],"sourceNotes":"","assumptions":[""],"verify":[""]${decideSize ? ',\n "size":"compact | standard | full","sizeReason":"one sentence"' : ""}}`].filter(Boolean).join("\n\n");
};

/** Step 3a (spec 5.3): `count` roles from the edited research. On revise it lists the previous role titles. */
export const rolesPrompt = (f: Frac, count: number, feedback?: string) =>
  [KAUSHAL, brief(f), `RESEARCH (treat as authoritative):\n${f.research?.summary ?? ""}`, scope(f), `POSTINGS: ${postings(f)}`, METHOD,
    f.roles.length ? `PREVIOUS ROLES:\n${f.roles.map((r) => `${r.code} ${r.title}`).join("\n")}` : "", revise(feedback),
    `List ${count} roles covering the whole job across all postings. Write each role as an action. Include non-clinical work: records, stock, supervision, mobilisation. "source" names the document the role comes from.`,
    `${JSON_ONLY}\n{"roles":[{"title":"","source":""}]}`].filter(Boolean).join("\n\n");

/**
 * Step 3b (spec 5.3) for one batch of roles. Earlier activities of a role with the same title are offered as
 * "keep the good ones". The JSON example lists the FRAC's own posting keys so the answer uses them.
 */
export const activitiesPrompt = (f: Frac, roles: { code: string; title: string }[], count: number, feedback?: string) => {
  const earlier = roles
    .map((r) => ({ r, acts: f.roles.find((x) => x.title.trim().toLowerCase() === r.title.toLowerCase())?.activities ?? [] }))
    .filter((x) => x.acts.length)
    .map((x) => `${x.r.code}:\n${x.acts.map((a) => `- ${a.text}`).join("\n")}`);
  const keys = f.postings.map((p) => p.key);
  const perPosting = keys.length ? ` give Yes or No for every posting (${keys.join(", ")}),` : "";
  return [KAUSHAL, brief(f), scope(f), reviewGuard(f), METHOD, `POSTINGS: ${postings(f)}`,
    `ROLES:\n${roles.map((r) => `${r.code} ${r.title}`).join("\n")}`,
    earlier.length ? `EARLIER ACTIVITIES (keep the good ones):\n${earlier.join("\n")}` : "", revise(feedback),
    `For each role, write ${count} observable workplace activities with performance verbs. For each activity${perPosting} give the source document and the source tier (JD | Programme guideline | Facility standard | Inferred – verify).`,
    `${JSON_ONLY}\n{"roles":[{"code":"R1","activities":[{"text":"","postings":{${keys.map((k) => `"${k}":"Yes"`).join(",")}},"source":"","tier":""}]}]}`].filter(Boolean).join("\n\n");
};

/**
 * Step 4 (spec 5.4): every activity, plus on revise the existing codes and labels so the model keeps them
 * (competenciesPatch keeps a ladder only when code and label both survive).
 */
export const competenciesPrompt = (f: Frac, count: number, feedback?: string) => {
  const prefix = f.codePrefix || "C";
  return [KAUSHAL, brief(f), reviewGuard(f), METHOD,
    `ACTIVITIES:\n${f.roles.flatMap((r) => r.activities.map((a) => `${a.code} ${a.text}`)).join("\n")}`,
    f.competencies.length ? `EXISTING COMPETENCIES (keep existing codes; mint new codes after the highest one):\n${f.competencies.map((c) => `${c.code} ${c.label}`).join("\n")}` : "",
    revise(feedback),
    `Derive ${count} competencies LAST, from the activities, coded ${prefix}1, ${prefix}2, …. Each has a label (noun phrase), a description (one sentence starting with a verb), a type (Domain, Functional or Behavioural), an area, and kcm (the KCM competency name, or "Domain – department-defined"). Every activity maps to exactly one competency at the level the job demands (l = 1–5, usually 3 or 4; 5 only for audit or mentoring), and every competency is used at least once.`,
    `${JSON_ONLY}\n{"competencies":[{"code":"${prefix}1","label":"","description":"","type":"Domain","area":"","kcm":""}],"mapping":[{"a":"A1","c":"${prefix}1","l":3}]}`].filter(Boolean).join("\n\n");
};

/**
 * Step 4 with a team's Competencies sheet (review decisions, Nov 2026): the competencies are fixed, so the
 * model only maps each activity to one of them at a level. Much shorter answer than competenciesPrompt.
 */
export const mappingPrompt = (f: Frac, feedback?: string) =>
  [KAUSHAL, brief(f), METHOD,
    `ACTIVITIES:\n${f.roles.flatMap((r) => r.activities.map((a) => `${a.code} ${a.text}`)).join("\n")}`,
    `COMPETENCIES (the team's standard; use these codes only, do not add or rename any):\n${f.competencies.map((c) => `${c.code} ${c.label} [${c.type}]${c.description ? ` — ${c.description}` : ""}`).join("\n")}`,
    revise(feedback),
    `Map every activity to exactly one of these competencies at the level the job demands (l = 1–5, usually 3 or 4; 5 only for audit or mentoring). Use as many of the competencies as fit the activities.`,
    `${JSON_ONLY}\n{"mapping":[{"a":"A1","c":"${f.competencies[0]?.code ?? "C1"}","l":3}]}`].filter(Boolean).join("\n\n");

/**
 * "Check roles against the job description" on the Roles tab (Nov 2026): checks roles and activities, usually from a team's Roles sheet,
 * against the job description and the research. Reports problems only; nothing on the FRAC changes.
 */
export const rolesVerifyPrompt = (f: Frac, documents: { name: string; text: string }[]) => {
  const keys = f.postings.map((p) => p.key);
  const row = (a: FracActivity) => `${a.code} ${a.text}${keys.length ? ` [${keys.map((k) => `${k}:${a.postings[k] || "-"}`).join(" ")}]` : ""}`;
  return [PERSONAS, brief(f),
    f.research ? `RESEARCH\nSummary: ${f.research.summary}\n${scope(f)}\nSTATE CONTEXT:\n${f.research.stateContext}` : "",
    teamDocuments(documents, "JOB DESCRIPTION AND ORDERS FROM THE TEAM (authoritative)"),
    `POSTINGS: ${postings(f)}`,
    `ROLES AND ACTIVITIES (with each posting's Yes/No):\n${f.roles.map((r) => `${r.code} ${r.title}\n${r.activities.map(row).join("\n") || "(no activities)"}`).join("\n\n")}`,
    `Check the roles and activities against the job description and the research. Report problems only:
- missing: a duty the job description or the authorised list names that no activity covers (role "" when no role fits);
- outside-scope: an activity the position may not do (NOT AUTHORISED, or beyond the job description);
- posting: a Yes/No that does not fit where that posting works;
- duplicate: two activities that say the same thing;
- unclear: an activity too vague to train or assess.
Quote the activity code. Give a one-line suggestion. Return an empty list when nothing is wrong; do not invent problems.`,
    `${JSON_ONLY}\n{"summary":"one or two sentences","findings":[{"kind":"missing | outside-scope | posting | duplicate | unclear","role":"R1","activity":"A3","note":"","suggestion":""}]}`].filter(Boolean).join("\n\n");
};

/**
 * Step 5 (spec 5.5) for one batch of competency codes: each competency with the activities that use it
 * (and their levels) and its current ladder, if any, so a revise edits rather than starts over.
 */
export const laddersPrompt = (f: Frac, codes: string[], feedback?: string) => {
  const usedBy = (code: string) =>
    f.roles.flatMap((r) => r.activities).filter((a) => a.comp.split("@")[0].trim() === code).map((a) => `${a.code} ${a.text} (@${a.comp.split("@")[1] ?? "?"})`);
  const blocks = f.competencies.filter((c) => codes.includes(c.code)).map((c) =>
    [`${c.code} ${c.label} [${c.type}] — ${c.description}`,
      `Used by: ${usedBy(c.code).join("; ") || "none"}`,
      c.levels ? `Current ladder:\n${c.levels.map((l, i) => `L${i + 1} ${l.label} :: ${l.desc}`).join("\n")}` : ""].filter(Boolean).join("\n"));
  return [PERSONAS, brief(f), scope(f), reviewGuard(f), METHOD, `COMPETENCIES:\n${blocks.join("\n\n")}`, revise(feedback),
    "Kaushal writes and Vidya checks every clinical fact. For each competency write L1–L5. Each level has a one-line label that starts with a measurable verb and differs from the other levels, and a desc of 2–4 indicators (first indicator on the first line, each further one on a new line starting with \"-\"). Levels are cumulative; L5 covers audit, mentoring and improving the system. Clinical content follows current Indian national guidelines and stays within the authorised scope.",
    `${JSON_ONLY}\n{"ladders":[{"code":"","levels":[{"label":"","desc":""},{"label":"","desc":""},{"label":"","desc":""},{"label":"","desc":""},{"label":"","desc":""}]}]}`].filter(Boolean).join("\n\n");
};

// ---- Reviewer (rules r3 §6): fixed questions only. Code writes titles, severities, verdict and summary. ----

/** The Reviewer's persona: Vidya alone answers the fixed checklist (rules r3 §6). */
export const VIDYA = `You are ${VIDYA_ROLE}`;

/** One competency as the checklist sees it: definition plus each level's label and indicators. */
export interface ChecklistCompetency {
  code: string;
  text: string;
}

/** What review-engine/checks.ts already decides, so the model does not repeat it (rules r3 §6). */
const CODE_CHECKS = `ALREADY CHECKED IN CODE (do NOT flag these): measurable verbs; ladder shape (independent at L1–L2; supervising, mentoring or training at L3; policy, research, district or state roles at L4–L5); overlap and Domain/Functional/Behavioural tagging; outdated names (TT, RNTCP, NPCDCS, HWC, NVBDCP, MCTS, NRT, RMNCH+A, NRHM, VHND, Five Rights, partograph, old Acts).`;

/**
 * Q1 scope + Q2 accuracy for one batch of competencies (rules §6.1; REVIEW_BATCH_SIZE, 6 by default).
 * `scopeHits` are code-found scope problems in this batch, listed so the model does not flag them again.
 */
export const reviewChecklistPrompt = (cadre: string, state: string, comps: ChecklistCompetency[], scopeHits: string[]) =>
  [VIDYA, `Cadre: ${cadre}\nState: ${state || "India (national baseline)"}`, CODE_CHECKS,
    scopeHits.length ? `SCOPE PROBLEMS CODE ALREADY FOUND IN THESE COMPETENCIES (do NOT repeat):\n${scopeHits.join("\n")}` : "",
    `COMPETENCIES:\n${comps.map((c) => `${c.code}\n${c.text}`).join("\n\n")}`,
    `Answer the same two questions for every competency above.
Q1 Scope: does any sentence give the ${cadre} a clinical or public-health act outside its authorised scope (per the job description, the SBA guidelines and national programme guidelines)? Taught in the curriculum is not the same as authorised.
Q2 Accuracy: does any sentence state a drug, dose, schedule, cut-off, protocol, law or programme fact that is wrong or outdated for India today?
Flag only what you are sure of. Every flag copies 6–25 consecutive words exactly from the competency into "quote". An empty list is a good answer.`,
    `${JSON_ONLY}\n{"items":[{"code":"","scope":[{"quote":"","act":"","basis":""}],"accuracy":[{"quote":"","issue":"","correct":""}]}]}`].filter(Boolean).join("\n\n");

/** Rules r3 §6.2: the only categories a state-fit item may use; ai-review.service.ts also orders by them. */
export const STATE_CATEGORIES = ["Disease burden", "Delivery and referral", "Language and culture", "State schemes", "Geography and access"] as const;

/** Q3 state fit, only when a state is set (rules §6.2). */
export const reviewStatePrompt = (cadre: string, state: string, serialized: string) =>
  [VIDYA, `Cadre: ${cadre}\nState: ${state}`, `FRAC:\n${serialized}`,
    `Q3 State fit: what is this FRAC missing that is specific to ${state}? Use only these categories: ${STATE_CATEGORIES.join(", ")}. At most 6 items, one sentence each, citing the competency or activity codes it concerns. Mark anything you are unsure of "(verify)".`,
    `${JSON_ONLY}\n{"items":[{"category":"","item":"one sentence","refs":["codes"]}]}`].join("\n\n");
