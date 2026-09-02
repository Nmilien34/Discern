import { Router } from "express";

import { isDatabaseReachable } from "../db/connect";
import { asyncHandler } from "../lib/async-handler";
import { buildInfo } from "../lib/build-info";
import { sendData } from "../lib/responses";

export const healthRouter: Router = Router();

// Unversioned, per CONVENTIONS.md §5 and ARCHITECTURE.md §9 Amendment B:
// Render's health check is infrastructure and does not move with the product API.
healthRouter.get(
  "/healthz",
  asyncHandler(async (_req, res) => {
    const database = isDatabaseReachable();
    const build = buildInfo("discern-api");

    // `commit` and `service` are here so a stale build is one curl away rather
    // than a diagnosis. See lib/build-info.ts.
    sendData(res, {
      status: database ? "ok" : "degraded",
      database,
      service: build.service,
      commit: build.commitShort,
      startedAt: build.startedAt,
    });
  }),
);
