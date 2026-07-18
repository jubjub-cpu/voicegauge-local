import { DEFAULT_THRESHOLDS, analyzePcm, buildAudioReport, compareAnalyses } from "./audio-engine.mjs";

const workspace = document.querySelector("#workspace");
const state = {
  suite: "",
  notice: "",
  fixtures: [],
  samples: new Map(),
  analyses: new Map(),
  selectedId: null,
  baselineId: null,
  thresholds: { ...DEFAULT_THRESHOLDS },
  decision: null,
  reviewNote: "",
  audit: [],
  objectUrls: []
};

let audioContext;
const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const selectedFixture = () => state.fixtures.find((fixture) => fixture.id === state.selectedId) || state.fixtures[0];
const selectedAnalysis = () => state.analyses.get(state.selectedId);
const baselineAnalysis = () => state.analyses.get(state.baselineId);
const formatDb = (value) => `${Number(value).toFixed(1)} dBFS`;

function addAudit(action, detail) {
  state.audit.unshift({ at: new Date().toISOString(), action, detail });
  renderAudit();
}

function shell() {
  workspace.innerHTML = `<div class="studio-shell">
    <aside class="sample-rail" aria-labelledby="sample-heading">
      <div class="rail-heading"><p class="eyebrow">Synthetic fixture set</p><h1 id="sample-heading">Audio library</h1><p>${esc(state.suite)}</p></div>
      <div id="sample-list" class="sample-list"></div>
      <label class="import-control" for="audio-import"><span>Open local audio</span><small>WAV, MP3, M4A, OGG, or browser-supported audio</small></label><input id="audio-import" type="file" accept="audio/*,.wav"><p id="import-error" class="import-error" role="alert"></p>
      <p class="privacy-note">Decoded samples stay in browser memory. No audio, filename, metric, or decision is transmitted.</p>
    </aside>
    <section class="workbench" aria-labelledby="workbench-heading">
      <div class="workbench-heading"><div><p class="eyebrow">Signal inspection</p><h2 id="workbench-heading">Voice quality workbench</h2><p>Transparent local PCM checks for delivery readiness, without speech recognition.</p></div><button id="export-report" class="secondary" type="button">Export report</button></div>
      <section class="source-strip" aria-labelledby="source-heading"><div><p class="eyebrow">Selected source</p><h3 id="source-heading"></h3><p id="source-profile"></p></div><audio id="audio-player" controls preload="metadata"></audio></section>
      <div id="metric-strip" class="metric-strip" aria-label="Audio metrics"></div>
      <section class="waveform-section" aria-labelledby="waveform-heading"><div class="panel-heading"><div><p class="eyebrow">Decoded channel one</p><h3 id="waveform-heading">Waveform timeline</h3></div><span id="waveform-meta"></span></div><canvas id="waveform" width="1000" height="300" tabindex="0" aria-label="Audio waveform with clipping, silence, and noise overlays"></canvas><div class="waveform-legend"><span><i class="signal"></i>PCM range</span><span><i class="clipping"></i>Clipping</span><span><i class="silence"></i>Silence</span><span><i class="noise"></i>Elevated quiet floor</span></div></section>
      <div class="analysis-grid">
        <section class="findings-section" aria-labelledby="findings-heading"><div class="panel-heading"><div><p class="eyebrow">Threshold evidence</p><h3 id="findings-heading">Findings</h3></div><span id="readiness-status" class="status"></span></div><div id="findings-list" class="findings-list"></div></section>
        <section class="policy-section" aria-labelledby="policy-heading"><div class="panel-heading"><div><p class="eyebrow">Inspection policy</p><h3 id="policy-heading">Thresholds</h3></div><button id="reset-policy" class="text-button" type="button">Reset</button></div><div id="policy-controls" class="policy-controls"></div></section>
      </div>
      <section class="comparison-section" aria-labelledby="comparison-heading"><div class="panel-heading"><div><p class="eyebrow">Reference comparison</p><h3 id="comparison-heading">Against clear baseline</h3></div><span>Metric delta</span></div><div id="comparison-table" class="table-wrap"></div></section>
      <section class="decision-section" aria-labelledby="decision-heading"><div><p class="eyebrow">Human delivery gate</p><h3 id="decision-heading">Handoff decision</h3><p>Signal findings remain visible. A reviewer owns the delivery call and any override.</p><p id="decision-summary" class="decision-summary">No decision recorded.</p></div><div class="decision-form"><label for="review-note">Review note<input id="review-note" type="text" maxlength="180" placeholder="Evidence for the handoff decision"></label><div><button id="accept-audio" type="button">Accept for handoff</button><button id="request-rerecord" class="return" type="button">Request re-record</button></div><p id="decision-error" role="alert"></p></div></section>
      <section class="audit-section" aria-labelledby="audit-heading"><div class="panel-heading"><div><p class="eyebrow">Local evidence</p><h3 id="audit-heading">Review audit</h3></div><span>Current session</span></div><ol id="audit-list"></ol></section>
    </section>
  </div>`;
}

function renderSamples() {
  document.querySelector("#sample-list").innerHTML = state.fixtures.map((fixture) => {
    const analysis = state.analyses.get(fixture.id);
    return `<button class="sample-button" type="button" data-sample="${esc(fixture.id)}" aria-pressed="${fixture.id === state.selectedId}"><span>${fixture.baseline ? "Reference" : fixture.local ? "Local file" : "Test fixture"}</span><strong>${esc(fixture.title)}</strong><small>${analysis.score} / ${analysis.ready ? "ready" : `${analysis.findings.length} finding${analysis.findings.length === 1 ? "" : "s"}`}</small><i class="score-bar"><b style="width:${analysis.score}%"></b></i></button>`;
  }).join("");
}

function renderSource() {
  const fixture = selectedFixture();
  const analysis = selectedAnalysis();
  document.querySelector("#source-heading").textContent = fixture.title;
  document.querySelector("#source-profile").textContent = fixture.profile;
  document.querySelector("#waveform-meta").textContent = `${analysis.duration.toFixed(1)} sec / ${(analysis.sampleRate / 1000).toFixed(0)} kHz / mono analysis`;
  const player = document.querySelector("#audio-player");
  if (player.dataset.sourceId !== fixture.id) {
    player.src = fixture.objectUrl || fixture.file;
    player.dataset.sourceId = fixture.id;
    player.load();
  }
}

function renderMetrics() {
  const analysis = selectedAnalysis();
  const metrics = analysis.metrics;
  document.querySelector("#metric-strip").innerHTML = `<div><span>Quality score</span><strong>${analysis.score}</strong><small>${analysis.ready ? "policy ready" : "review findings"}</small></div><div><span>Peak</span><strong>${formatDb(metrics.peakDb)}</strong><small>sample maximum</small></div><div><span>RMS</span><strong>${formatDb(metrics.rmsDb)}</strong><small>whole-file energy</small></div><div><span>Clipped</span><strong>${metrics.clipPercent.toFixed(2)}%</strong><small>samples at ceiling</small></div><div><span>Silence</span><strong>${metrics.silencePercent.toFixed(1)}%</strong><small>${metrics.pauseCount} long pause${metrics.pauseCount === 1 ? "" : "s"}</small></div><div><span>Quiet floor</span><strong>${formatDb(metrics.quietFloorDb)}</strong><small>10th percentile</small></div>`;
}

function drawWaveform() {
  const canvas = document.querySelector("#waveform");
  if (!canvas) return;
  const context = canvas.getContext("2d");
  const samples = state.samples.get(state.selectedId);
  const analysis = selectedAnalysis();
  const width = canvas.width;
  const height = canvas.height;
  const center = height / 2;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#11191d";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "#34444b";
  context.lineWidth = 1;
  for (let line = 1; line < 6; line += 1) {
    const y = line * height / 6;
    context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
  }
  const colors = { clipping: "rgba(225, 80, 66, 0.28)", silence: "rgba(244, 200, 66, 0.22)", noise: "rgba(142, 103, 181, 0.26)" };
  analysis.segments.forEach((segment) => {
    context.fillStyle = colors[segment.kind];
    context.fillRect(segment.start / analysis.duration * width, 0, Math.max(2, segment.duration / analysis.duration * width), height);
  });
  context.strokeStyle = "#42d4d0";
  context.lineWidth = 1;
  const bucket = samples.length / width;
  for (let x = 0; x < width; x += 1) {
    const start = Math.floor(x * bucket);
    const end = Math.min(samples.length, Math.floor((x + 1) * bucket));
    let min = 1;
    let max = -1;
    for (let index = start; index < end; index += 1) { min = Math.min(min, samples[index]); max = Math.max(max, samples[index]); }
    context.beginPath(); context.moveTo(x + 0.5, center + min * center * 0.9); context.lineTo(x + 0.5, center + max * center * 0.9); context.stroke();
  }
  context.strokeStyle = "#8fa0a8";
  context.beginPath(); context.moveTo(0, center); context.lineTo(width, center); context.stroke();
  const player = document.querySelector("#audio-player");
  if (player?.duration && Number.isFinite(player.duration)) {
    const x = player.currentTime / player.duration * width;
    context.strokeStyle = "#ffffff";
    context.lineWidth = 2;
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke();
  }
}

function renderFindings() {
  const analysis = selectedAnalysis();
  const status = document.querySelector("#readiness-status");
  status.className = `status ${analysis.ready ? "ready" : "review"}`;
  status.textContent = analysis.ready ? "Ready" : "Review";
  document.querySelector("#findings-list").innerHTML = analysis.findings.length ? analysis.findings.map((finding) => `<article class="finding ${finding.severity}"><span>${esc(finding.severity)}</span><div><h4>${esc(finding.title)}</h4><p>${esc(finding.evidence)}</p></div></article>`).join("") : '<div class="ready-state"><strong>All configured checks pass.</strong><p>The signal remains subject to human listening and content review.</p></div>';
}

function renderPolicy() {
  const controls = [
    ["maxClipPercent", "Maximum clipping", 0, 5, 0.1, "%"],
    ["maxSilencePercent", "Maximum silence", 10, 70, 1, "%"],
    ["maxQuietFloorDb", "Maximum quiet floor", -50, -15, 1, " dBFS"],
    ["minPeakDb", "Minimum peak", -30, -3, 1, " dBFS"]
  ];
  document.querySelector("#policy-controls").innerHTML = controls.map(([key, label, min, max, step, unit]) => `<label for="${key}"><span>${label}<output>${state.thresholds[key]}${unit}</output></span><input id="${key}" data-policy="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${state.thresholds[key]}"></label>`).join("");
}

function renderComparison() {
  const current = selectedAnalysis();
  const baseline = baselineAnalysis();
  const delta = compareAnalyses(baseline, current);
  const rows = [
    ["Peak", baseline.metrics.peakDb, current.metrics.peakDb, delta.peakDb, "dBFS"],
    ["RMS", baseline.metrics.rmsDb, current.metrics.rmsDb, delta.rmsDb, "dBFS"],
    ["Clipping", baseline.metrics.clipPercent, current.metrics.clipPercent, delta.clipPercent, "%"],
    ["Silence", baseline.metrics.silencePercent, current.metrics.silencePercent, delta.silencePercent, "%"],
    ["Quiet floor", baseline.metrics.quietFloorDb, current.metrics.quietFloorDb, delta.quietFloorDb, "dBFS"],
    ["Long pauses", baseline.metrics.pauseCount, current.metrics.pauseCount, delta.pauseCount, ""]
  ];
  document.querySelector("#comparison-table").innerHTML = `<table><thead><tr><th>Metric</th><th>Clear baseline</th><th>Selected</th><th>Delta</th></tr></thead><tbody>${rows.map(([label, base, selected, change, unit]) => `<tr><th>${label}</th><td>${Number(base).toFixed(unit === "%" ? 2 : 1)} ${unit}</td><td>${Number(selected).toFixed(unit === "%" ? 2 : 1)} ${unit}</td><td class="${change === 0 ? "neutral" : change > 0 ? "up" : "down"}">${change > 0 ? "+" : ""}${change} ${unit}</td></tr>`).join("")}</tbody></table>`;
}

function renderDecision() {
  const summary = document.querySelector("#decision-summary");
  document.querySelector("#review-note").value = state.reviewNote;
  document.querySelector("#decision-error").textContent = "";
  if (!state.decision) { summary.className = "decision-summary"; summary.textContent = "No decision recorded."; return; }
  summary.className = `decision-summary ${state.decision.action}`;
  summary.textContent = `${state.decision.action === "accepted" ? "Accepted for handoff" : "Re-record requested"} by human reviewer. ${state.decision.note ? `Evidence: ${state.decision.note}` : ""}`;
}

function renderAudit() {
  const list = document.querySelector("#audit-list");
  if (!list) return;
  list.innerHTML = state.audit.map((item) => `<li><time>${new Date(item.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time><strong>${esc(item.action)}</strong><span>${esc(item.detail)}</span></li>`).join("");
}

function renderAll() {
  renderSamples(); renderSource(); renderMetrics(); renderFindings(); renderPolicy(); renderComparison(); renderDecision(); renderAudit(); drawWaveform();
}

function reanalyze() {
  for (const [id, source] of state.samples.entries()) state.analyses.set(id, analyzePcm(source, selectedFixtureForId(id).sampleRate, state.thresholds));
  state.decision = null;
  renderAll();
  addAudit("Policy recalculated", `${selectedFixture().title}: score ${selectedAnalysis().score}, ${selectedAnalysis().findings.length} finding(s).`);
}

function selectedFixtureForId(id) {
  return state.fixtures.find((fixture) => fixture.id === id);
}

function downloadReport() {
  const report = buildAudioReport({ id: selectedFixture().id, title: selectedFixture().title, local: Boolean(selectedFixture().local) }, selectedAnalysis(), baselineAnalysis(), state.decision);
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = "voicegauge-report.json"; document.body.append(anchor);
  window.setTimeout(() => { anchor.click(); window.setTimeout(() => { anchor.remove(); URL.revokeObjectURL(url); }, 10000); }, 0);
}

async function decodeAudio(arrayBuffer) {
  audioContext ||= new AudioContext();
  const buffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
  const mixed = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    for (let index = 0; index < samples.length; index += 1) mixed[index] += samples[index] / buffer.numberOfChannels;
  }
  return { samples: mixed, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels };
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    const sampleButton = event.target.closest("[data-sample]");
    if (sampleButton) {
      state.selectedId = sampleButton.dataset.sample;
      state.decision = null; state.reviewNote = "";
      renderAll();
      return;
    }
    if (event.target.id === "reset-policy") { state.thresholds = { ...DEFAULT_THRESHOLDS }; reanalyze(); return; }
    if (event.target.id === "export-report") { downloadReport(); addAudit("Report exported", `${selectedFixture().title} signal evidence exported locally.`); return; }
    if (event.target.id === "accept-audio") {
      const analysis = selectedAnalysis();
      if (analysis.findings.length && state.reviewNote.trim().length < 12) { document.querySelector("#decision-error").textContent = "A 12-character evidence note is required to accept audio with findings."; return; }
      state.decision = { action: "accepted", note: state.reviewNote.trim(), at: new Date().toISOString(), rawScore: analysis.score, findingIds: analysis.findings.map((finding) => finding.id) };
      addAudit("Audio accepted", `${selectedFixture().title}: raw score ${analysis.score}; ${analysis.findings.length} finding(s) preserved.`); renderDecision(); return;
    }
    if (event.target.id === "request-rerecord") {
      state.decision = { action: "rerecord", note: state.reviewNote.trim(), at: new Date().toISOString(), rawScore: selectedAnalysis().score, findingIds: selectedAnalysis().findings.map((finding) => finding.id) };
      addAudit("Re-record requested", `${selectedFixture().title}: reviewer returned the source.`); renderDecision(); return;
    }
    if (event.target.id === "retry-load") initialize();
  });
  document.addEventListener("change", (event) => {
    if (event.target.matches("[data-policy]")) { state.thresholds[event.target.dataset.policy] = Number(event.target.value); reanalyze(); }
  });
  document.querySelector("#review-note").addEventListener("input", (event) => { state.reviewNote = event.target.value; });
  document.querySelector("#audio-player").addEventListener("timeupdate", drawWaveform);
  document.querySelector("#waveform").addEventListener("click", (event) => {
    const player = document.querySelector("#audio-player");
    if (!Number.isFinite(player.duration)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    player.currentTime = Math.max(0, Math.min(player.duration, (event.clientX - rect.left) / rect.width * player.duration));
    drawWaveform();
  });
  document.querySelector("#audio-import").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const decoded = await decodeAudio(await file.arrayBuffer());
      const id = `local-${Date.now()}`;
      const objectUrl = URL.createObjectURL(file);
      state.objectUrls.push(objectUrl);
      state.fixtures.push({ id, title: file.name, profile: "Local browser analysis. The file remains on this device.", local: true, objectUrl, sampleRate: decoded.sampleRate, channels: decoded.channels });
      state.samples.set(id, decoded.samples);
      state.analyses.set(id, analyzePcm(decoded.samples, decoded.sampleRate, state.thresholds));
      state.selectedId = id; state.decision = null; state.reviewNote = "";
      document.querySelector("#import-error").textContent = "";
      addAudit("Local audio opened", `${file.name}: ${decoded.channels} channel(s), ${(decoded.sampleRate / 1000).toFixed(0)} kHz; nothing uploaded.`);
      renderAll();
    } catch {
      document.querySelector("#import-error").textContent = "This browser could not decode the selected audio file.";
    } finally { event.target.value = ""; }
  });
  window.addEventListener("resize", drawWaveform);
}

async function initialize() {
  workspace.innerHTML = '<section class="startup" aria-labelledby="startup-title"><p class="eyebrow">Decoding synthetic WAV fixtures</p><h1 id="startup-title">Preparing signal evidence</h1><div class="loader" aria-hidden="true"><span></span></div></section>';
  try {
    const response = await fetch("data/fixtures.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Fixture manifest failed");
    const data = await response.json();
    state.suite = data.suite; state.notice = data.notice; state.fixtures = data.fixtures;
    const decodedFixtures = await Promise.all(data.fixtures.map(async (fixture) => {
      const audioResponse = await fetch(fixture.file, { cache: "no-store" });
      if (!audioResponse.ok) throw new Error(`Audio fixture failed: ${fixture.id}`);
      const decoded = await decodeAudio(await audioResponse.arrayBuffer());
      return { fixture: { ...fixture, sampleRate: decoded.sampleRate, channels: decoded.channels }, samples: decoded.samples };
    }));
    state.fixtures = decodedFixtures.map((item) => item.fixture);
    decodedFixtures.forEach(({ fixture, samples }) => { state.samples.set(fixture.id, samples); state.analyses.set(fixture.id, analyzePcm(samples, fixture.sampleRate, state.thresholds)); });
    state.baselineId = state.fixtures.find((fixture) => fixture.baseline)?.id || state.fixtures[0].id;
    state.selectedId = state.fixtures.find((fixture) => fixture.expectedFinding === "clipping")?.id || state.fixtures[0].id;
    state.audit = [{ at: new Date().toISOString(), action: "Fixture set decoded", detail: `${state.fixtures.length} generated files analyzed locally with Web Audio.` }];
    shell(); bindEvents(); renderAll();
  } catch {
    workspace.innerHTML = '<section class="startup error"><p class="eyebrow">Audio load failed</p><h1>The synthetic audio fixtures could not be decoded.</h1><p>Check the local static server and browser audio support, then retry.</p><button id="retry-load" type="button">Retry</button></section>';
    document.querySelector("#retry-load").addEventListener("click", initialize);
  }
}

window.addEventListener("beforeunload", () => state.objectUrls.forEach((url) => URL.revokeObjectURL(url)));
initialize();
