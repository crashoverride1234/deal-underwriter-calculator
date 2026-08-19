# Build State

> Living document. Every build session updates this file before committing.
> This is the ONLY memory between sessions — if it's not here or in the code,
> the next session doesn't know it.

## Current status

**Nothing built yet.** The CRM repo has not been created. Chunk 01 creates it.

## In progress

_(empty — no chunk is mid-flight)_

## Completed chunks

_(none yet)_

<!-- Template for completed-chunk entries — copy, fill, prepend newest-first:

### chunk-NN: <title> — YYYY-MM-DD
- **Built:** <files created/modified, routes added, tables/migrations, UI pages>
- **Env/secrets added:** <names only, never values>
- **Deviations from spec:** <what and why, or "none">
- **Next chunk needs to know:** <gotchas, decisions, stub locations>
-->

## Standing decisions & deviations log

_(architecture-level decisions made during the build that differ from or refine
`02-architecture.md` — newest first)_

## Environment / accounts checklist

Track external-account setup here as chunks require them (mark when done):

- [ ] CRM GitHub repo created
- [ ] Cloudflare account: Workers, D1, Queues, Vectorize, R2 enabled
- [ ] Anthropic API key (Claude)
- [ ] Twilio account + A2P 10DLC brand/campaign registration (long lead time — start early, see chunk spec)
- [ ] Email sending domain + provider account
- [ ] Skip-trace provider account
- [ ] DNC scrub provider account
