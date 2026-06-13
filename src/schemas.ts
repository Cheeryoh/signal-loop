import { z } from "zod";

/**
 * Signal Loop — artifact schemas.
 * Flow: SignalSet → ThemeMap → InterventionMap → StorySet → PriorityBrief + DraftedIntervention
 */

// ── Structured customer signals ────────────────────────────────────────────────
export const SignalSchema = z.object({
  id: z.string(),
  source: z.enum(["support_ticket", "usage_telemetry", "cs_note", "review", "sales_note"]),
  text: z.string(),
  sentiment: z.enum(["positive", "neutral", "negative"]),
  productArea: z.string(),
});
export const SignalSetSchema = z.object({
  signals: z.array(SignalSchema).min(1),
  totalCount: z.number().int().min(1),
});
export type SignalSet = z.infer<typeof SignalSetSchema>;

// ── Friction themes (clusters) ─────────────────────────────────────────────────
export const FrictionThemeSchema = z.object({
  id: z.string(),
  name: z.string(),
  signalRefs: z.array(z.string()),
  frequency: z.number().int().min(1),
  severity: z.enum(["high", "medium", "low"]),
  summary: z.string(),
});
export const ThemeMapSchema = z.object({
  themes: z.array(FrictionThemeSchema).min(1),
  topFriction: z.string(),
});
export type ThemeMap = z.infer<typeof ThemeMapSchema>;

// ── Intervention mapping (education-addressable vs not) ────────────────────────
export const InterventionMapItemSchema = z.object({
  themeId: z.string(),
  themeName: z.string(),
  category: z.enum(["education", "product", "pricing", "bug", "docs"]),
  educationAddressable: z.boolean(),
  recommendedAsset: z.enum(["quickstart", "webinar", "faq", "adoption_guide", "doc_update", "none"]),
  expectedImpact: z.string(),
  rationale: z.string(),
});
export const InterventionMapSchema = z.object({
  mappings: z.array(InterventionMapItemSchema).min(1),
  educationCount: z.number().int().min(0),
  deferredCount: z.number().int().min(0),
});
export type InterventionMap = z.infer<typeof InterventionMapSchema>;

// ── Candidate success stories ──────────────────────────────────────────────────
export const StoryCandidateSchema = z.object({
  customerHint: z.string(),
  signalRefs: z.array(z.string()),
  narrative: z.string(),
  whyCompelling: z.string(),
  assetIdea: z.string(),
});
export const StorySetSchema = z.object({
  candidates: z.array(StoryCandidateSchema),
});
export type StorySet = z.infer<typeof StorySetSchema>;

// ── Education priorities brief ──────────────────────────────────────────────────
export const PriorityItemSchema = z.object({
  rank: z.number().int().min(1),
  title: z.string(),
  theme: z.string(),
  recommendedAsset: z.string(),
  expectedImpact: z.string(),
  effort: z.enum(["S", "M", "L"]),
  suggestedOwner: z.string(),
  rationale: z.string(),
});
export const PriorityBriefSchema = z.object({
  executiveSummary: z.string(),
  priorities: z.array(PriorityItemSchema).min(1),
  nextReviewDate: z.string(),
});
export type PriorityBrief = z.infer<typeof PriorityBriefSchema>;

// ── Drafted #1 intervention ────────────────────────────────────────────────────
export const DraftedInterventionSchema = z.object({
  priorityRank: z.number().int().min(1),
  assetType: z.string(),
  title: z.string(),
  learningObjectives: z.array(z.string()),
  draft: z.string(),
  distributionChannel: z.string(),
});
export type DraftedIntervention = z.infer<typeof DraftedInterventionSchema>;
