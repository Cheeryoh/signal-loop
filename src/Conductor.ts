import { ConductorBase } from "./kernel/ConductorBase";
import { SSEManager } from "./kernel/SSEManager";
import {
  SignalIngestorAgent, ThemeClustererAgent, InterventionMapperAgent,
  StoryScoutAgent, PriorityBriefWriterAgent, InterventionDrafterAgent,
} from "./agents";
import type { SignalSet, ThemeMap, InterventionMap, StorySet, PriorityBrief } from "./schemas";

interface RawInput { signalsText: string }

/**
 * Signal Loop pipeline — close the loop from customer signals to education action.
 *
 *  SignalIngestor ───────────────────────────▸ (structure)
 *  ThemeClusterer ────────────────────────────▸ [Gate 1: Friction themes]
 *  InterventionMapper ────────────────────────▸ [Gate 2: Education vs not]
 *  StoryScout ────────────────────────────────▸ (surface success stories)
 *  PriorityBriefWriter → InterventionDrafter ─▸ [Gate 3: Priorities brief + #1 draft]
 */
export class SignalConductor extends ConductorBase {
  readonly product = "signal-loop";

  protected deriveTitle(raw: unknown): string {
    const t = (raw as RawInput).signalsText.trim().replace(/\s+/g, " ");
    return "Signal scan: " + (t.length > 50 ? t.slice(0, 47) + "…" : t);
  }

  protected async runPipeline(raw: unknown): Promise<void> {
    const { signalsText } = raw as RawInput;
    const pid = this.state.pipelineId;

    const signalSet = await this.runAgent<SignalSet>("signal_ingestor", () =>
      new SignalIngestorAgent().run({ pipelineId: pid, data: { signalsText }, attemptNumber: 1 }));
    this.saveArtifact("signal_set", signalSet);

    // ── Gate 1: Friction themes ──────────────────────────────────────────────
    const themeMap = await this.gatedStage<ThemeMap>({
      agentStage: "theme_clusterer",
      gateStage: "gate_themes",
      artifactName: "theme_map",
      agentFn: (attempt, prior) => new ThemeClustererAgent().run({
        pipelineId: pid, data: { signalSet }, attemptNumber: attempt,
        rejectionReason: attempt > 1 ? this.lastRejectionReason : undefined,
        reviewerCredentials: attempt > 1 ? this.lastReviewerCredentials : undefined,
        priorOutput: prior,
      }),
    });

    // ── Gate 2: Intervention mapping (education vs deferred) ──────────────────
    const interventionMap = await this.gatedStage<InterventionMap>({
      agentStage: "intervention_mapper",
      gateStage: "gate_mapping",
      artifactName: "intervention_map",
      agentFn: (attempt, prior) => new InterventionMapperAgent().run({
        pipelineId: pid, data: { themeMap }, attemptNumber: attempt,
        rejectionReason: attempt > 1 ? this.lastRejectionReason : undefined,
        reviewerCredentials: attempt > 1 ? this.lastReviewerCredentials : undefined,
        priorOutput: prior,
      }),
      gatePayload: (m) => {
        SSEManager.broadcast({ type: "validation_warning", pipelineId: pid, stage: "gate_mapping", message: `${m.educationCount} education-addressable, ${m.deferredCount} routed to other teams`, timestamp: new Date().toISOString() }, pid);
        return { interventionMap: m };
      },
    });

    // Surface success stories (no gate — informational input to the brief).
    const stories = await this.runAgent<StorySet>("story_scout", () =>
      new StoryScoutAgent().run({ pipelineId: pid, data: { signalSet }, attemptNumber: 1 }));
    this.saveArtifact("story_set", stories);

    // ── Gate 3: Priorities brief + drafted #1 intervention ───────────────────
    await this.gatedStage<PriorityBrief>({
      agentStage: "priority_brief_writer",
      gateStage: "gate_brief",
      artifactName: "priority_brief",
      agentFn: async (attempt, prior) => {
        const out = await new PriorityBriefWriterAgent().run({
          pipelineId: pid, data: { interventionMap, themeMap, stories }, attemptNumber: attempt,
          rejectionReason: attempt > 1 ? this.lastRejectionReason : undefined,
          reviewerCredentials: attempt > 1 ? this.lastReviewerCredentials : undefined,
          priorOutput: prior,
        });
        const draft = await this.runAgent("intervention_drafter", () =>
          new InterventionDrafterAgent().run({ pipelineId: pid, data: { brief: out.data }, attemptNumber: attempt }));
        this.saveArtifact("drafted_intervention", draft);
        return out;
      },
      gatePayload: (brief) => ({ priorityBrief: brief, critical: true }),
    });
  }
}
