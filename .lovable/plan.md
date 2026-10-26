# Nurse sign-in on the bedside screen (pick your name + text code)

Before using a bedside cart, the nurse picks their name from that unit's nurse list and enters a 6-digit code texted to their phone. Every consult and call is then tied to that nurse.

## What the nurse sees
1. Opening the bedside screen (or resuming after the privacy lock) shows **Who's at the bedside?** with a dropdown of the nurses who work on this unit.
2. They pick their name. The phone number shows masked, for example "Text a code to •••• 4821", with a **Send code** button.
3. They enter the 6-digit code. A correct code opens the station, and the header shows "RN Jane Doe · Sign out".
4. Rules: the code expires after 5 minutes, allows 5 tries, and can be resent once every 30 seconds. The nurse is signed out when the screen locks after 10 idle minutes, when they tap Sign out, or after 12 hours.
5. On New Consult and on the doctor's incoming call, the nurse's name fills in automatically ("from RN Jane Doe").

## What admins see
- Each unit on **Hospital Onboarding** gets a **Nurses** list where admins add, edit or remove a nurse's name and mobile number.
- Admin Bedside view previews skip the code step and show as "Admin preview".

## What you need to provide
- **A Twilio account and phone number** to send the texts. I'll open a card for you to connect it.
- The real nurse names and numbers for each unit. I'll add one demo nurse per unit with your number if you give it to me.

## Technical details
- New table `unit_nurses` (`site_id`, `full_name`, `phone_e164`, `is_active`). Grants, RLS: admin-only manage. Tablets read names only through a security-definer RPC `device_nurses(_device_token)` that returns id, name and the last 4 digits.
- New table `nurse_otps` (hashed code, nurse_id, device_id, expires_at, attempts, sent_at). No client access.
- New table `nurse_sessions` (token hash, nurse_id, device_id, expires_at). The plaintext token is stored in tab `sessionStorage`.
- Server functions (`src/lib/nurse-otp.functions.ts`), public but verified by device token: `sendNurseCode` (rate limited per nurse and device, sends SMS through the Twilio connector gateway) and `verifyNurseCode` (constant-time hash compare, attempt counter, issues the session token).
- `calls` gets a nullable `nurse_staff_id`. `place_public_call` takes an optional `_nurse_session` and records it. The doctor's incoming call shows the nurse's name.
- `DeviceGate.tsx` adds a `NurseVerify` step after device verification. The idle lock clears the nurse session.
- Audit log: `nurse.code_sent`, `nurse.verified`, `nurse.verify_failed`, `nurse.signed_out`.
- Tests: the code expires at 5 minutes, the 6th try is rejected, and a resend inside 30 seconds is rejected.
