import cors from "cors";
import express from "express";
import { API_BASE_PATH } from "@/constants/api";
import { attachAuth, bindOperationsPool } from "@/middleware/auth";
import { errorHandler } from "@/middleware/errorHandler";
import v1Routes from "@/routes/v1/index";
import webhooksRoutes from "@/routes/v1/webhooks.routes";
import inboundRoutes from "@/routes/v1/inbound.routes";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: true,
      credentials: true,
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"]
    })
  );

  app.get("/health", (_req, res) => {
    res.json({ ok: true, version: "v1" });
  });

  app.use(
    `${API_BASE_PATH}/webhooks`,
    express.raw({ type: "application/json" }),
    (req, _res, next) => {
      if (Buffer.isBuffer(req.body)) {
        req.body = req.body.toString("utf8");
      }
      next();
    },
    webhooksRoutes
  );

  app.use(
    `${API_BASE_PATH}/inbound`,
    express.json({ limit: "2mb" }),
    express.text({ type: "text/plain", limit: "2mb" }),
    inboundRoutes
  );

  app.use(express.json({ limit: "2mb" }));
  app.use(express.text({ type: "text/plain", limit: "2mb" }));

  app.use(attachAuth);
  app.use(bindOperationsPool);
  app.use(API_BASE_PATH, v1Routes);

  app.use(errorHandler);

  return app;
}
