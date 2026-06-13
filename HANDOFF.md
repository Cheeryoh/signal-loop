# Signal Loop — Developer Handoff

## What it is
HITL multi-agent pipeline: mixed customer signals → friction themes → education-vs-deferred triage → ranked priorities brief + a drafted #1 intervention. 6 agents, 3 human gates. Node 20 + TypeScript + Express + SSE. Filesystem persistence (`.data/`).

## Run / test
```bash
npm install
npm run dev            # PORT default 3000
npm test               # fixture-mode E2E, auto-approve (6 artifacts asserted)
npm run test:reject    # fixture-mode E2E rejecting the triage gate once (rewind)
npx tsc --noEmit
```

## Input
Dashboard sends one `userText` = the signals blob (tickets, telemetry summaries, CS/sales notes, reviews). `SignalIngestor` structures it.

## LLM backend (src/kernel/ClaudeClient.ts)
Priority: `USE_FIXTURES=true` → fixtures · `LLM_BACKEND` override · `ANTHROPIC_API_KEY` → API · else **`claude` CLI** (default, Max plan, no billing).

## Pipeline (src/Conductor.ts)
1. `SignalIngestor` (runAgent) → `signal_set`
2. `ThemeClusterer` → **Gate 1** `theme_map`
3. `InterventionMapper` → **Gate 2** `intervention_map` (broadcasts education vs deferred counts)
4. `StoryScout` (runAgent) → `story_set`
5. `PriorityBriefWriter` (+ `InterventionDrafter` inside the same gated attempt) → **Gate 3** `priority_brief` / `drafted_intervention`

`gatedStage()` re-runs the agent with the human's rejection reason until approved (cap: `maxGateRetries`).

## Design intent: honest triage
`InterventionMapper` is prompted to route non-education themes out (`category: product|pricing|bug`, `educationAddressable: false`, `recommendedAsset: none`) rather than invent education work. `PriorityBriefWriter` excludes deferred themes and names them as out-of-scope in the executive summary. The reject test enforces this by pushing back a mis-categorized pricing theme.

## Key files
| File | Responsibility |
|---|---|
| `src/kernel/ConductorBase.ts` | engine: `runAgent`, `gatedStage`, gate registry |
| `src/kernel/HITLGate.ts` | promise-based gate resolved by HITL routes |
| `src/kernel/BaseAgent.ts` | LLM call + JSON extraction + Zod + retry + audit |
| `src/Conductor.ts` | signal-loop stage/gate sequence |

## Routes
Same kernel routes as the portfolio: `POST /api/pipeline/start` `{userText}`, `/api/pipeline/:id/status`, `/api/pipeline`, `/api/hitl/:id/approve|reject`, `GET /events`, `/report-data/:id`, `/api/audit/:id`, `/health`.

## Extending
Add a Zod schema → add an agent in `agents.ts` → wire into `Conductor.ts` → add stage rows to `public/config.js` → add a `fixtures/<AgentName>.json`.
