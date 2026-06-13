// Per-product UI config. The shared app.js reads window.PRODUCT_CONFIG.
window.PRODUCT_CONFIG = {
  title: "Signal Loop",
  tagline: "Customer signals → triaged friction → ranked education priorities + a drafted #1 asset",
  badgeClass: "badge",
  examples: [
    {
      label: "Mixed signals (tickets + usage + CS)",
      text: `Support ticket: "Docs show the old chunking approach but the API now has 1M context — which is right? Spent a day confused."
Support ticket: "Realtime API websocket keeps dropping, no example for reconnect handling."
Usage telemetry: 70% of new enterprise orgs never make a second API call within 7 days of signup.
Usage telemetry: Realtime API adoption flat despite launch; most trials stop after the first failed connection.
CS note: "Acme's data team loves long-context — replaced their whole RAG pipeline, huge win, happy to talk."
CS note: "Three accounts asked for a step-by-step fine-tuning migration; worried about the Q4 deadline."
Review: "Love the latency improvement but onboarding is a maze."
Sales note: "Prospect stalled — wants proof other enterprises run agents reliably in prod before signing."
Support ticket: "Billing for Realtime is per-minute but our finance team budgeted per-token; caught us off guard."`
    },
    {
      label: "Onboarding friction",
      text: `Usage telemetry: median time-to-first-successful-call is 3 days for enterprise signups.
Support ticket: "Auth works in curl but not the Python SDK, no clear example."
Support ticket: "Rate limit errors on day one, didn't know tiers existed."
CS note: "New admins don't know where to start; ask for a guided path."
Review: "Powerful but the getting-started docs assume too much."`
    }
  ],
  stages: [
    { id: "signal_ingestor",       label: "1. Ingest signals",          gate: false, hint: "Structuring mixed signals into records" },
    { id: "theme_clusterer",       label: "2. Cluster friction",        gate: false, hint: "Grouping signals into friction themes" },
    { id: "gate_themes",           label: "Gate 1 · Friction themes",   gate: true,  hint: "Confirm the clustering reflects reality" },
    { id: "intervention_mapper",   label: "3. Map interventions",       gate: false, hint: "Education-addressable vs route to other teams" },
    { id: "gate_mapping",          label: "Gate 2 · Triage",            gate: true,  hint: "Approve what education owns vs defers" },
    { id: "story_scout",           label: "4. Scout success stories",   gate: false, hint: "Surfacing stories worth amplifying" },
    { id: "priority_brief_writer", label: "5. Write priorities brief",  gate: false, hint: "Ranking education priorities" },
    { id: "intervention_drafter",  label: "6. Draft #1 intervention",   gate: false, hint: "Drafting the top-ranked asset" },
    { id: "gate_brief",            label: "Gate 3 · Priorities + draft", gate: true, hint: "Approve the brief and the drafted asset" }
  ]
};
