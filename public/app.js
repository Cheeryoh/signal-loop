/* Shared dashboard logic for all three orchestration products.
   Product-specific bits come from window.PRODUCT_CONFIG (config.js). */
const CFG = window.PRODUCT_CONFIG;
let pipelineId = null;
let sse = null;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ── Boot ────────────────────────────────────────────────────────────────────
function boot() {
  document.title = CFG.title;
  $("brandTitle").textContent = CFG.title;
  $("brandTagline").textContent = CFG.tagline;
  $("backendBadge").className = CFG.badgeClass || "badge";

  const ex = $("examples");
  CFG.examples.forEach((e, i) => {
    const a = document.createElement("a");
    a.textContent = e.label;
    a.onclick = () => { $("inputText").value = e.text; };
    ex.appendChild(a);
    if (i < CFG.examples.length - 1) ex.appendChild(document.createTextNode(" · "));
  });

  renderStages(null);
  $("startBtn").onclick = startPipeline;
  fetch("/health").then(r => r.json()).then(h => $("backendBadge").textContent = `backend: ${h.backend}`).catch(() => {});
  loadRuns();
}

function renderStages(current) {
  const ul = $("stageList");
  ul.innerHTML = "";
  CFG.stages.forEach(s => {
    const li = document.createElement("li");
    li.className = "stage" + (s.gate ? " gate" : "");
    li.id = "st-" + s.id;
    li.innerHTML = `<div class="ic"></div><div><div class="label">${esc(s.label)}</div><div class="sub">${esc(s.hint)}</div></div>`;
    ul.appendChild(li);
  });
}
function setStage(id, status, sub) {
  const li = $("st-" + id);
  if (!li) return;
  li.classList.remove("active", "complete", "error");
  if (status) li.classList.add(status);
  const ic = li.querySelector(".ic");
  if (status === "complete") ic.textContent = "✓";
  else if (status === "error") ic.textContent = "!";
  else ic.textContent = "";
  if (sub) li.querySelector(".sub").textContent = sub;
}

// ── Start ─────────────────────────────────────────────────────────────────────
async function startPipeline() {
  const userText = $("inputText").value.trim();
  if (userText.length < 15) { alert("Please describe the input (min 15 chars)."); return; }
  $("startBtn").disabled = true;
  $("startBtn").textContent = "Starting…";
  renderStages();
  $("reviewPane").innerHTML = "";
  $("idlePane").style.display = "block";
  try {
    const res = await fetch("/api/pipeline/start", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userText }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "start failed");
    pipelineId = data.pipelineId;
    connectSSE();
  } catch (e) {
    alert("Could not start: " + e.message);
    $("startBtn").disabled = false;
    $("startBtn").textContent = "Run Pipeline";
  }
}

// ── SSE ─────────────────────────────────────────────────────────────────────
function connectSSE() {
  if (sse) sse.close();
  sse = new EventSource(`/events?pipelineId=${pipelineId}`);
  sse.onopen = () => $("sseDot").classList.add("live");
  sse.onerror = () => $("sseDot").classList.remove("live");
  sse.onmessage = (m) => { try { handleEvent(JSON.parse(m.data)); } catch {} };
}
function handleEvent(ev) {
  switch (ev.type) {
    case "stage_start": setStage(ev.stage, "active"); break;
    case "stage_complete": setStage(ev.stage, "complete", ev.message); break;
    case "stage_error": setStage(ev.stage, "error", ev.message); break;
    case "hitl_gate_open": setStage(ev.stage, "active"); renderGate(ev); break;
    case "hitl_gate_closed": setStage(ev.stage, ev.data?.decision === "approved" ? "complete" : "error"); break;
    case "validation_warning": banner("warn", ev.message); break;
    case "pipeline_complete": onComplete(); break;
    case "pipeline_error": banner("err", "Pipeline error: " + ev.message); resetStart(); break;
  }
}
function resetStart() { $("startBtn").disabled = false; $("startBtn").textContent = "Run Pipeline"; }

// ── Gate rendering ────────────────────────────────────────────────────────────
function gateMeta(stage) { return CFG.stages.find(s => s.id === stage) || { label: stage, hint: "Review and decide" }; }

function renderGate(ev) {
  $("idlePane").style.display = "none";
  const meta = gateMeta(ev.stage);
  const body = renderPayload(ev.data);
  $("reviewPane").innerHTML = `
    <div class="gate-box">
      <div class="gate-head">
        <div class="g-title">${esc(meta.label)}</div>
        <div class="g-hint">${esc(meta.hint)}</div>
      </div>
      <div class="gate-body">${body}</div>
      <div class="reject-panel" id="rejectPanel">
        <div class="lbl">Why are you rejecting? The agent re-runs with this feedback.</div>
        <textarea id="rejectReason" placeholder="e.g. Tone is too hype-y; lead with the latency proof point."></textarea>
        <div class="lbl" style="margin-top:6px">Your expertise (optional — weighted in the rewrite)</div>
        <input id="rejectCred" placeholder="e.g. PMM, 8 yrs enterprise AI" style="width:100%;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:9px" />
        <button class="btn-submit-reject" id="submitReject">Submit rejection & re-run</button>
      </div>
      <div class="gate-actions">
        <button class="btn-approve" id="approveBtn">✓ Approve</button>
        <button class="btn-reject" id="rejectBtn">✗ Request changes</button>
      </div>
    </div>`;
  $("approveBtn").onclick = () => decide("approve");
  $("rejectBtn").onclick = () => $("rejectPanel").classList.toggle("show");
  $("submitReject").onclick = () => decide("reject");
}

async function decide(kind) {
  const body = {};
  if (kind === "reject") {
    body.rejectionReason = $("rejectReason").value.trim() || "No reason given";
    body.reviewerCredentials = $("rejectCred").value.trim() || undefined;
  }
  const btn = kind === "approve" ? $("approveBtn") : $("submitReject");
  btn.disabled = true; btn.textContent = "…";
  try {
    const res = await fetch(`/api/hitl/${pipelineId}/${kind}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
    $("reviewPane").innerHTML = `<div class="banner ok">Decision recorded. Continuing…</div>`;
  } catch (e) { alert("Failed: " + e.message); btn.disabled = false; }
}

// ── Generic payload renderer ────────────────────────────────────────────────
function renderPayload(data) {
  if (data == null) return '<div class="muted">No data.</div>';
  if (typeof data !== "object") return `<div>${esc(data)}</div>`;
  let html = "";
  for (const [key, val] of Object.entries(data)) {
    if (key === "critical") continue;
    html += `<div class="section"><div class="sec-h">${esc(humanize(key))}</div>${renderValue(val)}</div>`;
  }
  return html || '<div class="muted">Empty.</div>';
}
function humanize(k) { return k.replace(/([A-Z])/g, " $1").replace(/[_-]/g, " ").replace(/^./, c => c.toUpperCase()).trim(); }

function renderValue(v) {
  if (v == null) return '<span class="muted">—</span>';
  if (typeof v === "string") {
    const pill = ["ship", "revise", "block", "primary", "secondary", "tertiary"].includes(v) ? `<span class="pill ${v}">${esc(v)}</span>` : null;
    return pill || `<div>${esc(v).replace(/\n/g, "<br>")}</div>`;
  }
  if (typeof v === "number" || typeof v === "boolean") return `<div>${esc(v)}</div>`;
  if (Array.isArray(v)) {
    if (v.length === 0) return '<span class="muted">none</span>';
    if (v.every(x => typeof x === "string" || typeof x === "number")) {
      if (v.every(x => typeof x === "string" && x.length < 24)) return v.map(x => `<span class="chip">${esc(x)}</span>`).join("");
      return `<ul class="clean">${v.map(x => `<li>${esc(x)}</li>`).join("")}</ul>`;
    }
    return v.map(x => `<div class="obj-card">${renderObjCard(x)}</div>`).join("");
  }
  // object
  return `<div class="obj-card">${renderObjCard(v)}</div>`;
}
function renderObjCard(o) {
  if (typeof o !== "object" || o == null) return esc(o);
  const titleKey = ["title", "name", "pillar", "channel", "asset", "subject", "scenario"].find(k => o[k]);
  let html = titleKey ? `<div class="oc-title">${esc(o[titleKey])}</div>` : "";
  for (const [k, val] of Object.entries(o)) {
    if (k === titleKey) continue;
    html += `<div style="margin-bottom:4px"><span class="muted" style="font-size:11px">${esc(humanize(k))}: </span>${renderValue(val)}</div>`;
  }
  return html;
}

// ── Completion + runs ─────────────────────────────────────────────────────────
async function onComplete() {
  resetStart();
  CFG.stages.forEach(s => { const li = $("st-" + s.id); if (li && !li.classList.contains("error")) setStage(s.id, "complete"); });
  const data = await fetch(`/report-data/${pipelineId}`).then(r => r.json()).catch(() => null);
  const cost = data?.state ? `$${(data.state.totalCostUsd || 0).toFixed(4)} · ${data.state.totalTokens || 0} tokens` : "";
  $("costMeter").textContent = cost;
  let html = `<div class="banner ok"><strong>Pipeline complete.</strong> All gates approved. ${cost ? "Cost: " + cost : ""}</div>`;
  if (data?.artifacts) {
    for (const [name, art] of Object.entries(data.artifacts)) {
      if (!art) continue;
      html += `<div class="card"><h2>${esc(humanize(name))}</h2>${renderPayload(art)}</div>`;
    }
  }
  $("reviewPane").innerHTML = html;
  loadRuns();
}
function banner(kind, msg) {
  const b = document.createElement("div");
  b.className = "banner " + kind;
  b.textContent = msg;
  $("reviewPane").prepend(b);
  setTimeout(() => b.remove(), 8000);
}
async function loadRuns() {
  try {
    const runs = await fetch("/api/pipeline").then(r => r.json());
    const el = $("runList");
    if (!runs.length) { el.innerHTML = '<span class="muted" style="font-size:12px">No runs yet.</span>'; return; }
    el.innerHTML = runs.slice(0, 8).map(r => `
      <div class="run-item" onclick="viewRun('${r.pipelineId}')">
        <div class="t">${esc(r.title || r.pipelineId.slice(0, 8))}</div>
        <div class="m">${esc(r.status)} · ${esc(r.currentStage)} · $${(r.totalCostUsd || 0).toFixed(4)}</div>
      </div>`).join("");
  } catch {}
}
async function viewRun(id) {
  pipelineId = id;
  const data = await fetch(`/report-data/${id}`).then(r => r.json()).catch(() => null);
  if (!data) return;
  $("idlePane").style.display = "none";
  let html = `<div class="banner ${data.state?.status === "complete" ? "ok" : "warn"}">${esc(data.state?.title || id)} — ${esc(data.state?.status)}</div>`;
  for (const [name, art] of Object.entries(data.artifacts || {})) {
    if (!art) continue;
    html += `<div class="card"><h2>${esc(humanize(name))}</h2>${renderPayload(art)}</div>`;
  }
  $("reviewPane").innerHTML = html;
}

boot();
