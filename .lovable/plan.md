# Isolate the live stethoscope waveform

## Goal
Ensure the auscultation monitor uses only the live stethoscope feed, never room microphone or call voice audio.

## Changes
- Send call microphone/video and stethoscope audio on separate WebRTC tracks with stable, explicit roles.
- Expose a dedicated incoming stethoscope stream to the receiving side.
- Drive both users’ waveforms only from the local or remote stethoscope-only stream.
- Keep call audio playback working while preventing it from entering the waveform analyser.
- Make remote stream updates stable to avoid waveform resets during camera changes.
- Reliably synchronize stethoscope status as soon as signaling connects.

## Verification
- Run the TypeScript check.
- Exercise a two-sided consult and confirm voice does not move the waveform, while stethoscope input does.
