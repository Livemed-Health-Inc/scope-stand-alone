# Lock the bedside screen to activated tablets

## How it works today
- A tablet set up with an activation code is tied to that one browser. That part already works.
- The gap: anyone signed in with a hospital account can open the bedside screen on **any** computer, because it creates a temporary bedside session for them.

## What changes
- The bedside screen only opens on:
  1. Tablets activated with an activation code, and
  2. LiveMed admins using **Bedside view** from Hospital Onboarding (that tab only, as it works now).
- A hospital account signing in on another computer sees the activation screen ("This device isn't registered as a bedside tablet"), not the nurse station.
- If an admin deactivates a tablet, it drops back to the activation screen within a minute (already the case).

## Technical details
- `src/components/DeviceGate.tsx`: remove the fallback that calls `bedside_session_token` when no device token exists.
- Database: revoke `EXECUTE` on `bedside_session_token` from `authenticated` so it can't be called directly from the browser.
- Admin preview (`admin_preview_device` + `?preview=` token) and real activation stay unchanged.
- Check: with a hospital account signed in and no device token, `/nurse` shows the activation form; with the activated test tablet token it shows the station.
