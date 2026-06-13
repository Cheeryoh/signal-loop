import fs from "fs";
import path from "path";
import crypto from "crypto";
import { logger } from "./logger";
import type { PipelineState, AuditLogEntry } from "./types";

/**
 * Zero-dependency persistence. Everything for a run lives under
 * `.data/<pipelineId>/`:
 *   state.json                  — PipelineState
 *   audit.jsonl                 — append-only audit log
 *   artifacts/<name>.json       — each agent output / gate payload
 *
 * The reference architecture used Supabase; a filesystem store keeps these
 * demos runnable with `npm run dev` and nothing else. The interface mirrors a
 * DB store so swapping in Postgres later is mechanical.
 */

const DATA_ROOT = process.env.DATA_DIR ?? path.join(process.cwd(), ".data");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_NAME = /^[a-zA-Z0-9_-]+$/;

function runDir(pipelineId: string): string {
  if (!UUID.test(pipelineId)) throw new Error(`Invalid pipelineId: ${pipelineId}`);
  return path.join(DATA_ROOT, pipelineId);
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export const StateStore = {
  save(state: PipelineState): void {
    try {
      const dir = runDir(state.pipelineId);
      ensureDir(dir);
      fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(state, null, 2));
    } catch (e) {
      logger.warn(`[StateStore] save failed: ${(e as Error).message}`);
    }
  },
  load(pipelineId: string): PipelineState | null {
    try {
      const f = path.join(runDir(pipelineId), "state.json");
      if (!fs.existsSync(f)) return null;
      return JSON.parse(fs.readFileSync(f, "utf8")) as PipelineState;
    } catch { return null; }
  },
  listAll(): PipelineState[] {
    try {
      if (!fs.existsSync(DATA_ROOT)) return [];
      return fs.readdirSync(DATA_ROOT)
        .map(id => StateStore.load(id))
        .filter((s): s is PipelineState => s !== null)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } catch { return []; }
  },
};

export const ArtifactStore = {
  write(pipelineId: string, name: string, data: unknown): string {
    if (!SAFE_NAME.test(name)) throw new Error(`Invalid artifact name: ${name}`);
    const dir = path.join(runDir(pipelineId), "artifacts");
    ensureDir(dir);
    const file = path.join(dir, `${name}.json`);
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    return file;
  },
  read<T = unknown>(pipelineId: string, name: string): T | null {
    if (!SAFE_NAME.test(name)) return null;
    const file = path.join(runDir(pipelineId), "artifacts", `${name}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  },
  list(pipelineId: string): string[] {
    const dir = path.join(runDir(pipelineId), "artifacts");
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => f.endsWith(".json")).map(f => f.replace(/\.json$/, ""));
  },
};

export const AuditLog = {
  append(entry: Omit<AuditLogEntry, "timestamp">): void {
    try {
      const dir = runDir(entry.pipelineId);
      ensureDir(dir);
      const full: AuditLogEntry = { ...entry, timestamp: new Date().toISOString() };
      fs.appendFileSync(path.join(dir, "audit.jsonl"), JSON.stringify(full) + "\n");
    } catch (e) {
      logger.warn(`[AuditLog] append failed: ${(e as Error).message}`);
    }
  },
  query(pipelineId: string): AuditLogEntry[] {
    try {
      const f = path.join(runDir(pipelineId), "audit.jsonl");
      if (!fs.existsSync(f)) return [];
      return fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l) as AuditLogEntry);
    } catch { return []; }
  },
  hash(data: unknown): string {
    return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0, 16);
  },
};
