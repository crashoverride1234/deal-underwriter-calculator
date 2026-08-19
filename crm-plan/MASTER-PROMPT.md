# Master Session Prompt

Copy everything below the line, replace `NN` with the chunk number, and paste it
as the first message of a fresh Claude Code session in the CRM repo.

---

We are building an AI-native real-estate CRM by executing a pre-written plan one
chunk per session. This session's job is **chunk NN — and only chunk NN**.

Do these in order:

1. Read `crm-plan/STATE.md` (what exists so far; check the "In progress" section
   first — if this chunk is already partially built, resume from where it stopped
   instead of starting over).
2. Read `crm-plan/chunks/chunk-NN-*.md` (this session's full spec).
3. Read `crm-plan/02-architecture.md` §Conventions (stack, naming, patterns —
   skim the rest only as needed).
4. Build the chunk exactly as specced. If the spec conflicts with reality
   (an API changed, a dependency broke), solve it in the spirit of the spec and
   record the deviation in STATE.md. Do not redesign the architecture.
5. Verify every acceptance criterion in the spec. Run the full test suite.
   Run the app and verify the feature end-to-end in the browser.
6. Update `crm-plan/STATE.md`: mark chunk NN done, list what was built (files,
   routes, tables, env vars), record deviations and decisions, and note anything
   the next chunk needs to know.
7. Commit everything with message `chunk-NN: <short description>`.

Rules:
- Do NOT build features from later chunks, even if they seem easy. Stub exactly
  what the spec says to stub.
- Do NOT refactor previous chunks' code unless the spec says to or it's required
  to make this chunk work (record it in STATE.md if you do).
- Schema changes go in a new migration file, never by editing applied migrations.
- All secrets go in env vars / wrangler secrets — never in code. The repo may
  become public.
- If you finish with budget to spare, spend it on tests and polish for THIS
  chunk, not on the next chunk.
