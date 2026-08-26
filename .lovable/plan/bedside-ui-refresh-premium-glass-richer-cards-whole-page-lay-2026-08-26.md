# Bedside UI refresh — premium glass, richer cards, whole-page layout

## Goal

Redesign the `/nurse` bedside station so it feels more creative while staying clinically simple: premium glassmorphism surfaces, specialty iconography, full-page layout, and richer physician cards with clear status.

## Visual direction (locked from preferences)

- **Creative direction:** Premium glassmorphism — translucent panels over the existing Virtualis off-white canvas, subtle depth, refined status glows.
- **Scope:** Whole page layout, not just one component.
- **Detail level:** Richer cards with icons plus subtle motion.
- **Palette stays inside the Virtualis brand:** oklch off-white canvas, deep navy ink, electric-blue signal, success/warning accents already in `src/styles.css`.

## What changes

1. **Global glass tokens in `src/styles.css`**
   - Add `--glass`, `--glass-border`, `--glass-shadow`, `--glow-success`, `--glow-warning`.
   - Add a new `@utility glass-card` so every bedside card reuses the same frosted panel.

2. **Header / identity bar**
   - Expand the hospital/unit header into a full-width glass banner that spans edge-to-edge.
   - Increase hospital name typography weight and add a subtle blue left-edge accent.
   - Keep the "online count" as a floating status chip with a pulsing green dot.

3. **Specialty directory**
   - Replace the uniform grid with large, full-width glass cards stacked vertically.
   - Give each specialty a unique, simple icon (Cardiology = heart pulse, Pulmonology = lungs, Neurology = brain, etc.).
   - Show a colored availability strip on the left edge: green when physicians are available, muted gray when none.
   - Add a hover lift and a soft glow on focus/active.

4. **Physician list (selected specialty)**
   - Convert physician rows into full-width glass cards with a rounded avatar, initials, and a prominent status ring.
   - Status as an icon + label pill: "Online · Available", "In consult", "Offline".
   - Large, high-contrast "Call" action button anchored to the right.
   - Mock/demo physicians get a subtle "demo" badge instead of a misleading offline status.

5. **Rounding alert banner**
   - Make the alert a full-width floating glass panel with a strong left-border glow.
   - Keep the pulsing bell but refine it to a softer, slower ring pulse.
   - Add a clear two-step action: "Acknowledge" opens the room confirmation; the banner itself is tappable to prime audio.

6. **Staged-cart / ringing-call cards**
   - Use the same glass-card utility so all transient states share one visual language.
   - Add a progress shimmer on the ringing card so it can't be missed.

7. **Micro-interactions**
   - Cards lift on hover/focus (`translateY(-2px)`, shadow deepen) using CSS transitions.
   - Status rings use the existing `ring-pulse` animation but toned down.
   - Page enters with a staggered fade-in for cards on first load.

## Technical details

- Files touched:
  - `src/styles.css` — new tokens + `glass-card` utility.
  - `src/components/NurseStation.tsx` — new layout, specialty icons, physician cards, alert banner.
  - `src/routes/nurse.tsx` — optional: remove wrapper width caps so content can go full-width on tablets.
- No new runtime dependencies; use existing `lucide-react` icons.
- Keep existing logic (data loading, call placement, rounding) unchanged; this is a visual-only refactor.

## Out of scope

- No changes to the video-visit screen.
- No changes to authentication or device registration.
- No new backend tables or RPCs.
