// ABIGAIL'S PROMPTS. LOADED FROM DISK, DELIBERATELY NOT IN THE REPOSITORY.
//
// The GitHub repository is public. These two texts are the product — the
// system prompt is what makes Abigail answer the assumption underneath what
// someone said instead of the question they asked, and the premise prompt is
// four phases of measurement about when NOT to flag something. Both are
// copy-pasteable in a way that the rest of the service is not.
//
// So the CODE ships and the TEXT does not. `prompts/` is gitignored; the files
// live on the author's disk and, in a deployed environment, arrive as Render
// Secret Files. Everything about how they are used — the schema, the routing,
// the tool loop — stays in the repository where it can be reviewed.
//
// THIS FAILS AT BOOT, NOT AT THE FIRST REQUEST. CONVENTIONS.md §2 puts config
// validation at import time for exactly this reason: a service that starts
// without its prompts is not a degraded Abigail, it is a generic chatbot
// handing out Bible verses to people in distress, and it would look healthy
// while doing it.

import fs from "node:fs";
import path from "node:path";

import { env } from "./env";

/**
 * A prompt shorter than this is a truncated paste or an empty secret file, not
 * a prompt.
 *
 * The real ones are about 7,000 characters. A zero-byte Render Secret File is a
 * genuinely easy mistake to make in a dashboard textarea, and it would boot a
 * silent, instruction-free Abigail rather than erroring — the same failure as a
 * missing file, but harder to see.
 */
const MINIMUM_PLAUSIBLE_LENGTH = 500;

/**
 * Where to look, in order.
 *
 * `PROMPTS_DIR` wins when set. Otherwise both plausible working directories are
 * tried, because `npm start -w @discern/backend` runs from the repository root
 * while most local commands run from `discern-backend/`, and a prompt that
 * loads under one and not the other is a trap.
 */
function candidateDirectories(): string[] {
  if (env.PROMPTS_DIR) return [path.resolve(env.PROMPTS_DIR)];

  return [
    path.resolve(process.cwd(), "prompts"),
    path.resolve(process.cwd(), "..", "prompts"),
    // The working directory itself, and its PARENT.
    //
    // Render Secret Files take a bare filename — the dashboard rejects any "/"
    // — so the files land at the repository root. And `npm start -w
    // @discern/backend` sets cwd to the WORKSPACE directory, not the repo root,
    // so on Render the files sit one level ABOVE cwd:
    //
    //   /opt/render/project/src/abigail-system.txt      <- the files
    //   /opt/render/project/src/discern-backend/        <- cwd
    //
    // Both are checked rather than hardcoding /opt/render/..., which would rot
    // silently the day Render moved it.
    process.cwd(),
    path.resolve(process.cwd(), ".."),
  ];
}

function load(filename: string): string {
  const tried: string[] = [];

  for (const directory of candidateDirectories()) {
    const full = path.join(directory, filename);
    tried.push(full);

    if (!fs.existsSync(full)) continue;

    const contents = fs.readFileSync(full, "utf8").trim();

    if (contents.length < MINIMUM_PLAUSIBLE_LENGTH) {
      throw new Error(
        [
          `Prompt file "${full}" is only ${contents.length} characters.`,
          "",
          "  That is too short to be a real prompt — it is almost certainly an",
          "  empty or truncated Secret File. Refusing to start: an Abigail with",
          "  no instructions still answers, and answers badly, to people who are",
          "  not in a position to notice.",
        ].join("\n"),
      );
    }

    return contents;
  }

  throw new Error(
    [
      `Cannot start: prompt file "${filename}" was not found.`,
      "",
      "  Looked in:",
      ...tried.map((t) => `    ${t}`),
      "",
      "  These files are deliberately NOT in the repository — see",
      "  config/prompts.ts. Supply them one of two ways:",
      "",
      "    local     put them in ./prompts (they are gitignored, not generated)",
      "    Render    add each as a Secret File with a BARE filename (the",
      "              dashboard rejects a \"/\"). They land at the repo root,",
      "              which is checked. PROMPTS_DIR only if mounted elsewhere.",
      "",
      "  If you have lost them, they cannot be regenerated from this repository.",
    ].join("\n"),
  );
}

/** Read once at import. A prompt that changes under a running process is worse. */
export const prompts = {
  /** Abigail's system prompt (ARCHITECTURE.md §7, "Prompt discipline"). */
  abigailSystem: load("abigail-system.txt"),
  /** The premise pass — its own call, one question. */
  premiseSystem: load("premise-system.txt"),
} as const;
