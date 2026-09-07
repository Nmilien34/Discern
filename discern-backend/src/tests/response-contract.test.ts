// Responses are validated on the way out, and the guarantee is structural.
//
// The asymmetry this closes: the client parses every response against the
// shared schema; the server did not. So a handler that quietly stopped sending
// a field compiled, deployed, and was found on a device.
//
// `sendData` takes the schema as a REQUIRED argument, so a route that forgets
// one does not compile. That is stronger than middleware, which would need a
// route-to-schema table and would silently skip anything missing from it. These
// tests hold the parts the compiler cannot.

import fs from "node:fs";
import path from "node:path";

import express from "express";
import request from "supertest";
import { z } from "zod";
import { afterEach, describe, expect, it } from "vitest";

import { sendData } from "../lib/responses";

const ROUTES = path.join(__dirname, "..", "routes");

const schema = z.object({ ok: z.boolean(), name: z.string() }).strict();

/**
 * Code only. A comment explaining why a thing is banned must not itself trip
 * the sweep that bans it — the price check hit exactly that.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function appSending(value: unknown) {
  const app = express();
  app.get("/t", (_req, res) => {
    sendData(res, schema, value as never);
  });
  // Express 5 forwards a thrown error here; without it a throw is an unhandled
  // rejection rather than a 500 the test can see.
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: { code: "internal", message: err.message } });
  });
  return app;
}

const ORIGINAL_ENV = process.env.NODE_ENV;
afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_ENV;
});

describe("response validation", () => {
  it("sends a conforming body in the { data } envelope", async () => {
    const res = await request(appSending({ ok: true, name: "x" })).get("/t");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { ok: true, name: "x" } });
  });

  it("THROWS in development, so a contract violation is a failing test", async () => {
    const res = await request(appSending({ ok: true })).get("/t");
    expect(res.status).toBe(500);
    expect(res.body.error.message).toContain("does not match its contract");
    // The failing field is named. A violation you have to go looking for is
    // one somebody will not look for.
    expect(res.body.error.message).toContain("name");
  });

  it("catches an EXTRA field too, because the schemas are strict", async () => {
    const res = await request(appSending({ ok: true, name: "x", surprise: 1 })).get("/t");
    expect(res.status).toBe(500);
  });
});

describe("every route sends through a schema", () => {
  it("no sendData call passes a bare object", () => {
    // `sendData(res, {` means the second argument is the value, not a schema —
    // which the compiler already rejects, but this catches it in review too and
    // says why.
    const offenders: string[] = [];
    for (const file of fs.readdirSync(ROUTES).filter((f) => f.endsWith(".ts"))) {
      const source = fs.readFileSync(path.join(ROUTES, file), "utf8");
      if (/sendData\(\s*res\s*,\s*\{/.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("every route file that sends imports at least one schema from shared", () => {
    const offenders: string[] = [];
    for (const file of fs.readdirSync(ROUTES).filter((f) => f.endsWith(".ts"))) {
      const source = fs.readFileSync(path.join(ROUTES, file), "utf8");
      if (!source.includes("sendData(")) continue;
      if (!source.includes('from "@discern/shared"')) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("no schema in shared is loose", () => {
    // `growthArcStepSchema` was `.passthrough()` — the only loose object in the
    // package — and it was found BY ACCIDENT, through a type error, not by
    // anyone looking. A passthrough schema lets a response carry undeclared
    // fields the client parses away and never shows, so nothing fails anywhere
    // and the contract quietly stops describing the traffic.
    //
    // `.strip()` is not banned: it is Zod's default and it removes unknown keys
    // rather than admitting them. It is `.passthrough()` that makes the object
    // open, and `.catchall()` that reopens it a different way.
    const dir = path.join(__dirname, "..", "..", "..", "shared", "src");
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.name.endsWith(".ts")) continue;
        const code = stripComments(fs.readFileSync(full, "utf8"));
        if (/\.(passthrough|catchall)\s*\(/.test(code)) offenders.push(entry.name);
      }
    };
    walk(dir);
    expect(offenders).toEqual([]);
  });

  it("no price ever enters the shared package", () => {
    // SUBSCRIPTION_PRODUCTS was deleted from shared once and must not return.
    // Prices come from StoreKit at runtime; a price here could only ever be a
    // second copy of a number Apple already owns.
    const dir = path.join(__dirname, "..", "..", "..", "shared", "src");
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.name.endsWith(".ts")) continue;
        const code = stripComments(fs.readFileSync(full, "utf8"));
        if (/^\s*(price|priceUsd|amount|cost)\s*:/m.test(code)) offenders.push(entry.name);
        if (/SUBSCRIPTION_PRODUCTS/.test(code)) offenders.push(entry.name);
      }
    };
    walk(dir);
    expect(offenders).toEqual([]);
  });
});
