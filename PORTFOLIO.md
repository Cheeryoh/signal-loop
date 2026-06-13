# Customer Education Orchestration Portfolio

Three human-in-the-loop, multi-agent orchestrations that optimize the workflows a **Customer Education Program Manager, New Products** owns — built to demonstrate how AI can scale education *alongside* product velocity without giving up the human quality bar.

Each is a standalone, runnable TypeScript application. They share one orchestration kernel and a common design philosophy: **agents draft and check; a human approves or rejects with feedback at every consequential decision; rejection re-runs the responsible agent with that feedback as context.** The pipeline genuinely cannot advance past a gate without a person.

---

## The three products

| | Product | The JD problem it solves | Lifecycle stage |
|---|---|---|---|
| 1 | **[Launch Content Studio](./launch-content-studio)** | "Transform product updates into customer-facing assets — use cases, demos, quickstarts, webinars, adoption guides." Turns a launch brief into a coordinated, channel-consistent marketing & education package. | **Pre-launch** |
| 2 | **[Drift Sentinel](./drift-sentinel)** | "Product/features move faster than L&D can create courses." Detects where shipped product has outrun the catalog, ranks the gap backlog by customer risk, and drafts patch content. | **Maintenance** |
| 3 | **[Signal Loop](./signal-loop)** | "Gather customer signals and feedback to continuously improve educational programs… build feedback loops that connect customer insights to future education priorities." Turns mixed signals into a ranked education-priorities brief + a drafted #1 asset. | **Post-launch feedback** |

Together they cover the full loop: **plan the launch → keep content current → decide what to build next from evidence → (back to launch).**

## Why this shape

The JD's core tension is *speed vs. quality vs. accuracy* in a fast-moving product environment. The answer isn't "let AI write the courses" — it's **repeatable, auditable workflows where AI does the heavy drafting and consistency-checking and a human stays accountable for every judgment that ships.** That's exactly what these orchestrations operationalize:

- **Repeatable programs, not one-offs.** Each product is a fixed agent+gate pipeline you run the same way every launch/release/signal-batch — directly serving "build and scale repeatable education programs" and "design scalable workflows for producing high-quality content."
- **Human-in-the-loop as a first-class primitive.** Gates are promise-based: the conductor awaits a human decision. Reject with a reason (and optional stated expertise) and the agent re-runs, explicitly instructed to change course — an anti-sycophancy loop. This is the "high bar for quality" made mechanical.
- **Honest triage.** Signal Loop will route a pricing complaint *out* of education's scope rather than paper over it with a webinar. Drift Sentinel distinguishes "no course yet" from "a course actively teaches something now wrong." Judgment, not just generation.
- **Auditable.** Every run writes an append-only audit log (agent runs, token/cost, gate decisions, rejection reasons) — the substrate for "measure the effectiveness of education initiatives."

## Shared architecture

```
src/kernel/         ← identical across all three products
  ClaudeClient.ts     dual backend: Max-plan `claude` CLI (default) | Anthropic API | fixtures
  BaseAgent.ts        LLM call + robust JSON extraction + Zod validation + retry + audit
  HITLGate.ts         promise-based human gate (the pipeline awaits a real decision)
  ConductorBase.ts    orchestration engine: runAgent + gatedStage (agent→gate→rewind loop)
  server.ts           Express app factory; all routes parameterized per product
  SSEManager.ts       live progress over Server-Sent Events (replays open gate on reconnect)
  storage.ts          zero-dependency persistence under .data/<pipelineId>/
src/agents.ts       ← per product: the 4–6 agents
src/schemas.ts      ← per product: Zod artifact schemas
src/Conductor.ts    ← per product: the stage + gate sequence
public/config.js    ← per product: dashboard title, examples, stage list
```

**Runs on a Claude Code Max plan with zero API billing.** By default every agent call shells out to the local `claude` CLI (`claude -p --output-format json`). Set `ANTHROPIC_API_KEY` to use the API instead, or `USE_FIXTURES=true` for deterministic offline runs. Verified end-to-end against the real CLI backend (see each repo's `scripts/`).

## Run any of them

```bash
cd launch-content-studio   # or drift-sentinel, signal-loop
npm install
npm run dev                # dashboard at http://localhost:3000
npm test                   # full pipeline, fixture mode, auto-approve
npm run test:reject        # same, with one rejection to exercise the rewind path
```

Built with Claude Code. MIT licensed.
