// Identity of the running process.
//
// Answers "what is actually deployed here" without a job probe or a
// discriminator stub. Both entry points report the same shape so the web
// service and the worker can be compared directly — they build from one commit
// but deploy INDEPENDENTLY, and in Corner they drifted apart on 2026-08-28: the
// worker ran current code while the web service served a build two commits
// earlier, returning 501 from handlers that had already been implemented.

import { env } from "../config/env";

/** Process start, so uptime is visible without a separate field. */
const STARTED_AT = new Date().toISOString();

export interface BuildInfo {
  service: string;
  commit: string;
  /** Short form, for eyeballing against `git log --oneline`. */
  commitShort: string;
  startedAt: string;
  nodeEnv: string;
}

export function buildInfo(fallbackService: string): BuildInfo {
  const commit = env.RENDER_GIT_COMMIT ?? "local";
  return {
    // Same precedence as the logger: what we set beats the platform's
    // URL-derived slug, so /healthz reports the name in render.yaml.
    service: env.SERVICE_NAME ?? env.RENDER_SERVICE_NAME ?? fallbackService,
    commit,
    commitShort: commit === "local" ? "local" : commit.slice(0, 7),
    startedAt: STARTED_AT,
    nodeEnv: env.NODE_ENV,
  };
}
