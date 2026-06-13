/**
 * Product-agnostic orchestration types shared by the kernel. Each product
 * defines its own PipelineStage string-union and artifact shapes on top.
 */

export interface AgentInput<T = unknown> {
  pipelineId: string;
  data: T;
  attemptNumber: number;
  /** Set when a HITL gate rejected the prior attempt — fed back into the prompt. */
  rejectionReason?: string;
  reviewerCredentials?: string;
  priorOutput?: unknown;
}

export interface AgentOutput<T = unknown> {
  agentName: string;
  data: T;
  tokensUsed: number;
  costUsd: number;
  backend: string;
  durationMs: number;
  attemptNumber: number;
}

export type PipelineStatus =
  | "running"
  | "waiting_for_hitl"
  | "complete"
  | "error"
  | "blocked";

export interface HITLGateRecord {
  gateId: string;
  stage: string;
  openedAt: string;
  closedAt?: string;
  decision?: "approved" | "rejected";
  rejectionReason?: string;
  decidedBy?: string;
}

export interface PipelineState {
  pipelineId: string;
  product: string;
  title: string;
  currentStage: string;
  status: PipelineStatus;
  createdAt: string;
  updatedAt: string;
  artifacts: Record<string, string>; // artifactName -> storage path
  gates: HITLGateRecord[];
  attemptNumbers: Record<string, number>;
  totalCostUsd: number;
  totalTokens: number;
  error?: string;
}

export type AuditEventType =
  | "pipeline_start"
  | "agent_run"
  | "stage_error"
  | "gate_opened"
  | "gate_closed"
  | "hitl_decision"
  | "validation_warning"
  | "pipeline_complete"
  | "pipeline_error";

export interface AuditLogEntry {
  pipelineId: string;
  eventType: AuditEventType;
  stage: string;
  agentName?: string;
  attemptNumber?: number;
  inputHash?: string;
  outputHash?: string;
  tokensUsed?: number;
  costUsd?: number;
  backend?: string;
  durationMs?: number;
  gateId?: string;
  decision?: string;
  rejectionReason?: string;
  message?: string;
  timestamp: string;
}
