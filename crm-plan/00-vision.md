# 00 — Vision & Scope

## What we're building

A **full-featured, AI-native CRM for a real-estate investing operation** —
acquisitions (motivated-seller leads) through disposition (buyers) — built to be
operated by one person and their AI, with team support later.

"AI-native" is a design stance, not a chat button bolted on:

1. **The CRM does its own data entry.** Every inbound email, SMS, call
   transcript, web-form fill, and CSV import is parsed by an LLM into structured
   records — contacts, properties, deals, tasks — with the source attached as
   evidence. The human corrects; the human never transcribes.
2. **The CRM works the follow-up.** An AI follow-up agent drafts (and, once
   trusted, sends) replies and sequence touches, qualifies sellers with
   motivation/timeline/price questions, and books appointments — with a
   human-approval queue as the default and per-lead autonomy controls.
3. **The CRM answers questions and takes instructions in English.** "Show me
   sellers in 76107 we haven't touched in 30 days and queue a text to each" is a
   query + bulk action, not a saved-filter scavenger hunt.
4. **Every AI action is auditable.** Drafts, sends, extractions, and scores all
   log what the model saw, what it did, and why. Undo everywhere it's possible.

## Who it's for

- **v1 operator:** a solo DFW real-estate investor (wholesale, fix & flip,
  rental) running seller acquisition campaigns and a buyers list.
- **v2 posture:** small team (2–5 seats: acquisitions manager, dispo, TC) —
  the schema carries `user_id`/roles from day one, but no team UI in v1.
- **Explicit non-goal for v1:** multi-tenant SaaS for other investors. The
  architecture keeps the door open (tenant column, no cross-tenant globals),
  but we do not spend v1 effort on billing, onboarding, or tenant isolation UI.

## Why build instead of buy

Investor CRMs (REsimpli, FreedomSoft, InvestorFuse, …) bundle the right feature
list but: per-seat/per-feature pricing stacks up; AI is mostly bolt-on; data is
theirs, not yours; and none integrate the underwriting engine we already built
(`engine.js` — ARV/comps/max-offer/rehab math, live property-data worker). The
CRM becomes the front half of a pipeline whose back half (underwrite → offer)
already exists and is battle-tested.

## Scope boundaries

**In scope (across all phases):** contact/property/deal management, pipelines,
activity timeline, tasks, two-way SMS + email + calling, campaign sequences
with compliance guardrails, list import + skip tracing, AI intake/enrichment/
assistant/follow-up agent, lead scoring, dispo/buyers module, direct mail,
underwriting integration, KPI reporting, automation builder, PWA mobile.

**Out of scope (v1):** IDX websites, MLS integration, showing management,
transaction-coordination checklists beyond basic deal stages, accounting
(QuickBooks stays QuickBooks), multi-tenant SaaS, native app-store apps.

## Success criteria

The build is succeeding if, at each milestone (see `03-roadmap.md`):

- **M1 (Core CRM):** all leads live in the CRM — no spreadsheet sidecar; any
  record findable in <2s; import of an existing list takes minutes.
- **M2 (Comms):** every seller conversation (SMS/email/call) is in one thread
  per lead, sent from the CRM, with opt-outs handled automatically.
- **M3 (AI layer):** ≥80% of inbound leads reach a fully-populated record with
  zero manual typing; the daily AI digest is the morning starting point.
- **M4 (REI depth):** a lead can go list → skip trace → sequence → appointment
  → underwrite → offer → contract → dispo blast without leaving the app.
- **Operating cost:** infra + AI at solo scale ≤ what one mid-tier investor CRM
  subscription costs (~$300/mo), excluding per-message carrier/data fees.

## Product principles

- **Speed is a feature.** Sub-100ms interactions; optimistic UI; keyboard-first.
- **One thread per human.** All channels collapse into a single conversation
  view per contact — the thing every legacy CRM gets wrong.
- **Trust ladder for AI autonomy.** Draft-only → send-with-approval →
  auto-send-with-audit, configured per action type and per campaign. Never
  auto-send to a lead flagged hot/legal/DNC.
- **Compliance is a platform primitive.** Opt-out state, quiet hours, DNC
  status, and consent provenance live on the contact record and are enforced in
  the send path — not in the UI's good intentions.
- **Own the data.** Nightly full export; every integration replaceable; no
  vendor's schema is our schema.
