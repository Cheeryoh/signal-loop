import type { Response } from "express";
import { logger } from "./logger";

export type SSEEventType =
  | "pipeline_start" | "stage_start" | "stage_complete" | "stage_error"
  | "hitl_gate_open" | "hitl_gate_closed" | "pipeline_complete"
  | "pipeline_error" | "validation_warning" | "ping";

export interface SSEEvent {
  type: SSEEventType;
  pipelineId?: string;
  stage?: string;
  gateId?: string;
  data?: unknown;
  message?: string;
  timestamp: string;
}

interface Client { id: string; pipelineId?: string; res: Response; }

export class SSEManager {
  private static clients = new Map<string, Client>();
  private static heartbeat: ReturnType<typeof setInterval> | null = null;
  /** Replay the last open-gate event to clients that connect mid-pause. */
  private static activeGate = new Map<string, SSEEvent>();

  static init(): void {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => this.broadcast({ type: "ping", timestamp: new Date().toISOString() }), 15000);
  }

  static addClient(id: string, res: Response, pipelineId?: string): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const client: Client = { id, pipelineId, res };
    this.clients.set(id, client);
    this.send(client, { type: "ping", timestamp: new Date().toISOString() });
    if (pipelineId) {
      const pending = this.activeGate.get(pipelineId);
      if (pending) this.send(client, pending);
    }
    res.on("close", () => this.clients.delete(id));
    logger.debug(`[SSE] client connected: ${id}`, { pipelineId });
  }

  static broadcast(event: SSEEvent, pipelineId?: string): void {
    if (event.type === "hitl_gate_open" && event.pipelineId) this.activeGate.set(event.pipelineId, event);
    else if (["hitl_gate_closed", "pipeline_complete", "pipeline_error"].includes(event.type) && event.pipelineId) {
      this.activeGate.delete(event.pipelineId);
    }
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    const targets = pipelineId
      ? [...this.clients.values()].filter(c => !c.pipelineId || c.pipelineId === pipelineId)
      : [...this.clients.values()];
    for (const c of targets) {
      try { c.res.write(payload); } catch { this.clients.delete(c.id); }
    }
  }

  private static send(c: Client, e: SSEEvent): void {
    try { c.res.write(`data: ${JSON.stringify(e)}\n\n`); } catch { this.clients.delete(c.id); }
  }
}
