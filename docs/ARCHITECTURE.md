# Architecture

## Product Boundary

VoiceGauge Local is a static browser signal-inspection product. It does not upload audio, transcribe speech, infer identity or emotion, denoise a recording, or approve production delivery automatically.

```text
Generated WAV fixture or local audio file
                    |
                    v
         Browser Web Audio decoding
                    |
                    v
         Mono Float32 PCM in memory
                    |
        +-----------+------------+
        |                        |
        v                        v
  100 ms window metrics     Canvas waveform
        |                        |
        v                        v
 Threshold findings       Timed overlays
        |                        |
        +-----------+------------+
                    v
        Baseline comparison + human gate
                    |
                    v
             Local JSON report
```

## Deterministic Fixtures

`tools/generate-fixtures.mjs` creates four mono 16-bit PCM WAV files at 16 kHz. A seeded linear congruential generator provides repeatable noise. Harmonic carriers, amplitude envelopes, pause geometry, gain, and noise define the four cases. No recorded or synthesized words are present.

## Analysis Engine

`assets/audio-engine.mjs` has no DOM dependency.

| Function | Responsibility |
| --- | --- |
| `analyzePcm` | Measure peak/RMS, clipping, silence, quiet-floor proxy, pause segments, findings, and score. |
| `compareAnalyses` | Produce metric deltas from the clear baseline. |
| `parsePcm16Wav` | Parse committed PCM fixtures in deterministic Node tests. |
| `buildAudioReport` | Preserve source metadata, raw analysis, comparison, human decision, and disclosure. |

The browser uses `AudioContext.decodeAudioData` for actual fixture and local-file decoding. Multichannel local files are averaged into one analysis channel; the original browser object URL remains available to the native audio player.

## Window Policy

- Window length: 100 milliseconds.
- Silence boundary: below -42 dBFS.
- Clipping sample boundary: absolute normalized sample at or above 0.98.
- Quiet-floor proxy: 10th-percentile window RMS.
- Pause segment: contiguous silent windows meeting the configured minimum duration.

## Trust Boundaries

- Fixture boundary: committed WAVs are generated and reproducible.
- File boundary: local files are decoded in memory and never transmitted.
- Signal boundary: findings describe PCM characteristics, not speech meaning or a person.
- Policy boundary: thresholds are visible and adjustable; raw metrics remain available.
- Human boundary: the analyzer never owns the handoff decision.
- Export boundary: every report states that no transcription, biometric inference, or upload occurred.

## Production Extension Path

A production audio platform could add LUFS/EBU R128 measurement, true-peak oversampling, channel layout checks, codec/container inspection, encrypted project storage, role-based review, consent-aware transcription, and calibrated monitoring. Those capabilities require different privacy, security, and validation controls and are deliberately outside v1.0.0.
