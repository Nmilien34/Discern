// Health checks are quiet, and everything else is not.
//
// /healthz is polled ~17,000 times a day and was the entire content of the
// production logs. The fix has to be narrow in three ways at once: still
// logged, filtered by PATH rather than status, and not applied to anything else.

import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { logger } from "../lib/logger";
import { requestLogger } from "../middleware/request-logger.middleware";

function appWith(path: string, handler: express.RequestHandler) {
  const app = express();
  app.use(requestLogger);
  app.get(path, handler);
  return app;
}

const ok: express.RequestHandler = (_req, res) => {
  res.status(200).json({ ok: true });
};

describe("request logging levels", () => {
  it("logs /healthz at DEBUG, not info", async () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    const debug = vi.spyOn(logger, "debug").mockImplementation(() => undefined);

    await request(appWith("/healthz", ok)).get("/healthz");

    expect(info).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledTimes(1);
    info.mockRestore();
    debug.mockRestore();
  });

  it("STILL LOGS IT — the line exists, it is not silenced", async () => {
    const debug = vi.spyOn(logger, "debug").mockImplementation(() => undefined);
    await request(appWith("/healthz", ok)).get("/healthz");

    const [fields, message] = debug.mock.calls[0] as [Record<string, unknown>, string];
    expect(message).toBe("request completed");
    expect(fields).toMatchObject({ method: "GET", path: "/healthz", status: 200 });
    expect(fields.durationMs).toBeTypeOf("number");
    debug.mockRestore();
  });

  it("carries the user agent, which is what identifies the caller", async () => {
    // Two clients poll /healthz on different intervals and nothing in this
    // repository does it. This field is how that gets answered.
    const debug = vi.spyOn(logger, "debug").mockImplementation(() => undefined);
    await request(appWith("/healthz", ok)).get("/healthz").set("user-agent", "Render/1.0");

    const [fields] = debug.mock.calls[0] as [Record<string, unknown>, string];
    expect(fields.userAgent).toBe("Render/1.0");
    debug.mockRestore();
  });

  it("FILTERS BY PATH, NOT STATUS — a failing health check is still quiet", async () => {
    // The distinction matters. A status filter would have hidden a 500 from
    // /healthz, which is the single most interesting thing that path can do.
    const debug = vi.spyOn(logger, "debug").mockImplementation(() => undefined);
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);

    await request(
      appWith("/healthz", (_req, res) => {
        res.status(500).json({ down: true });
      }),
    ).get("/healthz");

    expect(debug).toHaveBeenCalledTimes(1);
    expect((debug.mock.calls[0] as [Record<string, unknown>, string])[0].status).toBe(500);
    expect(info).not.toHaveBeenCalled();
    debug.mockRestore();
    info.mockRestore();
  });

  it("a query string cannot promote a health check back to info", async () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    const debug = vi.spyOn(logger, "debug").mockImplementation(() => undefined);

    await request(appWith("/healthz", ok)).get("/healthz?probe=1");

    expect(info).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledTimes(1);
    info.mockRestore();
    debug.mockRestore();
  });

  it("EVERY OTHER PATH IS UNCHANGED — still info, still no user agent", async () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    const debug = vi.spyOn(logger, "debug").mockImplementation(() => undefined);

    await request(appWith("/v1/me", ok)).get("/v1/me").set("user-agent", "Discern/1.0");

    expect(debug).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(1);
    const [fields] = info.mock.calls[0] as [Record<string, unknown>, string];
    expect(fields.path).toBe("/v1/me");
    expect("userAgent" in fields).toBe(false);
    info.mockRestore();
    debug.mockRestore();
  });
});
