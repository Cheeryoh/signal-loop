import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { logger } from "./logger";

/**
 * Dual-backend LLM client.
 *
 * The orchestration is designed to run on a Claude Code **Max plan** with zero
 * API billing: by default every agent call shells out to the local `claude`
 * CLI (`claude -p --output-format json`) and reads the `.result` field. If an
 * `ANTHROPIC_API_KEY` is present the client uses the Anthropic SDK instead, and
 * `USE_FIXTURES=true` short-circuits to canned JSON so the pipeline can be
 * tested end-to-end offline, deterministically, for free.
 *
 * Backend selection (highest priority first):
 *   1. USE_FIXTURES=true        → FixtureBackend (reads fixtures/<AgentName>.json)
 *   2. LLM_BACKEND env override  → "cli" | "api" | "fixture"
 *   3. ANTHROPIC_API_KEY set     → ApiBackend
 *   4. otherwise                 → CliBackend  (Max-plan default)
 */

export type Backend = "cli" | "api" | "fixture";

export interface CompletionRequest {
  prompt: string;
  agentName: string;
  maxTokens?: number;
}

export interface CompletionResult {
  text: string;
  backend: Backend;
  tokensUsed: number;
  costUsd: number;
}

export function resolveBackend(): Backend {
  if (process.env.USE_FIXTURES === "true") return "fixture";
  const override = process.env.LLM_BACKEND as Backend | undefined;
  if (override === "cli" || override === "api" || override === "fixture") return override;
  if (process.env.ANTHROPIC_API_KEY) return "api";
  return "cli";
}

/**
 * Resolve the `claude` executable. The npm global bin dir is not always on the
 * shell PATH that a spawned process inherits (notably on Windows), so we look
 * for the platform-specific binary explicitly, with a `CLAUDE_BIN` override.
 */
function resolveClaudeBin(): string {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData) {
      const cmd = path.join(appData, "npm", "claude.cmd");
      if (fs.existsSync(cmd)) return cmd;
    }
  }
  return "claude";
}

// ── CLI backend — leverages the Max-plan `claude` binary, no API billing ──────
async function cliComplete(req: CompletionRequest): Promise<CompletionResult> {
  const model = process.env.CLAUDE_MODEL; // optional, e.g. claude-haiku-4-5-20251001
  const args = ["-p", "--output-format", "json"];
  if (model) args.push("--model", model);
  const bin = resolveClaudeBin();
  const useShell = process.platform === "win32";
  // Under shell:true the command line is concatenated, so a path containing
  // spaces (e.g. "C:\Users\Justin O\...") must be quoted or cmd splits on it.
  const spawnBin = useShell && /\s/.test(bin) ? `"${bin}"` : bin;

  return new Promise<CompletionResult>((resolve, reject) => {
    const child = spawn(spawnBin, args, { stdio: ["pipe", "pipe", "pipe"], shell: useShell });
    let stdout = "";
    let stderr = "";
    const timeoutMs = Number(process.env.CLI_TIMEOUT_MS ?? 180_000);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`claude CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", d => (stdout += d.toString()));
    child.stderr.on("data", d => (stderr += d.toString()));
    child.on("error", err => { clearTimeout(timer); reject(err); });
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude CLI exited ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        if (parsed.is_error) { reject(new Error(`claude CLI reported error: ${parsed.result}`)); return; }
        const usage = parsed.usage ?? {};
        resolve({
          text: parsed.result ?? "",
          backend: "cli",
          tokensUsed: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
          costUsd: parsed.total_cost_usd ?? 0,
        });
      } catch (e) {
        reject(new Error(`Failed to parse claude CLI JSON: ${(e as Error).message}. Raw: ${stdout.slice(0, 300)}`));
      }
    });

    child.stdin.write(req.prompt);
    child.stdin.end();
  });
}

// ── API backend — Anthropic SDK, used when ANTHROPIC_API_KEY is present ───────
let _anthropic: unknown = null;
async function apiComplete(req: CompletionRequest): Promise<CompletionResult> {
  if (!_anthropic) {
    // Lazy import so the SDK is optional when running CLI/fixture mode.
    const mod = await import("@anthropic-ai/sdk").catch(() => null);
    if (!mod) throw new Error("ANTHROPIC_API_KEY set but @anthropic-ai/sdk is not installed");
    const Anthropic = mod.default;
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = _anthropic as any;
  const model = process.env.CLAUDE_MODEL ?? "claude-haiku-4-5-20251001";
  const stream = client.messages.stream({
    model,
    max_tokens: req.maxTokens ?? 16000,
    messages: [{ role: "user", content: req.prompt }],
  });
  const msg = await stream.finalMessage();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text = (msg.content as any[]).filter(b => b.type === "text").map(b => b.text).join("");
  const usage = msg.usage ?? {};
  return { text, backend: "api", tokensUsed: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0), costUsd: 0 };
}

// ── Fixture backend — deterministic, offline, free ────────────────────────────
function fixtureComplete(req: CompletionRequest): CompletionResult {
  const dir = process.env.FIXTURE_DIR ?? path.join(process.cwd(), "fixtures");
  const file = path.join(dir, `${req.agentName}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`Fixture missing for ${req.agentName} at ${file}`);
  }
  const text = fs.readFileSync(file, "utf8");
  return { text, backend: "fixture", tokensUsed: 0, costUsd: 0 };
}

export async function complete(req: CompletionRequest): Promise<CompletionResult> {
  const backend = resolveBackend();
  logger.debug(`[ClaudeClient] ${req.agentName} via ${backend} backend`);
  switch (backend) {
    case "fixture": return fixtureComplete(req);
    case "api": return apiComplete(req);
    case "cli": return cliComplete(req);
  }
}
