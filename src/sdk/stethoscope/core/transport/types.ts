/**
 * Adapter contract for a digital stethoscope source.
 *
 * To plug in the real Stethoscope SDK, implement this interface in a new file
 * (e.g. `sdk-adapter.ts`) and return it from `getAdapter()` in `adapters.ts`.
 * Everything else in the app (waveform, filters, A/V routing) works unchanged.
 */
export interface StethoscopeAdapter {
  id: string;
  label: string;
  description: string;
  /** Connect to the device and return a live audio node in the given context. */
  connect(ctx: AudioContext): Promise<AudioNode>;
  /** Tear down device resources. */
  disconnect(): Promise<void> | void;
}

export type AuscultationMode = "bell" | "diaphragm" | "wide";

export const MODE_FILTERS: Record<
  AuscultationMode,
  { low: number; high: number; label: string; hint: string }
> = {
  bell: { low: 20, high: 220, label: "Bell", hint: "20–220 Hz · heart sounds only" },
  diaphragm: { low: 100, high: 1000, label: "Diaphragm", hint: "100–1000 Hz · lungs, bowel" },
  wide: { low: 20, high: 2000, label: "Wide", hint: "20–2000 Hz · full spectrum" },
};