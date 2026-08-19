# AI-Native Real Estate CRM — Build Plan

This folder is the complete, executable plan for building an AI-native real-estate
CRM from scratch. It is designed to be executed **one chunk per Claude Code
session**, so no single session ever needs more context than one chunk spec plus
the living state file.

## What's in here

| File | Purpose |
|---|---|
| `00-vision.md` | Product vision, who it's for, scope, success criteria |
| `01-market-research.md` | Feature review of the best CRMs (investor, agent, general, AI-native) + canonical feature matrix with priorities |
| `02-architecture.md` | Tech stack decision, data model, AI layer design, integrations, compliance |
| `03-roadmap.md` | Phases, chunk list, dependency graph, milestone demos |
| `chunks/chunk-NN-*.md` | One self-contained build spec per session |
| `MASTER-PROMPT.md` | The prompt you paste to start every build session |
| `STATE.md` | Living "what's built so far" doc — updated at the end of every chunk |

## How to execute this plan (the session protocol)

The whole point of the chunking is that **each chunk fits comfortably in one
Claude Code session** and no session depends on chat history from a previous one.
All cross-session memory lives in files in the repo.

### Starting a session

1. Open a fresh Claude Code session in the CRM repo.
2. Paste the contents of `MASTER-PROMPT.md`, filling in the chunk number.
3. Claude reads `STATE.md`, the chunk spec, and `02-architecture.md`, then builds.

### Ending a session (Definition of Done — every chunk)

A chunk is done only when ALL of these hold:

- [ ] Every acceptance criterion in the chunk spec passes.
- [ ] Tests written for the chunk pass (`npm test`), and all previous tests still pass.
- [ ] The app runs locally with the new feature working end-to-end in the browser.
- [ ] `STATE.md` is updated: what was built, key file paths, schema changes,
      decisions made that deviate from the spec (with reasons), and anything the
      next chunk needs to know.
- [ ] Work is committed with a message like `chunk-07: two-way SMS inbox`.

### If a session runs out of context mid-chunk

Commit what compiles, write a `STATE.md` entry under "In progress" describing
exactly where you stopped and what remains, and start a fresh session with the
same chunk number. The master prompt tells Claude to check for an "In progress"
entry first.

### Rules that hold across all chunks

- **Never build ahead.** If a chunk spec says "stub this for now," stub it.
  Later chunks depend on the stubs being where the spec says they are.
- **Never skip STATE.md.** It is the only memory between sessions.
- **Schema changes are migrations.** Never edit an applied migration; add a new one.
- **Every chunk ships something demoable.** If you can't show it working in the
  browser (or via a test for pure-backend chunks), it's not done.
- **Compliance guardrails are not optional.** Opt-out handling, quiet hours, and
  DNC checks ship WITH the messaging features, not after them.

## Order of execution

Chunks are numbered in dependency order — execute them in order unless
`03-roadmap.md` marks them as parallel-safe. The roadmap has the full
dependency graph and the milestone demos (working checkpoints where the app is
genuinely usable, so you get value long before the plan is finished).
