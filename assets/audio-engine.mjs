export const DEFAULT_THRESHOLDS = Object.freeze({
  maxClipPercent: 0.5,
  maxSilencePercent: 36,
  maxQuietFloorDb: -32,
  minPeakDb: -18,
  minPauseSeconds: 0.3
});

const db = (value) => value <= 0 ? -100 : 20 * Math.log10(value);
const rounded = (value, digits = 1) => Number(value.toFixed(digits));

function percentile(values, ratio) {
  if (!values.length) return -100;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

function createSegments(windows, predicate, kind, minSeconds, windowSeconds) {
  const segments = [];
  let start = null;
  windows.forEach((window, index) => {
    if (predicate(window) && start === null) start = index;
    const closes = start !== null && (!predicate(window) || index === windows.length - 1);
    if (closes) {
      const endIndex = predicate(window) && index === windows.length - 1 ? index + 1 : index;
      const duration = (endIndex - start) * windowSeconds;
      if (duration >= minSeconds) segments.push({ kind, start: rounded(start * windowSeconds, 2), end: rounded(endIndex * windowSeconds, 2), duration: rounded(duration, 2) });
      start = null;
    }
  });
  return segments;
}

export function analyzePcm(samples, sampleRate, thresholds = {}) {
  if (!samples?.length || !Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error("PCM samples and a positive sample rate are required.");
  const policy = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const windowSize = Math.max(1, Math.round(sampleRate * 0.1));
  const windowSeconds = windowSize / sampleRate;
  let peak = 0;
  let energy = 0;
  let clipped = 0;
  const windows = [];

  for (let start = 0; start < samples.length; start += windowSize) {
    const end = Math.min(samples.length, start + windowSize);
    let windowEnergy = 0;
    let windowPeak = 0;
    let windowClipped = 0;
    for (let index = start; index < end; index += 1) {
      const value = Math.min(1, Math.abs(samples[index]));
      peak = Math.max(peak, value);
      windowPeak = Math.max(windowPeak, value);
      energy += value * value;
      windowEnergy += value * value;
      if (value >= 0.98) { clipped += 1; windowClipped += 1; }
    }
    const count = end - start;
    const rmsValue = Math.sqrt(windowEnergy / count);
    windows.push({
      index: windows.length,
      start: rounded(start / sampleRate, 2),
      end: rounded(end / sampleRate, 2),
      rmsDb: rounded(db(rmsValue), 1),
      peakDb: rounded(db(windowPeak), 1),
      clipPercent: rounded(windowClipped / count * 100, 2)
    });
  }

  const rms = Math.sqrt(energy / samples.length);
  const silenceWindows = windows.filter((window) => window.rmsDb < -42);
  const clipPercent = clipped / samples.length * 100;
  const silencePercent = silenceWindows.length / windows.length * 100;
  const quietFloorDb = percentile(windows.map((window) => window.rmsDb), 0.1);
  const peakDb = db(peak);
  const rmsDb = db(rms);
  const silenceSegments = createSegments(windows, (window) => window.rmsDb < -42, "silence", policy.minPauseSeconds, windowSeconds);
  const clippingSegments = createSegments(windows, (window) => window.clipPercent > policy.maxClipPercent, "clipping", 0.1, windowSeconds);
  const noisySegments = quietFloorDb > policy.maxQuietFloorDb ? createSegments(windows, (window) => window.rmsDb > policy.maxQuietFloorDb && window.peakDb < -7, "noise", 0.2, windowSeconds) : [];

  const findings = [];
  if (clipPercent > policy.maxClipPercent) findings.push({ id: "clipping", severity: "critical", title: "Clipping exceeds policy", evidence: `${rounded(clipPercent, 2)}% of samples reach the PCM ceiling; maximum ${policy.maxClipPercent}%.` });
  if (silencePercent > policy.maxSilencePercent) findings.push({ id: "silence", severity: "warning", title: "Silence ratio is high", evidence: `${rounded(silencePercent)}% of windows are below -42 dBFS; maximum ${policy.maxSilencePercent}%.` });
  if (quietFloorDb > policy.maxQuietFloorDb) findings.push({ id: "noise", severity: "warning", title: "Quiet-floor proxy is elevated", evidence: `${rounded(quietFloorDb)} dBFS at the 10th percentile; maximum ${policy.maxQuietFloorDb} dBFS.` });
  if (peakDb < policy.minPeakDb) findings.push({ id: "level", severity: "warning", title: "Peak level is low", evidence: `${rounded(peakDb)} dBFS peak; minimum ${policy.minPeakDb} dBFS.` });

  const penalty = Math.min(45, clipPercent * 8) + Math.max(0, silencePercent - policy.maxSilencePercent) * 0.7 + Math.max(0, quietFloorDb - policy.maxQuietFloorDb) * 1.5 + Math.max(0, policy.minPeakDb - peakDb) * 1.2;
  return {
    duration: rounded(samples.length / sampleRate, 2),
    sampleRate,
    sampleCount: samples.length,
    channelsAnalyzed: 1,
    metrics: {
      peakDb: rounded(peakDb),
      rmsDb: rounded(rmsDb),
      clipPercent: rounded(clipPercent, 2),
      silencePercent: rounded(silencePercent),
      quietFloorDb: rounded(quietFloorDb),
      pauseCount: silenceSegments.length
    },
    score: Math.max(0, Math.round(100 - penalty)),
    ready: findings.length === 0,
    findings,
    windows,
    segments: [...clippingSegments, ...silenceSegments, ...noisySegments].sort((a, b) => a.start - b.start),
    policy
  };
}

export function compareAnalyses(baseline, candidate) {
  const keys = ["peakDb", "rmsDb", "clipPercent", "silencePercent", "quietFloorDb", "pauseCount"];
  return Object.fromEntries(keys.map((key) => [key, rounded(candidate.metrics[key] - baseline.metrics[key], key === "clipPercent" ? 2 : 1)]));
}

export function parsePcm16Wav(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const text = (offset, length) => String.fromCharCode(...new Uint8Array(arrayBuffer, offset, length));
  if (text(0, 4) !== "RIFF" || text(8, 4) !== "WAVE") throw new Error("Only RIFF/WAVE audio is supported by the fixture parser.");
  let offset = 12;
  let format;
  let dataOffset;
  let dataSize;
  while (offset + 8 <= view.byteLength) {
    const id = text(offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") format = { audioFormat: view.getUint16(offset + 8, true), channels: view.getUint16(offset + 10, true), sampleRate: view.getUint32(offset + 12, true), bits: view.getUint16(offset + 22, true) };
    if (id === "data") { dataOffset = offset + 8; dataSize = size; break; }
    offset += 8 + size + (size % 2);
  }
  if (!format || dataOffset === undefined || format.audioFormat !== 1 || format.bits !== 16) throw new Error("Expected 16-bit PCM WAV audio.");
  const frameCount = Math.floor(dataSize / (format.channels * 2));
  const samples = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    let mixed = 0;
    for (let channel = 0; channel < format.channels; channel += 1) mixed += view.getInt16(dataOffset + (frame * format.channels + channel) * 2, true) / 32768;
    samples[frame] = mixed / format.channels;
  }
  return { samples, sampleRate: format.sampleRate, channels: format.channels };
}

export function buildAudioReport(source, analysis, baseline, decision) {
  return {
    product: "VoiceGauge Local",
    mode: "local deterministic signal analysis",
    generatedAt: new Date().toISOString(),
    source,
    analysis,
    baselineComparison: baseline ? compareAnalyses(baseline, analysis) : null,
    humanDecision: decision,
    disclaimer: "Synthetic or locally selected audio only; no transcription, biometric inference, upload, or production delivery action."
  };
}
