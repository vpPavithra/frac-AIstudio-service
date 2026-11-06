// One run of the service, from start to stop (migrations/007_server_runs.sql). Written by server.ts,
// read by scripts/ai-report.ts for the per-run report (npm run ai:report:run).

export interface ServerRun {
  id: number;
  startedAt: string;
  /** Null while the server is running, or when it crashed without a clean stop. */
  stoppedAt: string | null;
  /** The AI_PROVIDER the run used, e.g. "claude". */
  provider: string;
  /** "postgres" or "memory". */
  store: string;
  host: string | null;
  pid: number | null;
}
