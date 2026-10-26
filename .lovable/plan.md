# Send bedside consults into Virtualis Chat

When a nurse sends a consult and calls a doctor, the same consult also lands in that doctor's Virtualis Chat inbox, the same way Virtualis consults arrive today.

## How Virtualis receives consults today
A consult in Virtualis is a conversation with the patient, MRN, acuity and reason attached. The assigned doctor is added as the "consultant", so it shows up in their inbox with the acuity badge and an unread count.

## What the doctor will see
- A new conversation in their Virtualis inbox, titled like "Tele-Cardiology · Bedside consult".
- The patient, MRN, room, acuity and reason, shown as on any Virtualis consult.
- A first message: "Bedside consult from RN Tomika Hassan, Minnesota University Hospital · Emergency Department. Video call requested."
- It goes only to the doctor the nurse tapped **Call** on. If that doctor declines or misses the call, the conversation stays in their inbox.

## How the doctor is matched
The doctor is matched by email address: their login here must use the same email as their Virtualis account. If no Virtualis account matches, the call still rings here. The nurse sees "Not delivered to Virtualis Chat" and nothing else changes.

## Two parts
1. **This app (I build it):** when a call carries a consult, the consult is sent securely to Virtualis using the shared key you already set up. It is re-sent if delivery fails, and every attempt is recorded in the activity log.
2. **Virtualis (you paste instructions there):** a secure receiver that checks the key, finds the doctor by email, creates the consult conversation and adds the doctor as consultant. I'll write the exact instructions as a file, like last time.

## Technical details
- Virtualis side: `POST /api/public/bedside-consult` with header `x-virtualis-key` (`VIRTUALIS_ONCALL_KEY`, reused) and body `{ external_id (call id), physician_email, facility_name, unit, patient, mrn, room, acuity, reason, specialties[], nurse_name }`. Idempotent on `external_id`. It maps the facility by name (unmapped facilities use a "Virtualis Consult bedside" facility), creates `threads` + `thread_members(relationship='consultant')` + a system `messages` row + `consult_assignments`, all with the admin client after key verification. It returns `{ delivered, thread_id }` or `{ delivered:false, reason:'no_account' }`.
- This side: a new server fn `deliverConsultToVirtualis(callId)` in `src/lib/virtualis-consult.functions.ts`, called after `place_public_call` returns. It verifies the device token, loads the call with the admin client, and POSTs with a 3-try backoff. A new nullable `calls.virtualis_thread_id` column plus a `call_events` row for each attempt.
- PHI is sent only server-to-server over HTTPS and never returned to the browser. Audit entries use `phi_accessed = true`.
- Tests: payload building (no fields missing, acuity mapping) and idempotent retry.
