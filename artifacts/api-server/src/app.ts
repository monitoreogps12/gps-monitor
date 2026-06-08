import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { existsSync } from "fs";
import { join } from "path";
import router from "./routes";
import { logger } from "./lib/logger";
import { startBots } from "./bots";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Serve the admin panel static files when running outside Replit
// (e.g. Render, VPS). In Replit the admin runs on its own port via Vite.
const adminDist = join(process.cwd(), "artifacts/gps-admin/dist/public");
if (existsSync(adminDist)) {
  app.use(express.static(adminDist));
  // SPA fallback — let React Router handle all non-API paths
  app.get("*", (_req, res) => {
    res.sendFile(join(adminDist, "index.html"));
  });
}

// Start Telegram bots (non-blocking)
startBots();

export default app;
