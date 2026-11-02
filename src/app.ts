import express from "express";
import cors from "cors";
import helmet from "helmet";
import { health } from "./health/health.controller.js";
import { errorHandler } from "./middleware/errors.js";
import { requireOwner } from "./middleware/owner.js";
import { apiRoutes, type RouteDeps } from "./routes/routes.js";

export function createApp(deps: RouteDeps): express.Express {
  const app = express();

  app.use(express.json({ limit: "5mb" }));
  app.use(cors());
  app.use(helmet());

  app.get("/health", health);
  app.use("/v1", requireOwner, apiRoutes(deps));
  app.use(errorHandler);

  return app;
}
