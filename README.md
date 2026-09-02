# Discern

A Christian app built on one idea: the right words meeting a person in the thing they are
actually going through. Not content on a schedule.

- **Abigail** — a discernment partner who answers the assumption underneath what you said,
  corrects it where it is wrong, and hands you a specific passage to sit with. She points to
  scripture and never speaks on her own authority.
- **The cultivation path** — seven stages, each moving a disposition to its opposite,
  anchored in Colossians 3:5-14 and Ephesians 4:22-24.

`ARCHITECTURE.md` is the single spec document. `CONVENTIONS.md` records the code conventions
extracted from Pepta and Corner at the Phase 0 gate, with every departure marked.

## Layout

```
Discern/
├── discern-backend/     Node + TypeScript + Express. API and worker, one codebase.
├── discern-frontend/    React Native (Expo). Empty until Phase 9.
├── marketing/           untracked
├── design/              untracked
├── ARCHITECTURE.md      the spec
└── CONVENTIONS.md       how the code is written, and why
```

## Status

**Phase 0 complete: scaffold and conventions only.** No feature code has been written. The
backend has its directory tree, `package.json`, and `tsconfig.json`, and nothing else — the
server itself is Phase 1.

`discern-frontend/` is deliberately **not** yet a workspace in the root `package.json`. npm
fails on a workspace directory with no `package.json`, so it is added in Phase 9 when the Expo
app is initialised.

Build order is in `ARCHITECTURE.md` §11. Phase 6 (Abigail) is the product; everything before
it exists to serve it.

## Getting started

```bash
cp .env.example .env     # then fill it in — see the comments in that file
npm install
```

Every `process.env` key read anywhere in the codebase must appear in `.env.example` with a
placeholder and a one-line comment. That file is the complete inventory, not a sample.

### The prompts are not in this repository

`prompts/abigail-system.txt` and `prompts/premise-system.txt` are gitignored, and the
service **refuses to boot without them**. They are not generated and cannot be
reconstructed from this code — the repository ships everything about *how* the prompts are
used and nothing of *what they say*.

```
prompts/
  abigail-system.txt     Abigail's system prompt
  premise-system.txt     the premise pass
```

Locally, put them in `prompts/` at the repository root. On Render, add each as a **Secret
File** using a bare filename — `abigail-system.txt`, `premise-system.txt` — because the
dashboard rejects `/` in the name; they land at the project root, which the loader also
checks. Set `PROMPTS_DIR` only if you mount them somewhere else entirely.

The loader (`discern-backend/src/config/prompts.ts`) reads them once at import, so a missing
or truncated file fails at startup rather than at the first person who talks to her. A short
file is rejected too: an empty Secret File would otherwise boot an Abigail with no
instructions, which answers exactly as confidently as one with them.

If you are picking this repository up without the prompts, everything builds and
`npm test` passes — only Abigail herself will not start.
