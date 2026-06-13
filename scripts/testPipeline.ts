/**
 * End-to-end pipeline test in fixture mode (no API/CLI calls).
 *   ts-node scripts/testPipeline.ts [--reject <gateStage>]
 */
process.env.USE_FIXTURES = "true";
process.env.FIXTURE_DIR = process.env.FIXTURE_DIR ?? require("path").join(process.cwd(), "fixtures");

import { SignalConductor } from "../src/Conductor";
import { ArtifactStore } from "../src/kernel/storage";

const rejectArg = process.argv.indexOf("--reject");
const rejectGate = rejectArg !== -1 ? process.argv[rejectArg + 1] : null;
const rejectedOnce = new Set<string>();

const REQUIRED = ["signal_set", "theme_map", "intervention_map", "story_set", "priority_brief", "drafted_intervention"];

async function main() {
  const conductor = new SignalConductor();
  const pipelineId = await conductor.start({
    signalsText: "Ticket: docs show old chunking but API has 1M context, confusing. Telemetry: 70% of new orgs never make a 2nd call. CS note: Acme replaced their RAG pipeline with long context, big win. Sales: prospect wants proof of reliable prod agents.",
  });
  console.log(`\n▶ pipeline ${pipelineId} started\n`);

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const s = conductor.getState();
    if (s.status === "complete") return finish(conductor, pipelineId, true);
    if (s.status === "error") { console.error(`✗ error: ${s.error}`); return finish(conductor, pipelineId, false); }
    if (s.status === "waiting_for_hitl") {
      const gate = s.currentStage;
      if (rejectGate && gate === rejectGate && !rejectedOnce.has(gate)) {
        rejectedOnce.add(gate);
        console.log(`  ✗ REJECT ${gate} (testing rewind)`);
        conductor.resolveActiveGate({ decision: "rejected", rejectionReason: "The billing-confusion theme is pricing, not education — route it out, don't recommend a webinar.", reviewerCredentials: "CS ops lead", decidedBy: "test", decidedAt: new Date().toISOString() });
      } else {
        console.log(`  ✓ APPROVE ${gate}`);
        conductor.resolveActiveGate({ decision: "approved", decidedBy: "test", decidedAt: new Date().toISOString() });
      }
    }
    await new Promise(r => setTimeout(r, 150));
  }
  console.error("✗ timed out");
  finish(conductor, pipelineId, false);
}

function finish(conductor: SignalConductor, pipelineId: string, ok: boolean) {
  const s = conductor.getState();
  console.log(`\n── result ──`);
  console.log(`status: ${s.status} | stage: ${s.currentStage} | gates: ${s.gates.length} | cost: $${s.totalCostUsd.toFixed(4)}`);
  console.log(`gate decisions: ${s.gates.map(g => `${g.stage}:${g.decision ?? "?"}`).join(", ")}`);
  const missing = REQUIRED.filter(a => ArtifactStore.read(pipelineId, a) === null);
  if (missing.length) { console.error(`✗ missing artifacts: ${missing.join(", ")}`); process.exit(1); }
  if (!ok || s.status !== "complete") { console.error(`✗ did not complete cleanly`); process.exit(1); }
  console.log(`✓ all ${REQUIRED.length} artifacts present; pipeline complete\n`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
