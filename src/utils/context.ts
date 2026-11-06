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
