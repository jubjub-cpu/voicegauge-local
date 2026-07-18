# Case Study

## Context

A content operations lead receives voice-oriented clips from several sources. One sounds overdriven, one has persistent background energy, and another contains long pauses. Sending every file to a hosted transcription or analysis service would create unnecessary privacy and vendor exposure before the team even knows whether the signal is usable.

## Product Question

How can a reviewer perform a transparent first-pass signal check locally, compare it with a known baseline, and preserve a human delivery decision?

## Product Response

VoiceGauge Local uses four generated speech-shaped fixtures to make the method inspectable. The default overdriven fixture reaches the PCM ceiling on more than 18% of samples, producing a critical clipping finding and red waveform overlays. The clear baseline has balanced peak/RMS values, two synthetic pauses, no clipping, and no policy findings. The noisy fixture raises the 10th-percentile quiet-floor proxy, while the pause-heavy fixture places three speech-shaped regions inside 60% silence.

The reviewer can adjust visible thresholds, but the raw metrics and finding IDs remain in the report. Accepting a source with findings requires a written reason. Requesting a re-record produces a separate audit action. Neither choice edits the underlying analysis.

## Key Decisions

- Analyze actual decoded samples instead of relying on filenames or metadata.
- Use generated WAV fixtures so privacy and reproducibility are stronger than stock voice clips.
- Explicitly avoid transcription, speaker identification, emotion inference, and biometric claims.
- Draw anomaly segments over the waveform so every finding has temporal context.
- Treat the score as a deterministic policy summary, not an AI perceptual judgment.
- Keep the human decision separate from threshold results.

## Validation Evidence

- All four generated WAV files parse as 16-bit mono PCM at 16 kHz.
- Logic tests distinguish ready, clipping, noise, and silence cases and verify policy tuning, comparison, and export.
- Browser tests decode the real fixtures through Web Audio, verify six metrics, inspect nonblank Canvas pixels, import a local WAV, export JSON, and exercise the human gate.
- Desktop and 390-pixel mobile workflows have no document overflow, console errors, or failed requests.

## Outcome

The project demonstrates real browser audio processing, local-first privacy design, visual signal evidence, and responsible product boundaries. It claims no customer use, production quality result, speech understanding, biometric capability, or measured review-time reduction.
