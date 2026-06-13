import { randomUUID } from "crypto";
import { AuditLog } from "./storage";
import { logger } from "./logger";

export interface GateDecision {
  decision: "approved" | "rejected";
  rejectionReason?: string;
  reviewerCredentials?: string;
  decidedBy?: string;
  decidedAt: string;
}

/**
 * A promise-based human-in-the-loop gate. The conductor `await`s `.promise`,
 * which stays pending until a human resolves it via the HITL route. This is the
 * mechanism that makes the orchestration genuinely human-in-the-loop rather
 * than human-on-the-loop: the pipeline cannot advance past a gate without an
 * explicit decision.
 */
export class HITLGate {
  readonly gateId: string;
  readonly openedAt: string;
  readonly promise: Promise<GateDecision>;
  private _resolve!: (d: GateDecision) => void;
  private _reject!: (e: Error) => void;
  private _settled = false;

  constructor(readonly stage: string, readonly pipelineId: string) {
    this.gateId = `gate-${stage}-${randomUUID().slice(0, 8)}`;
    this.openedAt = new Date().toISOString();
    this.promise = new Promise<GateDecision>((res, rej) => { this._resolve = res; this._reject = rej; });
    AuditLog.append({ pipelineId, eventType: "gate_opened", stage, gateId: this.gateId, message: `Gate opened for ${stage}` });
    logger.info(`[HITLGate] opened ${this.gateId}`);
  }

  resolve(d: GateDecision): void {
    if (this._settled) { logger.warn(`[HITLGate] already settled: ${this.gateId}`); return; }
    this._settled = true;
    AuditLog.append({
      pipelineId: this.pipelineId, eventType: "hitl_decision", stage: this.stage, gateId: this.gateId,
      decision: d.decision, rejectionReason: d.rejectionReason,
      message: `Human ${d.decision}${d.reviewerCredentials ? ` [${d.reviewerCredentials}]` : ""}${d.rejectionReason ? ` — "${d.rejectionReason}"` : ""}`,
    });
    logger.info(`[HITLGate] resolved ${this.gateId} — ${d.decision}`);
    this._resolve(d);
  }

  abort(reason: string): void {
    if (this._settled) return;
    this._settled = true;
    this._reject(new Error(`Gate aborted: ${reason}`));
  }

  get isSettled(): boolean { return this._settled; }
}
