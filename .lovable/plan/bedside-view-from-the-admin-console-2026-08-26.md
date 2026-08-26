# Bedside view from the admin console

Give admins a one-click, fully working bedside (nurse) screen for any activated hospital unit, straight from the Hospital Onboarding page.

## What the admin sees

- Each unit row on Hospital Onboarding gets a **Bedside view** button (next to Activation code / Activate-Deactivate).
- Clicking it opens the real nurse station for that hospital and unit in a new tab: the on-call directory, the rounding alerts, and the ability to place a consult call — exactly what a bedside tablet sees.
- The button is disabled for deactivated units, with a tooltip explaining why.
- The admin's own browser is never permanently registered as a bedside tablet: the preview session lives only in that tab and disappears when it is closed.

## How it works

1. **New database function** `admin_preview_device(_site_id uuid)` (security definer, admin-only via `is_admin(auth.uid())`):
   - Rejects the call if the site is inactive.
   - Creates (or rotates) a device row for that site labelled `Admin preview` with `status = 'active'`, storing only the SHA-256 hash of a freshly generated token, and returns the plaintext token once.
   - Reusing one dedicated preview device per site keeps the tablet list clean; the token is rotated on every preview so old links stop working.
   - `GRANT EXECUTE` to `authenticated` only.

2. **Preview token handling (frontend)**
   - `src/lib/device.ts`: add a session-scoped preview token (`sessionStorage`) that takes precedence over the persistent `localStorage` device token, so an admin preview tab never clobbers a real tablet's registration.
   - `src/components/DeviceGate.tsx`: on mount, if a `?preview=<token>` search param is present, store it in the session-scoped slot, strip it from the URL, and verify it through the existing `device_context` RPC. Everything downstream (`NurseStation`, calls, rounding) works unchanged because it reads the token through the same helper.

3. **Admin UI** (`src/routes/_authenticated/admin/hospitals.tsx`)
   - Add the **Bedside view** button per unit row: calls `admin_preview_device`, then opens `/nurse?preview=<token>` in a new tab. Errors surface as a toast.

## Notes

- The preview device shows up in that unit's tablet list as `Admin preview`, so it is visible and revocable like any other device.
- Calls placed from a preview session are real calls and will ring physicians — the bedside screen carries a small "Admin preview" indicator so this is obvious.
