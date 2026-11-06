// Storage for the per-call AI log (`ai_calls` table). Written by services/queue/job-runner.ts after each
// model call, read by scripts/ai-report.ts. Built by index.ts. Insert-only: rows are never updated.
import type { Pool } from "pg";
import type { AiCall } from "../models/ai-call.model.ts";
import { clone, iso } from "./row-helpers.ts";

export interface AiCallRepository {
  insert(call: AiCall): Promise<void>;
  /** Every call made at or after `since`, oldest first. */
  listSince(since: Date): Promise<AiCall[]>;
}

interface AiCallRow {
  job_id: string | null;
  job_kind: string | null;
  provider: string;
  model: string;
  task: string;
  tier: string;
  outcome: string;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  web_searches: number;
  cost_usd: string;
  estimated: boolean;
  created_at: Date;
}

const fromRow = (r: AiCallRow): AiCall => ({
  jobId: r.job_id,
  jobKind: r.job_kind,
  provider: r.provider,
  model: r.model,
  task: r.task,
  tier: r.tier,
  outcome: r.outcome,
  latencyMs: r.latency_ms,
  inputTokens: r.input_tokens,
  outputTokens: r.output_tokens,
  cacheReadTokens: r.cache_read_tokens,
  webSearches: r.web_searches,
  // NUMERIC comes back from pg as a string
  costUsd: Number(r.cost_usd),
  estimated: r.estimated,
  createdAt: iso(r.created_at),
});

export class PgAiCallRepository implements AiCallRepository {
  constructor(private readonly pool: Pool) {}

  async insert(c: AiCall): Promise<void> {
    await this.pool.query(
      `INSERT INTO ai_calls (job_id, job_kind, provider, model, task, tier, outcome, latency_ms, input_tokens, output_tokens,
         cache_read_tokens, web_searches, cost_usd, estimated, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [c.jobId, c.jobKind, c.provider, c.model, c.task, c.tier, c.outcome, c.latencyMs, c.inputTokens, c.outputTokens,
        c.cacheReadTokens, c.webSearches, c.costUsd, c.estimated, c.createdAt],
    );
  }

  async listSince(since: Date): Promise<AiCall[]> {
    const { rows } = await this.pool.query<AiCallRow>(`SELECT * FROM ai_calls WHERE created_at >= $1 ORDER BY created_at, id`, [since]);
    return rows.map(fromRow);
  }
}

export class MemoryAiCallRepository implements AiCallRepository {
  private readonly calls: AiCall[] = [];

  async insert(call: AiCall): Promise<void> {
    this.calls.push(clone(call));
  }

  async listSince(since: Date): Promise<AiCall[]> {
    return this.calls.filter((c) => new Date(c.createdAt) >= since).map(clone);
  }
}
