import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { analyzePcm, buildAudioReport, compareAnalyses, parsePcm16Wav } from "../assets/audio-engine.mjs";

async function analyze(name, thresholds) {
  const bytes = await readFile(new URL(`../data/audio/${name}`, import.meta.url));
  const parsed = parsePcm16Wav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return { parsed, analysis: analyzePcm(parsed.samples, parsed.sampleRate, thresholds) };
}

const clear = await analyze("clear-brief.wav");
const clipped = await analyze("clipped-brief.wav");
const noisy = await analyze("noisy-brief.wav");
const paused = await analyze("pause-heavy.wav");

assert.equal(clear.parsed.sampleRate, 16000);
assert.equal(clear.parsed.channels, 1);
assert.equal(clear.analysis.duration, 6.2);
assert.equal(clear.analysis.ready, true);
assert.equal(clear.analysis.score, 100);
assert.equal(clear.analysis.findings.length, 0);
assert.equal(clear.analysis.metrics.pauseCount, 2);

assert.equal(clipped.analysis.ready, false);
assert.deepEqual(clipped.analysis.findings.map((finding) => finding.id), ["clipping"]);
assert.ok(clipped.analysis.metrics.clipPercent > 15);
assert.equal(clipped.analysis.metrics.peakDb, 0);
assert.ok(clipped.analysis.segments.some((segment) => segment.kind === "clipping"));

assert.equal(noisy.analysis.ready, false);
assert.deepEqual(noisy.analysis.findings.map((finding) => finding.id), ["noise"]);
assert.ok(noisy.analysis.metrics.quietFloorDb > -25);
assert.ok(noisy.analysis.segments.some((segment) => segment.kind === "noise"));

assert.equal(paused.analysis.ready, false);
assert.deepEqual(paused.analysis.findings.map((finding) => finding.id), ["silence"]);
assert.ok(paused.analysis.metrics.silencePercent >= 55);
assert.ok(paused.analysis.metrics.pauseCount >= 3);

const permissiveClip = await analyze("clipped-brief.wav", { maxClipPercent: 25 });
assert.equal(permissiveClip.analysis.ready, true);
const permissiveSilence = await analyze("pause-heavy.wav", { maxSilencePercent: 70 });
assert.equal(permissiveSilence.analysis.ready, true);

const comparison = compareAnalyses(clear.analysis, clipped.analysis);
assert.ok(comparison.clipPercent > 15);
assert.ok(comparison.peakDb > 5);

const report = buildAudioReport({ id: "clipped-brief", local: false }, clipped.analysis, clear.analysis, { action: "rerecord", note: "Clipping exceeds policy." });
assert.equal(report.product, "VoiceGauge Local");
assert.equal(report.humanDecision.action, "rerecord");
assert.match(report.disclaimer, /no transcription/);
assert.throws(() => parsePcm16Wav(new ArrayBuffer(44)), /RIFF\/WAVE/);
assert.throws(() => analyzePcm([], 16000), /PCM samples/);

console.log("VOICEGAUGE AUDIO TESTS PASSED");
console.log(JSON.stringify({ fixtures: 4, sampleRate: 16000, clearReady: true, clipping: true, noise: true, silence: true, policyTuning: true, comparison: true, report: true }));
