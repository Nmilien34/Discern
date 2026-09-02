import request from "supertest";
import { describe, expect, it } from "vitest";

import { healthResponseSchema } from "@discern/shared";

import { createApp } from "../app";

const app = createApp();

describe("GET /healthz", () => {
  it("answers with the shared health contract", async () => {
    const response = await request(app).get("/healthz");

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("data");

    // Parsed against the contract in @discern/shared, so a drift between what
    // the API sends and what the app expects fails here rather than in the app.
    const parsed = healthResponseSchema.safeParse(response.body.data);
    expect(parsed.success).toBe(true);
  });

  it("reports degraded when mongo is not connected", async () => {
    // No connectToDatabase() in this suite: createApp() deliberately does not
    // connect, which is the point of splitting the factory from the entry.
    const response = await request(app).get("/healthz");

    expect(response.body.data.database).toBe(false);
    expect(response.body.data.status).toBe("degraded");
  });

  it("reports the running commit so a stale build is one curl away", async () => {
    const response = await request(app).get("/healthz");

    expect(response.body.data.commit).toBe("local");
    expect(response.body.data.service).toBe("discern-api");
  });

  it("echoes an inbound x-request-id", async () => {
    const response = await request(app)
      .get("/healthz")
      .set("x-request-id", "abc-123");

    expect(response.headers["x-request-id"]).toBe("abc-123");
  });
});

describe("unmatched routes", () => {
  it("return the standard error envelope, not an express default", async () => {
    const response = await request(app).get("/v1/nope");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("not_found");
    expect(response.body.error.message).toContain("/v1/nope");
  });
});
