import { BaseAgent } from "./kernel/BaseAgent";
import { buildJsonInstruction } from "./kernel/promptBuilder";
import type { AgentInput } from "./kernel/types";
import {
  SignalSetSchema, ThemeMapSchema, InterventionMapSchema, StorySetSchema, PriorityBriefSchema, DraftedInterventionSchema,
  type SignalSet, type ThemeMap, type InterventionMap, type StorySet, type PriorityBrief, type DraftedIntervention,
} from "./schemas";

const j = (s: string) => buildJsonInstruction(s);

// ── 1. SignalIngestor — raw signal blob → structured signals ───────────────────
export class SignalIngestorAgent extends BaseAgent<{ signalsText: string }, SignalSet> {
  readonly agentName = "SignalIngestorAgent";
  protected role = "You are a customer insights analyst who normalizes mixed customer signals into structured records.";
  constructor() { super(); this.schema = SignalSetSchema; }
  protected buildPrompt(i: AgentInput<{ signalsText: string }>): string {
    return `Parse the mixed customer signals below into structured records. One record per distinct signal.
Classify source, sentiment, and the product area each touches. Assign stable ids (s1, s2, …). Set totalCount.

SIGNALS:
"""${i.data.signalsText}"""
${j(`{ signals: [{ id, source: support_ticket|usage_telemetry|cs_note|review|sales_note, text, sentiment: positive|neutral|negative, productArea }], totalCount }`)}`;
  }
}

// ── 2. ThemeClusterer — signals → friction themes ──────────────────────────────
export class ThemeClustererAgent extends BaseAgent<{ signalSet: SignalSet }, ThemeMap> {
  readonly agentName = "ThemeClustererAgent";
  protected role = "You are a customer education strategist who clusters noisy signals into a small number of actionable friction themes.";
  constructor() { super(); this.schema = ThemeMapSchema; }
  protected buildPrompt(i: AgentInput<{ signalSet: SignalSet }>): string {
    return `Cluster the signals into 3-6 distinct friction themes (not one-per-signal). For each theme:
- signalRefs: the signal ids it groups; frequency = count of those refs.
- severity: weigh frequency AND how badly it blocks adoption (a frequent hard-blocker is "high").
- summary: the underlying friction in one or two sentences.
topFriction names the single theme most worth addressing first.

SIGNALS:
${JSON.stringify(i.data.signalSet.signals, null, 2)}
${j(`{ themes: [{ id, name, signalRefs: string[], frequency, severity: high|medium|low, summary }], topFriction }`)}`;
  }
}

// ── 3. InterventionMapper — themes → education-addressable mapping ──────────────
export class InterventionMapperAgent extends BaseAgent<{ themeMap: ThemeMap }, InterventionMap> {
  readonly agentName = "InterventionMapperAgent";
  protected role = "You triage friction themes: you decide what education can actually fix versus what belongs to Product, Pricing, or Engineering — and refuse to paper over a product gap with a webinar.";
  constructor() { super(); this.schema = InterventionMapSchema; }
  protected buildPrompt(i: AgentInput<{ themeMap: ThemeMap }>): string {
    return `For each theme, decide the root cause category and whether education can move the needle.
- category: education (a knowledge/skill gap), product (missing/confusing feature), pricing, bug, or docs.
- educationAddressable: true only if better education would meaningfully reduce the friction.
- recommendedAsset: the best-fit education asset, or "none" if not education-addressable.
- expectedImpact: the realistic outcome if we ship it.
Be honest — mapping a product gap to "none" with a clear rationale is a valid and valuable answer.
Set educationCount (educationAddressable true) and deferredCount (the rest).

THEMES:
${JSON.stringify(i.data.themeMap.themes, null, 2)}
${j(`{ mappings: [{ themeId, themeName, category: education|product|pricing|bug|docs, educationAddressable, recommendedAsset: quickstart|webinar|faq|adoption_guide|doc_update|none, expectedImpact, rationale }], educationCount, deferredCount }`)}`;
  }
}

// ── 4. StoryScout — surface candidate success stories ──────────────────────────
export class StoryScoutAgent extends BaseAgent<{ signalSet: SignalSet }, StorySet> {
  readonly agentName = "StoryScoutAgent";
  protected role = "You scout positive customer signals for success stories worth amplifying as education and proof.";
  constructor() { super(); this.schema = StorySetSchema; }
  protected buildPrompt(i: AgentInput<{ signalSet: SignalSet }>): string {
    return `From the positive/neutral signals, surface 0-3 candidate success stories that would make compelling
customer education or proof. Only include genuine candidates — return an empty array if none qualify.
Keep customerHint anonymized (e.g. "a fintech data team"). assetIdea = how to turn it into education.

SIGNALS:
${JSON.stringify(i.data.signalSet.signals.filter(s => s.sentiment !== "negative"), null, 2)}
${j(`{ candidates: [{ customerHint, signalRefs: string[], narrative, whyCompelling, assetIdea }] }`)}`;
  }
}

// ── 5. PriorityBriefWriter — synthesize the education priorities brief ──────────
export class PriorityBriefWriterAgent extends BaseAgent<{ interventionMap: InterventionMap; themeMap: ThemeMap; stories: StorySet }, PriorityBrief> {
  readonly agentName = "PriorityBriefWriterAgent";
  protected role = "You are a Customer Education program manager turning triaged signals into a ranked, defensible education priorities brief for leadership.";
  constructor() { super(); this.schema = PriorityBriefSchema; }
  protected buildPrompt(i: AgentInput<{ interventionMap: InterventionMap; themeMap: ThemeMap; stories: StorySet }>): string {
    return `Produce a ranked education priorities brief from the education-addressable themes only.
Rank by (severity × reach × education leverage). Each priority: recommended asset, expected impact, effort (S/M/L), suggested owner.
executiveSummary is 2-3 sentences a leader can read in 15 seconds. nextReviewDate = a reasonable cadence (e.g. "in 2 weeks").
Do NOT include themes mapped to product/pricing/bug — name those as out-of-scope in the executiveSummary instead.

INTERVENTION MAP:
${JSON.stringify(i.data.interventionMap, null, 2)}

THEME SEVERITIES:
${JSON.stringify(i.data.themeMap.themes.map(t => ({ id: t.id, name: t.name, severity: t.severity, frequency: t.frequency })), null, 2)}

STORY CANDIDATES (for awareness):
${JSON.stringify(i.data.stories.candidates.map(c => c.customerHint), null, 2)}
${j(`{ executiveSummary, priorities: [{ rank, title, theme, recommendedAsset, expectedImpact, effort: S|M|L, suggestedOwner, rationale }], nextReviewDate }`)}`;
  }
}

// ── 6. InterventionDrafter — draft the #1 priority asset ───────────────────────
export class InterventionDrafterAgent extends BaseAgent<{ brief: PriorityBrief }, DraftedIntervention> {
  readonly agentName = "InterventionDrafterAgent";
  protected role = "You are an instructional content writer who turns the top education priority into a ready-to-edit first draft.";
  constructor() { super(); this.schema = DraftedInterventionSchema; }
  protected buildPrompt(i: AgentInput<{ brief: PriorityBrief }>): string {
    const top = i.data.brief.priorities.find(p => p.rank === 1) ?? i.data.brief.priorities[0];
    return `Draft the #1 education priority below as a real, usable first draft (markdown in the draft field).
Match the recommended asset type. Make learning objectives measurable. distributionChannel = where it should ship.

#1 PRIORITY:
${JSON.stringify(top, null, 2)}
${j(`{ priorityRank, assetType, title, learningObjectives: string[], draft, distributionChannel }`)}`;
  }
}
