# Signal Loop

**A human-in-the-loop, multi-agent orchestration that turns the firehose of customer signals into a ranked education-priorities brief — and drafts the #1 asset before the meeting even starts.**

This closes the loop the other two products open. Launch Content Studio produces launch assets; Drift Sentinel keeps courses current; **Signal Loop decides what to build next, from evidence.** It takes mixed signals — support tickets, usage telemetry, CS notes, reviews, sales notes — clusters them into friction themes, honestly triages which are education's job versus Product/Pricing/Engineering's, ranks the education-addressable ones, and writes a first draft of the top one.

> Part of a three-product portfolio. See also **[Launch Content Studio](../launch-content-studio)** (launch asset packages) and **[Drift Sentinel](../drift-sentinel)** (product↔course drift).

---

## Why it exists

"Gather customer signals and feedback to continuously improve educational programs" is easy to say and hard to operationalize. The trap is reacting to the loudest ticket instead of the highest-leverage gap — or worse, answering a *product* problem with a webinar. Signal Loop forces the discipline: cluster before reacting, triage before building, rank before drafting. A human signs off at each of those three decisions, so the prioritization stays accountable and the "not education's problem" calls are explicit and routed, not buried.

## The pipeline

```
 SignalIngestor ────────────────────────────▸ (structure)
 ThemeClusterer ─────────────────────────────▸ [Gate 1 · Friction themes]
 InterventionMapper ─────────────────────────▸ [Gate 2 · Education vs deferred]
 StoryScout ─────────────────────────────────▸ (surface success stories)
 PriorityBriefWriter → InterventionDrafter ──▸ [Gate 3 · Priorities brief + #1 draft]
```

| Agent | Role |
|---|---|
| **SignalIngestorAgent** | Mixed signal blob → structured records (source, sentiment, product area) |
| **ThemeClustererAgent** | Signals → 3–6 friction themes with frequency + severity (not one-per-signal) |
| **InterventionMapperAgent** | Each theme → root-cause category + honest "education-addressable?" call + best-fit asset |
| **StoryScoutAgent** | Positive signals → candidate success stories worth amplifying |
| **PriorityBriefWriterAgent** | Education-addressable themes → ranked brief (impact, effort, owner) for leadership |
| **InterventionDrafterAgent** | Writes a ready-to-edit first draft of the #1 priority |

The honesty of the triage step is the point. Mapping a billing complaint to `category: pricing, educationAddressable: false, recommendedAsset: none` — and routing it out — is treated as a correct, valuable answer, not a failure to find work. The reject path lets a human enforce exactly that (the included rejection test pushes a mis-categorized pricing theme back out of education's scope).

## Run it

Requires Node 20+. **No API key needed** — agent calls run through your local `claude` CLI (Max plan) by default; zero API billing.

```bash
npm install
npm run dev          # http://localhost:3000
```

Paste a batch of customer signals (or click an example) and approve/reject each gate.

### LLM backends

| Backend | When | Cost |
|---|---|---|
| `cli` *(default)* | local `claude` CLI present | **none** (Max plan) |
| `api` | `ANTHROPIC_API_KEY` set | API usage |
| `fixture` | `USE_FIXTURES=true` | none — canned outputs for offline/demo/test |

### Test

```bash
npm test            # full pipeline, fixture mode, auto-approve
npm run test:reject # rejects the triage gate once to exercise the rewind path
```

Both assert all six artifacts are produced and the run completes.

## Architecture

Shares the kernel (`src/kernel/`) verbatim with the other two portfolio products: promise-based HITL gates, dual-backend `ClaudeClient`, filesystem persistence under `.data/`, SSE live progress. Only `agents.ts`, `schemas.ts`, `Conductor.ts`, and `public/config.js` are product-specific. See `HANDOFF.md`.

```
src/
  kernel/        shared orchestration engine (identical across products)
  agents.ts      6 product agents
  schemas.ts     Zod artifact schemas
  Conductor.ts   the signal-loop pipeline
  index.ts       wires the conductor into the kernel server
public/          dashboard
fixtures/        canned agent outputs for offline tests
scripts/         testPipeline.ts
```

MIT licensed.
