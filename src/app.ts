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
