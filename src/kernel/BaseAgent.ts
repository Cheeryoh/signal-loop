import type { ZodType } from "zod";
import { complete } from "./ClaudeClient";
import { AuditLog } from "./storage";
import { logger } from "./logger";
import { buildRejectionContext } from "./promptBuilder";
import type { AgentInput, AgentOutput } from "./types";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 800;

/**
 * Base class every product agent extends. Handles the LLM call (via the
 * dual-backend ClaudeClient), robust JSON extraction, Zod validation with
 * retry, rejection-context injection, and audit logging. Subclasses implement
 * only `buildPrompt` and declare their output schema.
 */
export abstract class BaseAgent<TInput, TOutput> {
  abstract readonly agentName: string;
  protected schema: ZodType<TOutput> | null = null;
  /** Optional system-role preamble prepended to every prompt for this agent. */
  protected role = "";

  protected abstract buildPrompt(input: AgentInput<TInput>): string;

  async run(input: AgentInput<TInput>): Promise<AgentOutput<TOutput>> {
    const start = Date.now();
    let lastErr: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const prompt = this.assemble(input);
        logger.info(`[${this.agentName}] attempt ${attempt}`, { pipelineId: input.pipelineId });

        const res = await complete({ prompt, agentName: this.agentName });
        const parsed = this.parseJson<TOutput>(res.text);

        if (this.schema) {
          const check = this.schema.safeParse(parsed);
          if (!check.success) {
            lastErr = new Error(`Schema validation failed: ${check.error.message.slice(0, 300)}`);
            logger.warn(`[${this.agentName}] ${lastErr.message}`);
            await this.delay(BASE_DELAY_MS * attempt);
            continue;
          }
        }

        const output: AgentOutput<TOutput> = {
          agentName: this.agentName,
          data: parsed,
          tokensUsed: res.tokensUsed,
          costUsd: res.costUsd,
          backend: res.backend,
          durationMs: Date.now() - start,
          attemptNumber: input.attemptNumber,
        };

        AuditLog.append({
          pipelineId: input.pipelineId, eventType: "agent_run", stage: this.agentName,
          agentName: this.agentName, attemptNumber: input.attemptNumber,
          inputHash: AuditLog.hash(input.data), outputHash: AuditLog.hash(parsed),
          tokensUsed: res.tokensUsed, costUsd: res.costUsd, backend: res.backend,
          durationMs: output.durationMs,
        });
        return output;
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        logger.warn(`[${this.agentName}] attempt ${attempt} failed: ${lastErr.message}`);
        if (attempt < MAX_RETRIES) await this.delay(BASE_DELAY_MS * attempt);
      }
    }

    AuditLog.append({
      pipelineId: input.pipelineId, eventType: "stage_error", stage: this.agentName,
      agentName: this.agentName, attemptNumber: input.attemptNumber,
      message: lastErr?.message ?? "unknown error",
    });
    throw lastErr ?? new Error(`${this.agentName} failed after ${MAX_RETRIES} attempts`);
  }

  private assemble(input: AgentInput<TInput>): string {
    let p = this.role ? `${this.role}\n\n` : "";
    p += this.buildPrompt(input);
    if (input.rejectionReason && input.priorOutput) {
      p += buildRejectionContext(input.rejectionReason, input.priorOutput, input.reviewerCredentials);
    }
    return p;
  }

  /** Bracket-matched JSON extraction — survives preamble/fences/trailing text. */
  protected parseJson<T>(text: string): T {
    const fb = text.indexOf("{");
    const fbk = text.indexOf("[");
    if (fb === -1 && fbk === -1) throw new Error("No JSON found in model response");
    let start: number, open: string, close: string;
    if (fb !== -1 && (fbk === -1 || fb < fbk)) { start = fb; open = "{"; close = "}"; }
    else { start = fbk; open = "["; close = "]"; }
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (esc) { esc = false; continue; }
      if (c === "\\" && inStr) { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === open) depth++;
      else if (c === close) { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) throw new Error("Unterminated JSON in model response");
    return JSON.parse(text.slice(start, end + 1)) as T;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}
