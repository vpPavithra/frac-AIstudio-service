import express from "express";
import cors from "cors";
import helmet from "helmet";
import { CORS, LIMITS } from "./config/constants.js";
import { health } from "./health/health.controller.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requireOwner, USER_ID_HEADER } from "./middleware/auth.js";
import { requestContextMiddleware } from "./middleware/requestContext.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { apiRoutes, type RouteDeps } from "./routes/index.js";

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
