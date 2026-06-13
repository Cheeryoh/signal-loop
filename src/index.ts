import dotenv from "dotenv";
dotenv.config();

import { createApp } from "./kernel/server";
import { resolveBackend } from "./kernel/ClaudeClient";
import { logger } from "./kernel/logger";
import { SignalConductor } from "./Conductor";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

const app = createApp({
  productName: "Signal Loop",
  makeConductor: () => new SignalConductor(),
  parseStartBody: (body) => {
    const { userText } = (body ?? {}) as { userText?: string };
    if (!userText || typeof userText !== "string" || userText.trim().length < 15) {
      throw new Error("userText is required (min 15 chars) — paste customer signals (tickets, usage notes, CS notes)");
    }
    if (userText.length > 12000) throw new Error("userText must be 12000 characters or fewer");
    return { signalsText: userText.trim() };
  },
  reportArtifacts: ["signal_set", "theme_map", "intervention_map", "story_set", "priority_brief", "drafted_intervention"],
});

app.listen(PORT, () => {
  logger.info(`Signal Loop on http://localhost:${PORT} — LLM backend: ${resolveBackend()}`);
});
