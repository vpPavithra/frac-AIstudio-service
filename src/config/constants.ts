// Every tunable, read once from process.env (after loadSettings merged config/service.json) into
// frozen groups. Imported by nearly every module; importing it is what loads service.json.
// To add a setting: read it here, add its name to KNOWN_SETTINGS, and add it to config/service.json.
// Do not read process.env for tunables elsewhere. Exceptions: config/db.ts (POSTGRES_* connection)
// and the NODE_ENV overlay lookup in settings.ts / check-config.ts.
import { loadSettings } from "./settings.ts";

loadSettings();

const env = process.env;
// Readers: each falls back to the code default when the value is missing or malformed, never throws
const text = (key: string, fallback: string) => env[key] || fallback;
const num = (key: string, fallback: number) => {
  const value = Number(env[key]);
  return env[key] !== undefined && env[key] !== "" && Number.isFinite(value) ? value : fallback;
};
/** A whole number of at least `min`; anything else falls back (a batch size of 0 would never finish). */
const int = (key: string, fallback: number, min = 1) => {
  const value = num(key, fallback);
  return Number.isInteger(value) && value >= min ? value : fallback;
};
const list = (key: string) =>
  (env[key] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** Process-level settings, used by server.ts. */
export const SERVER = Object.freeze({
  port: num("PORT", 3005),
  /** "memory" runs without Postgres (data lost on restart). */
  store: text("FRAC_STUDIO_STORE", "postgres"),
  /** Apply pending migrations at boot (otherwise run `npm run migrate`, or `node migrate.js` in the image, as a deploy step). */
  migrateOnStart: env.MIGRATE_ON_START === "true",
});

/**
 * Model call policy, shared by every provider. Each SDK retries 408/429/5xx itself (`retries` times).
 * No temperature: the spec's 0.2–0.4 predates these models, which reject sampling settings; the profile's
 * `thinking` level sets thinking depth instead (config/ai-providers.json).
 */
export const LLM = Object.freeze({
  timeoutMs: num("LLM_TIMEOUT_MS", 600_000),
  retries: num("LLM_RETRIES", 3),
  /** Longest answer one call may write (visible answer plus thinking). */
  maxTokens: int("LLM_MAX_TOKENS", 64_000),
  /** A web-search turn can pause (pause_turn); resume it at most this many times. */
  maxResumes: int("LLM_MAX_RESUMES", 3, 0),
  /** Extra attempts when an answer is unreadable or in the wrong shape (askModel); each is billed and logged. */
  invalidRetries: int("LLM_INVALID_RETRIES", 1, 0),
  /** Max wait between SDK retries; a free-tier 429 can ask for tens of seconds. */
  maxRetryDelayMs: int("LLM_MAX_RETRY_DELAY_MS", 60_000),
});

/** Request size limits: upload/JSON body sizes (app.ts, middleware/upload.ts) and array/text caps (validations/). */
export const LIMITS = Object.freeze({
  maxUploadMb: num("MAX_UPLOAD_MB", 15),
  maxJsonMb: num("MAX_JSON_MB", 5),
  /** Longest single text field (activity, description, research note). */
  maxTextChars: num("MAX_TEXT_CHARS", 20_000),
  maxRoles: num("MAX_ROLES", 200),
  maxActivitiesPerRole: num("MAX_ACTIVITIES_PER_ROLE", 200),
  maxCompetencies: num("MAX_COMPETENCIES", 500),
  /** Most postings (Yes/No columns) on a FRAC: a safety limit, not a rule; research keeps as many as the brief names. */
  maxPostings: num("MAX_POSTINGS", 20),
});

/**
 * Documents a team attaches to a FRAC (services/document.service.ts). A job description or government order
 * is reduced to its text, capped, and read by the research step; standard sheets replace an AI step.
 */
export const DOCUMENTS = Object.freeze({
  /** Most characters kept from one brief document, and most sent to research from all of them (about 4 per token). */
  maxChars: int("DOC_MAX_CHARS", 30_000),
  /** Most brief documents on one FRAC. */
  maxBriefFiles: int("DOC_MAX_BRIEF_FILES", 3),
  /** Web searches research may run when the team attached a brief document (the document is the main source). 0 = none. */
  searchesWithDocs: int("RESEARCH_SEARCH_MAX_USES_WITH_DOCS", 1, 0),
});

/** Research source links (services/ai/source-links.ts): checks that an address the model gave really answers. */
export const SOURCE_LINKS = Object.freeze({
  /** Time allowed for one link check, redirects included. */
  checkTimeoutMs: int("SOURCE_LINK_CHECK_TIMEOUT_MS", 3000),
  /** Most link checks in one research run. 0 = keep only pages the web search returned. */
  maxChecks: int("SOURCE_LINK_MAX_CHECKS", 10, 0),
  /** Sites a link may point to besides AI.researchSearchDomains: they host guidelines but are not searched. */
  domains: list("SOURCE_LINK_DOMAINS"),
  /** A searched page is a source's link only when their titles match by more than this (0 to 1); else it is ignored. */
  minTitleMatch: num("SOURCE_LINK_MIN_MATCH", 0.6),
});

/** Stuck-job watchdog (services/job-watchdog.service.ts), started by server.ts. */
const staleAfterMs = num("JOB_STALE_AFTER_MS", 15 * 60_000);
export const JOBS = Object.freeze({
  /** A queued/running job untouched this long is treated as interrupted (e.g. the pod restarted). */
  staleAfterMs,
  /** How often the watchdog looks for such jobs. */
  sweepEveryMs: num("JOB_SWEEP_EVERY_MS", 60_000),
  /**
   * How often a running job touches its row while waiting on a long model call, so the watchdog never takes
   * a live job for a dead one. Kept to at most a third of the stale window whatever the config says.
   */
  heartbeatMs: Math.min(int("JOB_HEARTBEAT_MS", 60_000), Math.floor(staleAfterMs / 3)),
  /**
   * Most billed AI spend one job may reach before it stops with AI_BUDGET_EXCEEDED (0 = no limit). A
   * standard FRAC's dearest step is about $0.40, so this only catches a runaway. Estimates are not counted.
   */
  maxCostUsd: num("JOB_MAX_COST_USD", 3),
});

/** Postgres pool sizing (non-secret; the connection itself comes from POSTGRES_* in the environment, see db.ts). */
export const DB = Object.freeze({
  /** Most connections this process opens; the database is shared with AI Studio and AskMe. */
  poolMax: int("POSTGRES_POOL_MAX", 10),
  /** Give up connecting after this long instead of waiting forever. */
  connectTimeoutMs: int("POSTGRES_CONNECT_TIMEOUT_MS", 10_000),
  /** Close a connection idle this long. */
  idleTimeoutMs: int("POSTGRES_IDLE_TIMEOUT_MS", 30_000),
});

export const CORS = Object.freeze({
  /** Exact origins allowed to call the API from a browser. Empty: only the proxy calls it. */
  origins: list("CORS_ORIGINS"),
});

/** utils/logger.ts: "json" (one object per line, for production) or "pretty"; lines below `level` are dropped. */
export const LOG = Object.freeze({
  format: text("LOG_FORMAT", "pretty") === "json" ? ("json" as const) : ("pretty" as const),
  level: (["debug", "info", "warn", "error"] as const).find((l) => l === env.LOG_LEVEL) ?? ("info" as const),
});

/** Data files read at runtime, relative to the working directory. Override to point at a mounted ConfigMap. */
export const PATHS = Object.freeze({
  outdated: text("OUTDATED_CONFIG_PATH", "config/outdated.json"),
  reviewRules: text("REVIEW_RULES_CONFIG_PATH", "config/review-rules.json"),
  fracSizes: text("FRAC_SIZES_CONFIG_PATH", "config/frac-sizes.json"),
  aiProviders: text("AI_PROVIDERS_CONFIG_PATH", "config/ai-providers.json"),
  methodParagraph: text("METHOD_PARAGRAPH_PATH", "config/method.txt"),
});

/**
 * Which provider the AI steps call: a profile name from config/ai-providers.json (e.g. "claude",
 * "claude"), or "mock" for the sample data in src/mocks. `npm run dev:mock` / `dev:ai` set it per run.
 * The profile names the environment variable holding its key; keys never go in config files.
 */
export const AI = Object.freeze({
  provider: text("AI_PROVIDER", "mock").trim(),
  /** Set by `npm run dev:ai` / `start:ai`: refuse to start on the mock, so an "AI" run can never be sample data. */
  requireReal: env.AI_REQUIRE_REAL === "true",
  /** Spec 5.2 production addition: research may search these government domains (if the profile has webSearch). Off switch for every provider. */
  researchWebSearch: env.RESEARCH_WEB_SEARCH !== "false",
  /** Comma-separated allowed domains for the web_search tool. */
  researchSearchDomains: list("RESEARCH_SEARCH_DOMAINS"),
  /** Most searches one research call may run. */
  researchSearchMaxUses: num("RESEARCH_SEARCH_MAX_USES", 5),
  /** Spec 5.3b / 5.5: roles (activities step) or competencies (ladders step) per model call. */
  stepBatchSize: int("AI_BATCH_SIZE", 4),
  /** Calls in flight at once for the activities and ladders steps. */
  stepParallel: int("AI_BATCH_PARALLEL", 3),
});

/** The AI half of the review (rules r3 §6), used by services/ai-review.service.ts. */
export const REVIEW = Object.freeze({
  /** Competencies per checklist call (rules §6.1: 6). */
  checklistBatchSize: int("REVIEW_BATCH_SIZE", 6),
  /** Checklist calls in flight at once (rules §6.1: 3). */
  checklistParallel: int("REVIEW_BATCH_PARALLEL", 3),
  /** Most state-fit items kept (rules §6.2: 6). */
  maxStateItems: int("REVIEW_MAX_STATE_ITEMS", 6),
  /** A quote shorter than this many words is too weak to verify and is dropped (rules §6.3: 4). */
  minQuoteWords: int("REVIEW_MIN_QUOTE_WORDS", 4),
  /** Reuse stored checklist answers for unchanged competencies (a repeat expert check pays only for changes). */
  reuseAnswers: env.REVIEW_REUSE_ANSWERS !== "false",
});

/** The AI response report (tools/reports/run-ai-report.ts): which clock its days and times are in. */
export const REPORTS = Object.freeze({
  /** Minutes ahead of UTC; 330 = IST. A "day" in the daily report runs midnight to midnight on this clock. */
  utcOffsetMinutes: num("REPORT_UTC_OFFSET_MINUTES", 330),
  /** Billed USD per day above which the report warns (estimates from the mock or a free tier do not count). 0 = off. */
  dailyBudgetUsd: num("REPORT_DAILY_BUDGET_USD", 0),
  /** Providers the reports keep by default (comma list; empty = all). `--provider all` overrides it per run. */
  providers: list("REPORT_PROVIDERS"),
  /** Where `npm run ai:report` writes, relative to the working directory; daily reports go in <dir>/daily. */
  dir: text("REPORT_DIR", "reports"),
});

/** Mock-only settings (src/mocks). Unused when a real provider answers. */
export const MOCK = Object.freeze({
  /** Pause per mock call so progress is visible; 0 in tests. */
  delayMs: num("MOCK_DELAY_MS", 1500),
  /** Memory store only: one finished sample FRAC and review per listed owner at startup. */
  seed: env.MOCK_SEED === "true",
  seedOwners: list("MOCK_SEED_OWNERS").length ? list("MOCK_SEED_OWNERS") : ["local-dev-user"],
  /** The profile whose list prices the mock's cost estimate uses, so it previews the real provider's bill. */
  pricedAs: text("MOCK_PRICED_AS", "claude"),
});

/** Every setting name above, so config:check can reject unknown keys in service.json. */
export const KNOWN_SETTINGS = [
  "PORT", "FRAC_STUDIO_STORE", "MIGRATE_ON_START",
  "LLM_TIMEOUT_MS", "LLM_RETRIES", "LLM_MAX_TOKENS", "LLM_MAX_RESUMES", "LLM_MAX_RETRY_DELAY_MS", "LLM_INVALID_RETRIES",
  "MAX_UPLOAD_MB", "MAX_JSON_MB", "MAX_TEXT_CHARS", "MAX_ROLES", "MAX_ACTIVITIES_PER_ROLE", "MAX_COMPETENCIES", "MAX_POSTINGS",
  "DOC_MAX_CHARS", "DOC_MAX_BRIEF_FILES", "RESEARCH_SEARCH_MAX_USES_WITH_DOCS",
  "SOURCE_LINK_CHECK_TIMEOUT_MS", "SOURCE_LINK_MAX_CHECKS", "SOURCE_LINK_DOMAINS", "SOURCE_LINK_MIN_MATCH",
  "JOB_STALE_AFTER_MS", "JOB_SWEEP_EVERY_MS", "JOB_HEARTBEAT_MS", "JOB_MAX_COST_USD",
  "POSTGRES_POOL_MAX", "POSTGRES_CONNECT_TIMEOUT_MS", "POSTGRES_IDLE_TIMEOUT_MS", "CORS_ORIGINS", "LOG_FORMAT", "LOG_LEVEL",
  "OUTDATED_CONFIG_PATH", "REVIEW_RULES_CONFIG_PATH", "FRAC_SIZES_CONFIG_PATH", "AI_PROVIDERS_CONFIG_PATH", "METHOD_PARAGRAPH_PATH",
  "AI_PROVIDER", "AI_REQUIRE_REAL", "RESEARCH_WEB_SEARCH", "RESEARCH_SEARCH_DOMAINS", "RESEARCH_SEARCH_MAX_USES", "AI_BATCH_SIZE", "AI_BATCH_PARALLEL",
  "REVIEW_BATCH_SIZE", "REVIEW_BATCH_PARALLEL", "REVIEW_MAX_STATE_ITEMS", "REVIEW_MIN_QUOTE_WORDS", "REVIEW_REUSE_ANSWERS",
  "MOCK_DELAY_MS", "MOCK_SEED", "MOCK_SEED_OWNERS", "MOCK_PRICED_AS", "REPORT_UTC_OFFSET_MINUTES", "REPORT_DAILY_BUDGET_USD", "REPORT_DIR", "REPORT_PROVIDERS",
] as const;
