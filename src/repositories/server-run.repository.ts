// Storage for server runs (`server_runs` table): a row when the service starts, closed when it stops.
// Written by server.ts, read by tools/reports/run-ai-report.ts. Built by index.ts.
import type { Pool } from "pg";
import type { ServerRun } from "../models/server-run.model.ts";
import { clone, iso } from "./row-helpers.ts";

export interface ServerRunRepository {
  /** Records a start and returns the run id. */
  start(run: Pick<ServerRun, "provider" | "store" | "host" | "pid">): Promise<number>;
  stop(id: number): Promise<void>;
  get(id: number): Promise<ServerRun | null>;
  /** The most recent run, finished or not. */
  latest(): Promise<ServerRun | null>;
}

interface ServerRunRow {
  id: string;
  started_at: Date;
  stopped_at: Date | null;
  provider: string;
  store: string;
  host: string | null;
  pid: number | null;
}

const toRun = (r: ServerRunRow): ServerRun => ({
  // BIGSERIAL comes back as a string
  id: Number(r.id),
  startedAt: iso(r.started_at),
  stoppedAt: r.stopped_at ? iso(r.stopped_at) : null,
  provider: r.provider,
  store: r.store,
  host: r.host,
  pid: r.pid,
});

export class PgServerRunRepository implements ServerRunRepository {
  constructor(private readonly pool: Pool) {}

  async start(run: Pick<ServerRun, "provider" | "store" | "host" | "pid">): Promise<number> {
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO server_runs (provider, store, host, pid) VALUES ($1, $2, $3, $4) RETURNING id`,
      [run.provider, run.store, run.host, run.pid],
    );
    return Number(rows[0].id);
  }

  async stop(id: number): Promise<void> {
    await this.pool.query(`UPDATE server_runs SET stopped_at = now() WHERE id = $1 AND stopped_at IS NULL`, [id]);
  }

  async get(id: number): Promise<ServerRun | null> {
    const { rows } = await this.pool.query<ServerRunRow>(`SELECT * FROM server_runs WHERE id = $1`, [id]);
    return rows[0] ? toRun(rows[0]) : null;
  }

  async latest(): Promise<ServerRun | null> {
    const { rows } = await this.pool.query<ServerRunRow>(`SELECT * FROM server_runs ORDER BY started_at DESC, id DESC LIMIT 1`);
    return rows[0] ? toRun(rows[0]) : null;
  }
}

export class MemoryServerRunRepository implements ServerRunRepository {
  private readonly runs: ServerRun[] = [];

  async start(run: Pick<ServerRun, "provider" | "store" | "host" | "pid">): Promise<number> {
    const id = this.runs.length + 1;
    this.runs.push({ ...run, id, startedAt: new Date().toISOString(), stoppedAt: null });
    return id;
  }

  async stop(id: number): Promise<void> {
    const run = this.runs.find((r) => r.id === id);
    if (run && !run.stoppedAt) run.stoppedAt = new Date().toISOString();
  }

  async get(id: number): Promise<ServerRun | null> {
    const run = this.runs.find((r) => r.id === id);
    return run ? clone(run) : null;
  }

  async latest(): Promise<ServerRun | null> {
    const run = this.runs.at(-1);
    return run ? clone(run) : null;
  }
}
