# Stethoscope UI

Ready-made React UI on top of the headless SDK in `src/sdk/stethoscope`.

```tsx
import { StethoscopePanel } from "@/features/stethoscope";

<StethoscopePanel
  onCallStream={(stream) => setScopeStream(stream)} // null when listening stops
  localMonitor={false}                              // don't play out of speakers
  brandIconUrl={logo}                               // optional
/>
```

Also exported: `Waveform`, `Spectrum`, and the SDK's `useStethoscope` /
`useStreamAnalyser` hooks for building your own UI.

Needs Tailwind, `lucide-react`, and shadcn `Button` / `Slider` / `Switch` at
`@/components/ui/*`, plus the `--primary` / `--success` / `--destructive` /
`--muted` / `--border` / `--card` / `--background` / `--foreground` tokens.

For device, protocol and audio-engine details see `src/sdk/stethoscope/README.md`.
