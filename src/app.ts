// Builds the Express app: request id, access log, security headers, CORS, JSON body parsing,
// GET /health (no auth), then the /v1 API behind requireOwner, and the one error handler last.
// Called by server.ts (and by the API tests) with the services already wired. Reads CORS and
// LIMITS from config/constants.ts. Has no side effects of its own: it does not listen.
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { CORS, LIMITS } from "./config/constants.ts";
import { health } from "./health/health.controller.ts";
import { errorHandler } from "./middleware/errorHandler.ts";
import { requireOwner, USER_ID_HEADER } from "./middleware/auth.ts";
import { requestContextMiddleware } from "./middleware/requestContext.ts";
import { requestLogger } from "./middleware/requestLogger.ts";
import { apiRoutes, type RouteDeps } from "./routes/index.ts";

/**
 * Returns a ready Express app for the given services. Middleware order matters: the request
 * context comes first so every later log line carries the request id, and errorHandler comes last
 * so every thrown ApiError becomes the one `{ error: { code, message } }` body.
 */
export function createApp(deps: RouteDeps): express.Express {
  const app = express();

  app.use(requestContextMiddleware);
  app.use(requestLogger);
  app.use(helmet());
  // Exact-origin allowlist, empty by default: in production only the uiproxy calls this service
  app.use(
    cors({
      origin: CORS.origins.length ? CORS.origins : false,
      allowedHeaders: ["Content-Type", "x-request-id", USER_ID_HEADER],
    }),
  );
  app.use(express.json({ limit: `${LIMITS.maxJsonMb}mb` }));

  app.get("/health", health);
  app.use("/v1", requireOwner, apiRoutes(deps));
  app.use(errorHandler);

  return app;
}
