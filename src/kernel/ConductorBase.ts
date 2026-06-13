import { randomUUID } from "crypto";
import { StateStore, ArtifactStore, AuditLog } from "./storage";
import { SSEManager } from "./SSEManager";
import { HITLGate, type GateDecision } from "./HITLGate";
import { logger } from "./logger";
import type { AgentOutput, PipelineState } from "./types";

/**
 * Shared orchestration engine. A product subclasses this and implements
 * `runPipeline()`, composing `runAgent()` (run one agent, broadcast progress)
 * and `gatedStage()` (run an agent then pause at a HITL gate, re-running the
 * agent with rejection context until approved). The conductor registry lets
 * HITL routes resolve the gate of an in-flight run.
 */
export abstract class ConductorBase {
  protected state!: PipelineState;
  private activeGate: HITLGate | null = null;
  protected lastRejectionReason?: string;
  protected lastReviewerCredentials?: string;
  protected readonly maxGateRetries = 4;

  abstract readonly product: string;
  protected abstract runPipeline(rawInput: unknown): Promise<void>;
  protected abstract deriveTitle(rawInput: unknown): string;

  async start(rawInput: unknown): Promise<string> {
    const pipelineId = randomUUID();
    this.state = {
      pipelineId,
      product: this.product,
      title: this.deriveTitle(rawInput),
      currentStage: "idle",
      status: "running",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      artifacts: {},
      gates: [],
      attemptNumbers: {},
      totalCostUsd: 0,
      totalTokens: 0,
    };
    this.save();
    AuditLog.append({ pipelineId, eventType: "pipeline_start", stage: "conductor", message: `Started: ${this.state.title}` });
    SSEManager.broadcast({ type: "pipeline_start", pipelineId, message: this.state.title, timestamp: new Date().toISOString() });

    this.runPipeline(rawInput)
      .then(() => this.complete())
      .catch(err => this.setError((err as Error).message));

    return pipelineId;
  }

  /** Run one agent with progress broadcasts; accumulate cost/token totals. */
  protected async runAgent<T>(stage: string, fn: () => Promise<AgentOutput<T>>): Promise<T> {
    this.transition(stage);
    SSEManager.broadcast({ type: "stage_start", pipelineId: this.state.pipelineId, stage, timestamp: new Date().toISOString() }, this.state.pipelineId);
    try {
      const out = await fn();
      this.state.totalCostUsd += out.costUsd;
      this.state.totalTokens += out.tokensUsed;
      this.save();
      SSEManager.broadcast({ type: "stage_complete", pipelineId: this.state.pipelineId, stage, message: `${out.backend} · ${out.tokensUsed} tok`, timestamp: new Date().toISOString() }, this.state.pipelineId);
      return out.data;
    } catch (err) {
      SSEManager.broadcast({ type: "stage_error", pipelineId: this.state.pipelineId, stage, message: (err as Error).message, timestamp: new Date().toISOString() }, this.state.pipelineId);
      throw err;
    }
  }

  /**
   * Run `agentFn` (which receives rejection context across attempts), persist
   * its output as `artifactName`, then open a HITL gate. On rejection the agent
   * re-runs with the human's feedback; on approval we return the final artifact.
   */
  protected async gatedStage<T>(opts: {
    agentStage: string;
    gateStage: string;
    artifactName: string;
    agentFn: (attempt: number, prior: T | undefined) => Promise<AgentOutput<T>>;
    gatePayload?: (artifact: T) => Record<string, unknown>;
  }): Promise<T> {
    let artifact!: T;
    for (let attempt = 1; attempt <= this.maxGateRetries; attempt++) {
      const out = await this.runAgent(opts.agentStage, () => opts.agentFn(attempt, attempt > 1 ? artifact : undefined));
      artifact = out;
      this.saveArtifact(opts.artifactName, artifact);
      const payload = opts.gatePayload ? opts.gatePayload(artifact) : { artifact };
      const decision = await this.openGate(opts.gateStage, payload);
      if (decision.decision === "approved") return artifact;
      this.logRewind(opts.agentStage, attempt, decision.rejectionReason ?? "rejected");
    }
    logger.warn(`[Conductor] ${opts.gateStage} hit max retries — proceeding with last artifact`);
    return artifact;
  }

  private async openGate(stage: string, payload: unknown): Promise<GateDecision> {
    this.transition(stage);
    this.state.status = "waiting_for_hitl";
    const gate = new HITLGate(stage, this.state.pipelineId);
    this.activeGate = gate;
    this.state.gates.push({ gateId: gate.gateId, stage, openedAt: gate.openedAt });
    this.save();
    SSEManager.broadcast({ type: "hitl_gate_open", pipelineId: this.state.pipelineId, stage, gateId: gate.gateId, data: payload, timestamp: new Date().toISOString() }, this.state.pipelineId);

    const decision = await gate.promise;

    const rec = this.state.gates.find(g => g.gateId === gate.gateId);
    if (rec) { rec.closedAt = decision.decidedAt; rec.decision = decision.decision; rec.rejectionReason = decision.rejectionReason; rec.decidedBy = decision.decidedBy; }
    this.activeGate = null;
    this.state.status = "running";
    this.save();
    SSEManager.broadcast({ type: "hitl_gate_closed", pipelineId: this.state.pipelineId, stage, gateId: gate.gateId, data: { decision: decision.decision, rejectionReason: decision.rejectionReason }, timestamp: new Date().toISOString() }, this.state.pipelineId);

    if (decision.decision === "rejected") {
      this.lastRejectionReason = decision.rejectionReason;
      this.lastReviewerCredentials = decision.reviewerCredentials;
    } else {
      this.lastRejectionReason = undefined;
      this.lastReviewerCredentials = undefined;
    }
    return decision;
  }

  private logRewind(stage: string, attempt: number, reason: string): void {
    logger.warn(`[Conductor] rejected ${stage} (attempt ${attempt}): "${reason}" — re-running`);
    AuditLog.append({ pipelineId: this.state.pipelineId, eventType: "validation_warning", stage, attemptNumber: attempt, message: `Rewind: re-run with rejection context. Reason: "${reason}"` });
    SSEManager.broadcast({ type: "validation_warning", pipelineId: this.state.pipelineId, stage, message: `Attempt ${attempt + 1}: re-running ${stage} after rejection — "${reason}"`, timestamp: new Date().toISOString() }, this.state.pipelineId);
  }

  // ── Gate resolution API used by HITL routes ─────────────────────────────────
  resolveActiveGate(d: GateDecision): boolean {
    if (!this.activeGate || this.activeGate.isSettled) return false;
    this.activeGate.resolve(d);
    return true;
  }
  getActiveGateId(): string | null { return this.activeGate?.gateId ?? null; }
  getState(): PipelineState { return this.state; }
  cancel(): void { this.activeGate?.abort("cancelled by user"); this.setError("Cancelled by user"); }

  // ── Helpers ─────────────────────────────────────────────────────────────────
  protected nextAttempt(stage: string): number {
    this.state.attemptNumbers[stage] = (this.state.attemptNumbers[stage] ?? 0) + 1;
    return this.state.attemptNumbers[stage];
  }
  protected saveArtifact(name: string, data: unknown): void {
    this.state.artifacts[name] = ArtifactStore.write(this.state.pipelineId, name, data);
    this.save();
  }
  private transition(stage: string): void { this.state.currentStage = stage; this.save(); }
  private save(): void { this.state.updatedAt = new Date().toISOString(); StateStore.save(this.state); }

  private complete(): void {
    this.state.currentStage = "complete";
    this.state.status = "complete";
    this.save();
    AuditLog.append({ pipelineId: this.state.pipelineId, eventType: "pipeline_complete", stage: "conductor", message: "Pipeline complete" });
    SSEManager.broadcast({ type: "pipeline_complete", pipelineId: this.state.pipelineId, message: "Pipeline complete", timestamp: new Date().toISOString() }, this.state.pipelineId);
    logger.info(`[Conductor] complete: ${this.state.pipelineId}`);
  }
  protected setError(message: string): void {
    this.state.status = "error";
    this.state.error = message;
    this.save();
    AuditLog.append({ pipelineId: this.state.pipelineId, eventType: "pipeline_error", stage: "conductor", message });
    SSEManager.broadcast({ type: "pipeline_error", pipelineId: this.state.pipelineId, message, timestamp: new Date().toISOString() }, this.state.pipelineId);
  }
}

// ── Active-run registry (in-memory, one conductor per run) ────────────────────
const registry = new Map<string, ConductorBase>();
export function registerConductor(id: string, c: ConductorBase): void { registry.set(id, c); }
export function getConductor(id: string): ConductorBase | undefined { return registry.get(id); }
export function unregisterConductor(id: string): void { registry.delete(id); }
