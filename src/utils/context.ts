// Per-request context held in AsyncLocalStorage. Filled by middleware/requestContext.ts, read by
// utils/logger.ts, so log calls deep in services still carry the request id.
import { AsyncLocalStorage } from "node:async_hooks";

/** Per-request values every log line can reach without threading them through calls. */
export interface RequestContext {
  reqId: string;
}

/** The store itself. Only middleware/requestContext.ts should call `run`; everyone else uses currentReqId. */
export const requestContext = new AsyncLocalStorage<RequestContext>();

/** The current request id, or undefined outside a request (startup, the job watchdog). */
export function currentReqId(): string | undefined {
  return requestContext.getStore()?.reqId;
}

/** The job a piece of work belongs to. Set by services/queue/job-runner.ts around each job's task. */
export interface JobContext {
  jobId: string;
  kind: string;
}

/** The store itself. Only the job runner should call `run`; everyone else uses currentJob. */
export const jobContext = new AsyncLocalStorage<JobContext>();

/** The running job, or undefined outside one (e.g. npm run ai:check). Used to tag AI call log lines. */
export function currentJob(): JobContext | undefined {
  return jobContext.getStore();
}
