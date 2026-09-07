// THE GUARD ON THE LOADED GUN.
//
// The local `.env` resolves to the same Atlas cluster and the same `discern`
// database that Render uses, and `scripts/segment-passages.ts` calls
// `deleteMany`. Running it locally — by a person, or by an agent following an
// instruction that reads perfectly reasonably — deletes real passages and
// orphans every carrying pointing at them. There was nothing in the way.
//
// db/connect.ts already asserts the URI resolved to MONGODB_DB_NAME. That
// protects against connecting to `test` or to a neighbour's database, and does
// exactly nothing here, because the database name is right. It is the same
// database.
//
// WHY A COMMAND-LINE FLAG AND NOT AN ENVIRONMENT VARIABLE. An env var is set
// once and forgotten, and then every subsequent run is unguarded — which is the
// same failure as having no guard, delayed. The flag has to be typed for that
// specific invocation, so the person is making the decision each time.
//
// WHY IT LIVES HERE. One import, so the twelfth script inherits the guard by
// default rather than by somebody remembering. A writing script that forgets to
// call this is the only way back to the original hazard, which is why the test
// asserts every writer imports it.

import { env } from "../config/env";
import { logger } from "./logger";

/** The database the deployed services use. Writing to it is never casual. */
export const PRODUCTION_DB_NAME = "discern";

export const PRODUCTION_OVERRIDE_FLAG = "--i-know-this-is-production";

/**
 * Pure, so the decision is testable without spawning a process.
 *
 * Returns null when the write may proceed, or the refusal message when it may
 * not. The message names the database, because "refused" without the name
 * leaves somebody guessing at exactly the moment they should not be.
 */
export function productionWriteRefusal(
  scriptName: string,
  dbName: string,
  argv: readonly string[],
): string | null {
  if (dbName !== PRODUCTION_DB_NAME) return null;
  if (argv.includes(PRODUCTION_OVERRIDE_FLAG)) return null;

  return [
    "",
    `REFUSED: ${scriptName} writes, and MONGODB_DB_NAME is "${dbName}".`,
    "",
    `  "${dbName}" is the database the deployed API and worker use. Your local`,
    "  .env points at it. A write here is a write to production.",
    "",
    "  If that is genuinely what you want, say so on this run:",
    "",
    `      npx tsx src/scripts/${scriptName} ${PRODUCTION_OVERRIDE_FLAG}`,
    "",
    "  If it is not, point MONGODB_DB_NAME somewhere else first.",
    "",
  ].join("\n");
}

/**
 * Call at the top of any script that writes, BEFORE connecting.
 *
 * Exits rather than throwing: a stack trace in a terminal reads as a crash, and
 * this is a decision the script made on purpose.
 */
export function assertWritable(scriptName: string): void {
  const refusal = productionWriteRefusal(
    scriptName,
    env.MONGODB_DB_NAME,
    process.argv.slice(2),
  );

  if (refusal === null) {
    if (env.MONGODB_DB_NAME === PRODUCTION_DB_NAME) {
      logger.warn(
        { script: scriptName, database: env.MONGODB_DB_NAME },
        "production write explicitly authorised on the command line",
      );
    }
    return;
  }

  process.stderr.write(`${refusal}\n`);
  process.exit(1);
}
