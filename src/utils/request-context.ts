import { AsyncLocalStorage } from "node:async_hooks";

/** Per-request values every log line can reach without threading them through calls. */
export interface RequestContext {
  reqId: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

/** The current request id, or undefined outside a request (startup, the job watchdog). */
export function currentReqId(): string | undefined {
  return requestContext.getStore()?.reqId;
}
