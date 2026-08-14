# Video Visit feature

Portable telehealth screen: two-way WebRTC video/audio, PiP self-view, vitals
strip, and a Bluetooth stethoscope auscultation drawer.

```tsx
import { VideoVisit } from "@/features/video-visit";

<VideoVisit
  roomId={encounter.id}
  patient="Maria Lopez"
  room="Bed 4"
  title="Dr. Elena Vasquez"
  role={user.isNurse ? "patient" : "remote"}
  callerName={user.displayName}
  vitals={[{ label: "HR", value: "104", unit: "bpm", warn: true }]}
  showScribeBanner
  onEnd={() => router.back()}
/>
```

No router dependency — it is a plain React component.

## What it needs in the host app

- **Files to copy**
  - `src/features/video-visit/`
  - `src/lib/webrtc/` (`useAuscultationLink.ts`, `callRing.ts`)
  - `src/lib/stethoscope/`
  - `src/hooks/useStethoscope.ts`, `src/hooks/useStreamAnalyser.ts`
  - `src/components/stethoscope/` (`StethoscopePanel.tsx`, `Waveform.tsx`, `Spectrum.tsx`)
  - optional: `src/components/call/IncomingCallOverlay.tsx` for global ring notifications
- **Runtime deps**: `@supabase/supabase-js` (Realtime channel used for signalling,
  keyed by `roomId`), `lucide-react`, Tailwind, and the shadcn `Button` / `Slider` /
  `Switch` primitives.
- **Design tokens**: `--primary`, `--success`, `--destructive`, `--muted`,
  `--border`, `--card`, `--background`, `--foreground`.
- **Serving**: HTTPS (or localhost) — Web Bluetooth and `getUserMedia` require a
  secure context. TURN servers are configured in `useAuscultationLink.ts`; swap the
  public relay for your own before production.

## Props

| prop | purpose |
| --- | --- |
| `roomId` | signalling key — both devices must match |
| `role` | `"patient"` (bedside/nurse) or `"remote"` (doctor) |
| `patient`, `room`, `title` | display labels |
| `callerName` | name announced in the outgoing ring |
| `vitals` | vitals strip; omit or pass `[]` to hide |
| `placeholderVideoUrl` | filler clip until the peer camera arrives (demo only) |
| `showScribeBanner` | ALIS ambient-scribe banner |
| `allowRoleSwitch` | in-drawer side switcher (testing aid) |
| `allowRemoteLocalScope` | let the doctor pair a scope locally (testing aid) |
| `onEnd` | back arrow + "End visit" handler |