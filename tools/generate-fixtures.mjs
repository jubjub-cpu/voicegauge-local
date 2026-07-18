import { mkdir, writeFile } from "node:fs/promises";

const sampleRate = 16000;
const output = new URL("../data/audio/", import.meta.url);

function random(seed) {
  let value = seed >>> 0;
  return () => {
    value = (1664525 * value + 1013904223) >>> 0;
    return (value / 0xffffffff) * 2 - 1;
  };
}

function normalEnvelope(time) {
  const longPause = (time > 1.45 && time < 2.0) || (time > 3.55 && time < 4.1);
  if (longPause) return 0;
  const pace = 3.4;
  const phase = (time * pace) % 1;
  return phase < 0.7 ? Math.sin(Math.PI * phase / 0.7) ** 0.72 : 0;
}

function sparseEnvelope(time) {
  const speaking = (time > 0.35 && time < 1.45) || (time > 3.25 && time < 4.2) || (time > 6.15 && time < 7.15);
  if (!speaking) return 0;
  const phase = (time * 3.1) % 1;
  return phase < 0.68 ? Math.sin(Math.PI * phase / 0.68) ** 0.76 : 0;
}

function synthesize({ duration, seed, gain, noise, sparse = false }) {
  const count = Math.floor(duration * sampleRate);
  const samples = new Float32Array(count);
  const nextNoise = random(seed);
  for (let index = 0; index < count; index += 1) {
    const time = index / sampleRate;
    const envelope = sparse ? sparseEnvelope(time) : normalEnvelope(time);
    const pitch = 132 + 18 * Math.sin(time * 1.7) + 8 * Math.sin(time * 4.1);
    const voiced = Math.sin(2 * Math.PI * pitch * time) + 0.42 * Math.sin(2 * Math.PI * pitch * 2 * time) + 0.18 * Math.sin(2 * Math.PI * pitch * 3 * time);
    const breath = nextNoise() * noise;
    const signal = gain * envelope * voiced / 1.6 + breath;
    samples[index] = Math.max(-1, Math.min(1, signal));
  }
  return samples;
}

function wavBytes(samples) {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const text = (offset, value) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, Math.round(sample < 0 ? sample * 32768 : sample * 32767), true));
  return new Uint8Array(bytes);
}

const fixtures = [
  { file: "clear-brief.wav", duration: 6.2, seed: 41, gain: 0.62, noise: 0.003 },
  { file: "clipped-brief.wav", duration: 6.2, seed: 42, gain: 2.65, noise: 0.006 },
  { file: "noisy-brief.wav", duration: 6.2, seed: 43, gain: 0.55, noise: 0.13 },
  { file: "pause-heavy.wav", duration: 8.0, seed: 44, gain: 0.62, noise: 0.0015, sparse: true }
];

await mkdir(output, { recursive: true });
for (const fixture of fixtures) {
  const samples = synthesize(fixture);
  await writeFile(new URL(fixture.file, output), wavBytes(samples));
  console.log(`${fixture.file}: ${samples.length} samples`);
}
