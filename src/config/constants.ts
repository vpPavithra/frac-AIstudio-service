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
 * Model id per tier (spec 9). Complex: research, roles, competencies, review. Default: activities, ladders.
 * Both tiers currently run Claude Sonnet 5.5; they still differ in effort (LLM) and in billing rates (RATES).
 */
export const MODELS = Object.freeze({
  complex: text("ANTHROPIC_COMPLEX_MODEL", "claude-sonnet-5-5"),
  default: text("ANTHROPIC_DEFAULT_MODEL", "claude-sonnet-5-5"),
});

/**
 * USD per million tokens, for cost accounting per job (providers/text/pricing.ts). Update with the price list.
 * The 0 defaults mean cost shows as $0 until service.json sets real rates.
 */
export const RATES = Object.freeze({
  complexInUsdPer1M: num("RATE_COMPLEX_IN_USD_PER_1M", 0),
  complexOutUsdPer1M: num("RATE_COMPLEX_OUT_USD_PER_1M", 0),
  defaultInUsdPer1M: num("RATE_DEFAULT_IN_USD_PER_1M", 0),
  defaultOutUsdPer1M: num("RATE_DEFAULT_OUT_USD_PER_1M", 0),
  complexCacheReadUsdPer1M: num("RATE_COMPLEX_CACHE_READ_USD_PER_1M", 0),
  defaultCacheReadUsdPer1M: num("RATE_DEFAULT_CACHE_READ_USD_PER_1M", 0),
  webSearchUsdPer1K: num("RATE_WEB_SEARCH_USD_PER_1K", 0),
  /** Cache writes (5-minute TTL) bill at this multiple of the input rate. */
  cacheWriteMultiplier: num("RATE_CACHE_WRITE_MULTIPLIER", 1.25),
});

/** Allowed values for the model's `effort` setting; anything else falls back to the default. */
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORTS)[number];
const effort = (key: string, fallback: Effort): Effort => (EFFORTS as readonly string[]).includes(env[key] ?? "") ? (env[key] as Effort) : fallback;

/**
 * Model call policy. The SDK retries 408/409/429/5xx itself (`retries` times). No temperature: the
 * spec's 0.2–0.4 predates these models, which reject sampling settings; effort sets thinking depth.
 */
export const LLM = Object.freeze({
  timeoutMs: num("LLM_TIMEOUT_MS", 600_000),
  retries: num("LLM_RETRIES", 3),
  complexEffort: effort("LLM_COMPLEX_EFFORT", "high"),
  defaultEffort: effort("LLM_DEFAULT_EFFORT", "medium"),
  /** Longest answer one call may write (visible answer plus thinking). */
  maxTokens: int("LLM_MAX_TOKENS", 64_000),
  /** A web-search turn can pause (pause_turn); resume it at most this many times. */
  maxResumes: int("LLM_MAX_RESUMES", 3, 0),
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
  methodParagraph: text("METHOD_PARAGRAPH_PATH", "config/method.txt"),
});

/**
 * Which provider the AI steps call. "auto" (default): Claude when ANTHROPIC_API_KEY is set, otherwise
 * the sample-data mock in src/mocks (if that folder exists). "claude" / "mock" force one. The key comes
 * from the environment only (.env locally, the secret store on a server), never config/service.json.
 */
const PROVIDERS = ["auto", "claude", "mock"] as const;
export const AI = Object.freeze({
  provider: (PROVIDERS as readonly string[]).includes(text("AI_PROVIDER", "auto")) ? (text("AI_PROVIDER", "auto") as (typeof PROVIDERS)[number]) : "auto",
  apiKey: env.ANTHROPIC_API_KEY ?? "",
  /** Spec 5.2 production addition: the research step may search these government domains. */
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
});

/** Mock-only settings (src/mocks). Unused when Claude is on. */
export const MOCK = Object.freeze({
  /** Pause per mock call so progress is visible; 0 in tests. */
  delayMs: num("MOCK_DELAY_MS", 1500),
  /** Memory store only: one finished sample FRAC and review per listed owner at startup. */
  seed: env.MOCK_SEED === "true",
  seedOwners: list("MOCK_SEED_OWNERS").length ? list("MOCK_SEED_OWNERS") : ["local-dev-user"],
});

/** Every setting name above, so config:check can reject unknown keys in service.json. */
export const KNOWN_SETTINGS = [
  "PORT", "FRAC_STUDIO_STORE", "MIGRATE_ON_START",
  "ANTHROPIC_COMPLEX_MODEL", "ANTHROPIC_DEFAULT_MODEL",
  "RATE_COMPLEX_IN_USD_PER_1M", "RATE_COMPLEX_OUT_USD_PER_1M", "RATE_DEFAULT_IN_USD_PER_1M", "RATE_DEFAULT_OUT_USD_PER_1M",
  "RATE_COMPLEX_CACHE_READ_USD_PER_1M", "RATE_DEFAULT_CACHE_READ_USD_PER_1M", "RATE_WEB_SEARCH_USD_PER_1K", "RATE_CACHE_WRITE_MULTIPLIER",
  "LLM_TIMEOUT_MS", "LLM_RETRIES", "LLM_COMPLEX_EFFORT", "LLM_DEFAULT_EFFORT", "LLM_MAX_TOKENS", "LLM_MAX_RESUMES",
  "MAX_UPLOAD_MB", "MAX_JSON_MB", "MAX_TEXT_CHARS", "MAX_ROLES", "MAX_ACTIVITIES_PER_ROLE", "MAX_COMPETENCIES",
  "JOB_STALE_AFTER_MS", "JOB_SWEEP_EVERY_MS", "JOB_HEARTBEAT_MS",
  "POSTGRES_POOL_MAX", "POSTGRES_CONNECT_TIMEOUT_MS", "POSTGRES_IDLE_TIMEOUT_MS", "CORS_ORIGINS", "LOG_FORMAT", "LOG_LEVEL",
  "OUTDATED_CONFIG_PATH", "REVIEW_RULES_CONFIG_PATH", "FRAC_SIZES_CONFIG_PATH", "METHOD_PARAGRAPH_PATH",
  "AI_PROVIDER", "RESEARCH_WEB_SEARCH", "RESEARCH_SEARCH_DOMAINS", "RESEARCH_SEARCH_MAX_USES", "AI_BATCH_SIZE", "AI_BATCH_PARALLEL",
  "REVIEW_BATCH_SIZE", "REVIEW_BATCH_PARALLEL", "REVIEW_MAX_STATE_ITEMS", "REVIEW_MIN_QUOTE_WORDS",
  "MOCK_DELAY_MS", "MOCK_SEED", "MOCK_SEED_OWNERS",
] as const;
