import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import path from "path";
import { randomUUID } from "crypto";
import { SSEManager } from "./SSEManager";
import { StateStore, ArtifactStore, AuditLog } from "./storage";
import { getConductor, registerConductor, unregisterConductor, type ConductorBase } from "./ConductorBase";
import { resolveBackend } from "./ClaudeClient";
import { logger } from "./logger";

export interface ServerConfig {
  productName: string;
  /** Factory that returns a fresh conductor for a new run. */
  makeConductor: () => ConductorBase;
  /** Validate + shape the request body into the conductor's raw input. Throw to 400. */
  parseStartBody: (body: unknown) => unknown;
  /** Artifact names exposed by GET /report-data/:id */
  reportArtifacts: string[];
}

export function createApp(cfg: ServerConfig) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(cors());
  app.use(express.json({ limit: "200kb" }));
  app.use(express.static(path.join(process.cwd(), "public")));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, product: cfg.productName, backend: resolveBackend(), time: new Date().toISOString() });
  });

  // ── Start a run ─────────────────────────────────────────────────────────────
  app.post("/api/pipeline/start", async (req: Request, res: Response) => {
    let rawInput: unknown;
    try { rawInput = cfg.parseStartBody(req.body); }
    catch (e) { res.status(400).json({ error: (e as Error).message }); return; }

    const conductor = cfg.makeConductor();
    const pipelineId = await conductor.start(rawInput);
    registerConductor(pipelineId, conductor);
    res.json({ pipelineId, message: "Pipeline started" });
  });

  // ── Status / list ─────────────────────────────────────────────────────────────
  app.get("/api/pipeline/:id/status", (req: Request, res: Response) => {
    const id = String(req.params.id);
    const live = getConductor(id);
    if (live) { res.json(live.getState()); return; }
    const state = StateStore.load(id);
    if (!state) { res.status(404).json({ error: "Pipeline not found" }); return; }
    res.json(state);
  });

  app.get("/api/pipeline", (_req: Request, res: Response) => {
    res.json(StateStore.listAll().map(s => ({
      pipelineId: s.pipelineId, title: s.title, status: s.status,
      currentStage: s.currentStage, createdAt: s.createdAt, updatedAt: s.updatedAt,
      totalCostUsd: s.totalCostUsd,
    })));
  });

  app.post("/api/pipeline/:id/cancel", (req: Request, res: Response) => {
    const id = String(req.params.id);
    const c = getConductor(id);
    if (!c) { res.status(404).json({ error: "Pipeline not active" }); return; }
    const s = c.getState();
    if (s.status === "complete" || s.status === "error") { res.json({ ok: true, skipped: true }); return; }
    c.cancel(); unregisterConductor(id);
    res.json({ ok: true });
  });

  // ── HITL ─────────────────────────────────────────────────────────────────────
  app.post("/api/hitl/:id/approve", (req: Request, res: Response) => {
    const c = getConductor(String(req.params.id));
    if (!c) { res.status(404).json({ error: "Pipeline not active" }); return; }
    if (c.getState().status !== "waiting_for_hitl") { res.status(409).json({ error: "Not waiting for HITL", status: c.getState().status }); return; }
    const body = req.body as { decidedBy?: string; reviewerCredentials?: string };
    const gateId = c.getActiveGateId();
    const ok = c.resolveActiveGate({ decision: "approved", reviewerCredentials: body.reviewerCredentials, decidedBy: body.decidedBy ?? "human", decidedAt: new Date().toISOString() });
    if (!ok) { res.status(409).json({ error: "No active gate" }); return; }
    res.json({ message: "Approved", gateId });
  });

  app.post("/api/hitl/:id/reject", (req: Request, res: Response) => {
    const c = getConductor(String(req.params.id));
    if (!c) { res.status(404).json({ error: "Pipeline not active" }); return; }
    if (c.getState().status !== "waiting_for_hitl") { res.status(409).json({ error: "Not waiting for HITL", status: c.getState().status }); return; }
    const body = req.body as { rejectionReason?: string; reviewerCredentials?: string; decidedBy?: string };
    const gateId = c.getActiveGateId();
    const ok = c.resolveActiveGate({ decision: "rejected", rejectionReason: body.rejectionReason ?? "No reason provided", reviewerCredentials: body.reviewerCredentials, decidedBy: body.decidedBy ?? "human", decidedAt: new Date().toISOString() });
    if (!ok) { res.status(409).json({ error: "No active gate" }); return; }
    res.json({ message: "Rejected", gateId });
  });

  // ── Report data + audit ────────────────────────────────────────────────────
  app.get("/report-data/:id", (req: Request, res: Response) => {
    const id = String(req.params.id);
    const artifacts: Record<string, unknown> = {};
    for (const name of cfg.reportArtifacts) artifacts[name] = ArtifactStore.read(id, name);
    res.json({ pipelineId: id, state: StateStore.load(id), artifacts });
  });

  app.get("/api/audit/:id", (req: Request, res: Response) => {
    res.json(AuditLog.query(String(req.params.id)));
  });

  // ── SSE ──────────────────────────────────────────────────────────────────────
  app.get("/events", (req: Request, res: Response) => {
    const pipelineId = typeof req.query.pipelineId === "string" ? req.query.pipelineId : undefined;
    SSEManager.addClient(randomUUID(), res, pipelineId);
  });

  // SPA fallback
  app.get("/{*splat}", (_req, res) => res.sendFile(path.join(process.cwd(), "public", "index.html")));

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error(`Unhandled: ${err.message}`);
    res.status(500).json({ error: "Internal server error", detail: err.message });
  });

  SSEManager.init();
  return app;
}
