// App factory. Exported separately from the process entry so tests can build an
// app without binding a port or connecting to Mongo — Pepta's split, via Corner.

import path from "node:path";

import cors from "cors";
import express from "express";
import type { Express } from "express";
import helmet from "helmet";

import { env } from "./config/env";

import { errorHandler, notFoundHandler } from "./middleware/error.middleware";
import { loadUser, requireAuth } from "./middleware/auth.middleware";
import { requireEntitlement } from "./middleware/require-entitlement.middleware";
import { requestLogger } from "./middleware/request-logger.middleware";
import { abigailRouter } from "./routes/abigail.routes";
import { authRouter } from "./routes/auth.routes";
import { bibleRouter } from "./routes/bible.routes";
import { billingRouter } from "./routes/billing.routes";
import { carryingsRouter } from "./routes/carryings.routes";
import { healthRouter } from "./routes/health.routes";
import { journeyRouter } from "./routes/journey.routes";
import { meRouter } from "./routes/me.routes";

export function createApp(): Express {
  const app = express();

  // Middleware order is fixed by CONVENTIONS.md §5.
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(requestLogger);

  // Everything Discern returns is private: what someone is carrying, what they
  // said to Abigail, what stage she named. Nothing here should be cached by an
  // intermediary.
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  // Unversioned. Render's health check is infrastructure, not product API.
  app.use(healthRouter);

  // The product API. Routers mount here as their phases land:
  //   /bible      Phase 2 ✓    /journey, /carryings   Phase 5 ✓
  //   /auth, /me  Phase 4 ✓    /abigail  gate Phase 4 ✓, body Phase 6
  //   /billing    Phase 4 ✓
  const v1 = express.Router();


  // UNGATED: identity and billing must work BEFORE anyone has access, or there
  // is no way to sign in and no way to receive the webhook that grants it.
  v1.use("/auth", authRouter);
  v1.use("/me", meRouter);
  v1.use("/billing", billingRouter);

  // EVERYTHING ELSE IS BEHIND THE TRIAL.
  //
  // ARCHITECTURE.md §10 decision 3 (corrected): there is no free tier. The
  // reader is not a free commodity half — it is part of the product, and one
  // gate applied here is far harder to get wrong than a carve-out per router.
  const gated = [requireAuth, loadUser, requireEntitlement()];

  v1.use("/bible", ...gated, bibleRouter);
  v1.use("/journey", ...gated, journeyRouter);
  v1.use("/carryings", ...gated, carryingsRouter);
  v1.use("/abigail", ...gated, abigailRouter);


  app.use("/v1", v1);

  // THE THROWAWAY TEST CLIENT (TEST_CLIENT_ENABLED, default off).
  //
  // A single static page that talks to this same API. Serving it from here is
  // what makes "open this link on your phone" work at all, and it means the
  // page and the API share an origin — there is no cross-origin request to
  // configure and no reason to widen CORS for it.
  //
  // Deliberately mounted OUTSIDE /v1 and outside the entitlement gate: the page
  // is a shell with no data in it, and every request it makes goes back through
  // /v1 with a Bearer token like any other client. Delete this block, the flag,
  // and public/abigail-test.html when testing ends.
  //
  // helmet's default CSP allows same-origin styles and scripts but not inline
  // ones, and the page is deliberately one file with both. It gets its own
  // relaxed policy rather than a weakening of the app-wide one.
  if (env.TEST_CLIENT_ENABLED) {
    const page = path.resolve(__dirname, "../public/abigail-test.html");

    app.get("/test", (_req, res) => {
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; style-src 'self' 'unsafe-inline'; " +
          "script-src 'self' 'unsafe-inline'; connect-src 'self'; " +
          // Synthesized audio is served from presigned S3 URLs, and the mic
          // produces blob: recordings before upload.
          "media-src 'self' https://*.amazonaws.com blob:",
      );
      // No crawler should index a page that takes people's disclosures.
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      res.sendFile(page);
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
