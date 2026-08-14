# @virtualis/stethoscope-sdk

Browser SDK for Mintti Smartho Bluetooth digital stethoscopes. Handles pairing,
the vendor BLE/ADPCM audio protocol, the tuned heart-sound DSP chain, live beat
detection and a processed `MediaStream` you can send straight into a WebRTC call.

Zero UI, zero framework dependencies. React bindings are an optional entry point.

## Install

Copy `src/sdk/stethoscope/` into your project (or publish it as a package) and
import it. No runtime dependencies; React is an optional peer.

## Headless usage

```ts
import { StethoscopeClient } from "@virtualis/stethoscope-sdk";

const scope = new StethoscopeClient();

scope.subscribe((s) => {
  console.log(s.status, s.liveBpm, s.capturing);
});

await scope.autoPair();               // reuse a previously granted device
// or: await scope.scan(); await scope.connect(uuid)

await scope.startCapture();           // heart sounds start flowing
scope.update({ mode: "bell", gain: 1, monitoring: false });

const stream = scope.getState().callStream;  // processed audio for WebRTC
const analyser = scope.getState().analyser;  // for waveform / spectrum drawing

scope.startRecording();
const clip = scope.stopRecording();   // { url, seconds } WAV blob URL

scope.destroy();
```

## React usage

```tsx
import { useStethoscope } from "@virtualis/stethoscope-sdk/react";

function Panel() {
  const s = useStethoscope({ settings: { monitoring: false } });
  if (!s.connected) return <button onClick={s.autoPair}>Pair</button>;
  return (
    <button onClick={s.capturing ? s.stopCapture : s.startCapture}>
      {s.capturing ? `Listening · ${s.liveBpm ?? "--"} bpm` : "Listen"}
    </button>
  );
}
```

`useStreamAnalyser(stream)` builds an `AnalyserNode` for any `MediaStream`
(e.g. the remote peer's audio in a call) so you can draw the same waveform on
both ends.

## Twilio Video adapter

```ts
import Video from "twilio-video";
import { bindStethoscopeToRoom } from "@virtualis/stethoscope-sdk/adapters/twilio";

const room = await Video.connect(token, { name: "consult-123" });

// Publishes a named "stethoscope" track whenever capture is on, and
// unpublishes it when the clinician stops listening.
const stop = bindStethoscopeToRoom({ room, Video, client: scope });
```

One-shot control instead:

```ts
const pub = await publishStethoscope({ room, Video, client: scope });
pub.unpublish();
```

The track is published separately from the mic (so speech keeps working) with
`contentHint = "music"` and high priority, which stops Twilio's voice
processing from filtering out the 20–220 Hz heart band. On the doctor side,
subscribe as usual and match on `track.name === "stethoscope"`.

`twilio-video` is not a dependency — the module is passed in, so the SDK stays
dependency-free and works the same with LiveKit/Daily via `client.callStream`.

## API

**`new StethoscopeClient({ transport?, settings? })`**

| method | purpose |
| --- | --- |
| `subscribe(fn)` / `getState()` | state store; `fn` fires on every change |
| `scan()` / `connect(uuid)` / `autoPair()` / `disconnect()` | pairing |
| `startCapture()` / `stopCapture()` | auscultation on/off |
| `update(settings)` | mode, channel, gain, bass, denoise, beatBoost, monitoring |
| `startRecording()` / `stopRecording()` | WAV clip of the raw device audio |
| `selectAudioChar` / `setPcmFormat` / `wakeDevice` / `addVendorService` / `setTransport` | low-level diagnostics |
| `destroy()` | tear down BLE + audio graph |

Key state: `status`, `connected`, `capturing`, `devices`, `battery`, `version`,
`heartRate` (firmware), `liveBpm` + `beatTick` (measured locally), `elapsed`,
`analyser`, `callStream`, `lastClip`, `error`, `diag`, `pressWarning`.

## Settings and defaults

Validated on real hardware — do not raise them without testing:

```ts
{ mode: "bell", channel: "result", gain: 1, bass: 1,
  denoise: true, beatBoost: 1, monitoring: true }
```

`mode`: `bell` (heart, 20–220 Hz) · `diaphragm` (lung) · `wide` (full spectrum).

## Transports

Auto-detected in this order:

1. `native` — iOS/Android host bridge via `window.webkit.messageHandlers` (see
   `docs/mintti-ios-bridge.md`).
2. `webble` — direct Web Bluetooth (Chrome/Edge desktop, Chrome Android).
3. `simulator` — synthetic heart sounds, for development without hardware.

Override with `new StethoscopeClient({ transport: "simulator" })`.

## Requirements

- Secure context (HTTPS or localhost) — Web Bluetooth and Web Audio require it.
- Client-side only: construct the client after hydration, never during SSR.
- `AudioWorklet` support (all modern browsers).

## Layout

```
index.ts                  headless entry
react.ts                  React entry (hooks)
core/client.ts            StethoscopeClient — state, pairing, capture, recording
core/audio-graph.ts       tuned filter/limiter/exciter chain
core/beat-tracker.ts      beat detection + automatic level rider
core/transport/           mintti (protocol), webble (BLE), ima-adpcm (decoder),
                          pcm-stream (AudioWorklet), wav, types
adapters/twilio.ts        publish the processed track into a Twilio Video Room
react/                    useStethoscope, useStreamAnalyser
```
