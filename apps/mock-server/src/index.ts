import express, { type Application } from "express";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerContactRoutes } from "./routes/contacts.js";
import { registerRoomRoutes } from "./routes/rooms.js";
import { registerTranscriptRoutes } from "./routes/transcripts.js";
import { registerBillingRoutes } from "./routes/billing.js";
import { registerNotificationRoutes } from "./routes/notifications.js";
import { registerE2eHookRoutes } from "./routes/e2e-hooks.js";

const app: Application = express();
const PORT = Number(process.env["PORT"] ?? 4010);

app.use(express.json());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

const apiRouter = express.Router();

registerAuthRoutes(apiRouter);
registerContactRoutes(apiRouter);
registerRoomRoutes(apiRouter);
registerTranscriptRoutes(apiRouter);
registerBillingRoutes(apiRouter);
registerNotificationRoutes(apiRouter);
registerE2eHookRoutes(apiRouter);

app.use("/api", apiRouter);

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "@trancall/mock-server", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  process.stdout.write(`@trancall/mock-server listening on http://localhost:${PORT}\n`);
});

export default app;
