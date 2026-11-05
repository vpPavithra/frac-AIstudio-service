// Every tunable, read once from process.env (after loadSettings merged config/service.json) into
// frozen groups. Add a setting here and in config/service.json; never read process.env elsewhere.
import { loadSettings } from "./settings.ts";

loadSettings();

const env = process.env;
const text = (key: string, fallback: string) => env[key] || fallback;
const num = (key: string, fallback: number) => {
  const value = Number(env[key]);
  return env[key] !== undefined && env[key] !== "" && Number.isFinite(value) ? value : fallback;
};
const list = (key: string) =>
  (env[key] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export const SERVER = Object.freeze({
  port: num("PORT", 3005),
  /** "memory" runs without Postgres (data lost on restart). */
  store: text("FRAC_STUDIO_STORE", "postgres"),
  migrateOnStart: env.MIGRATE_ON_START === "true",
});

/** Model ids per spec section 9 tier. Complex: research, roles, competencies, review. */
export const MODELS = Object.freeze({
  complex: text("ANTHROPIC_COMPLEX_MODEL", "claude-sonnet-5-5"),
  default: text("ANTHROPIC_DEFAULT_MODEL", "claude-sonnet-5-5"),
});

/** USD per million tokens, for cost accounting per job. Update with the price list. */
export const RATES = Object.freeze({
  complexInUsdPer1M: num("RATE_COMPLEX_IN_USD_PER_1M", 0),
  complexOutUsdPer1M: num("RATE_COMPLEX_OUT_USD_PER_1M", 0),
  defaultInUsdPer1M: num("RATE_DEFAULT_IN_USD_PER_1M", 0),
  defaultOutUsdPer1M: num("RATE_DEFAULT_OUT_USD_PER_1M", 0),
  complexCacheReadUsdPer1M: num("RATE_COMPLEX_CACHE_READ_USD_PER_1M", 0),
  defaultCacheReadUsdPer1M: num("RATE_DEFAULT_CACHE_READ_USD_PER_1M", 0),
  webSearchUsdPer1K: num("RATE_WEB_SEARCH_USD_PER_1K", 0),
});

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
});

export const LIMITS = Object.freeze({
  maxUploadMb: num("MAX_UPLOAD_MB", 15),
  maxJsonMb: num("MAX_JSON_MB", 5),
  /** Longest single text field (activity, description, research note). */
  maxTextChars: num("MAX_TEXT_CHARS", 20_000),
  maxRoles: num("MAX_ROLES", 200),
  maxActivitiesPerRole: num("MAX_ACTIVITIES_PER_ROLE", 200),
  maxCompetencies: num("MAX_COMPETENCIES", 500),
});

export const JOBS = Object.freeze({
  /** A queued/running job untouched this long is treated as interrupted (e.g. the pod restarted). */
  staleAfterMs: num("JOB_STALE_AFTER_MS", 15 * 60_000),
  sweepEveryMs: num("JOB_SWEEP_EVERY_MS", 60_000),
});

export const CORS = Object.freeze({
  /** Exact origins allowed to call the API from a browser. Empty: only the proxy calls it. */
  origins: list("CORS_ORIGINS"),
});

export const LOG = Object.freeze({
  format: text("LOG_FORMAT", "pretty") === "json" ? ("json" as const) : ("pretty" as const),
  level: (["debug", "info", "warn", "error"] as const).find((l) => l === env.LOG_LEVEL) ?? ("info" as const),
});

export const PATHS = Object.freeze({
  outdated: text("OUTDATED_CONFIG_PATH", "config/outdated.json"),
  reviewRules: text("REVIEW_RULES_CONFIG_PATH", "config/review-rules.json"),
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
  researchSearchDomains: list("RESEARCH_SEARCH_DOMAINS"),
  researchSearchMaxUses: num("RESEARCH_SEARCH_MAX_USES", 5),
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
  "RATE_COMPLEX_CACHE_READ_USD_PER_1M", "RATE_DEFAULT_CACHE_READ_USD_PER_1M", "RATE_WEB_SEARCH_USD_PER_1K",
  "LLM_TIMEOUT_MS", "LLM_RETRIES", "LLM_COMPLEX_EFFORT", "LLM_DEFAULT_EFFORT",
  "MAX_UPLOAD_MB", "MAX_JSON_MB", "MAX_TEXT_CHARS", "MAX_ROLES", "MAX_ACTIVITIES_PER_ROLE", "MAX_COMPETENCIES",
  "JOB_STALE_AFTER_MS", "JOB_SWEEP_EVERY_MS", "CORS_ORIGINS", "LOG_FORMAT", "LOG_LEVEL",
  "OUTDATED_CONFIG_PATH", "REVIEW_RULES_CONFIG_PATH", "METHOD_PARAGRAPH_PATH",
  "AI_PROVIDER", "RESEARCH_WEB_SEARCH", "RESEARCH_SEARCH_DOMAINS", "RESEARCH_SEARCH_MAX_USES",
  "MOCK_DELAY_MS", "MOCK_SEED", "MOCK_SEED_OWNERS",
] as const;
