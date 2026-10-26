# Send bedside consults into Virtualis Chat, then call when the doctor is ready

The consult goes to the doctor in Virtualis Chat first, the same way Virtualis consults arrive today. The video call only happens after the doctor tells the nurse he is available.

## The flow
1. The nurse fills in New Consult and taps **Send consult**.
2. The consult is sent to the on-call doctor for each chosen specialty in Virtualis Chat. It shows up as a normal Virtualis consult in their inbox, with the patient, MRN, room, acuity, reason and "From RN Tomika Hassan, Minnesota University Hospital · Emergency Department".
3. The bedside shows a waiting card: "Consult sent to Dr. Ryan (Cardiology) · Waiting for the doctor". There are no Call buttons yet.
4. In Virtualis Chat, the consult has two buttons: **Available to see patient** and **Can't take this**.
5. When the doctor taps **Available**, the bedside card turns green with a chime: "Dr. Ryan is available to see the patient". A **Start video visit** button appears, and it rings the doctor the same way calls ring today.
6. If the doctor taps **Can't take this**, or nobody answers within the acuity time (5 min for Critical, 30 min for Urgent, 4 hr for Routine), the nurse sees that and can resend to another doctor.

## How the doctor is matched
The doctor is matched by email: their login here must use the same email as their Virtualis account. If no matching Virtualis account is found, the nurse sees "Not delivered to Virtualis Chat · Call directly", and the current Call button is offered as a backup.

## Two parts
1. **This app (I build it):** sending the consult, the waiting and available cards on the bedside, and a secure receiver for the doctor's reply.
2. **Virtualis (you paste instructions there):** receiving the consult into the inbox, the Available / Can't take this buttons, and sending the reply back. I'll write the exact instructions as a file, like last time.

## Technical details
- New table `bedside_consults` (id, device_id, site_id, nurse_name, patient_name, mrn, room, acuity, reason, specialties, physician_id, physician_email, status `sent|available|declined|expired|undelivered|called`, virtualis_thread_id, responded_at, call_id, timestamps). No client grants: the device reads its rows through a `device_consults(_device_token)` RPC, polled about every 3 seconds (the bedside is not signed in, so it can't use live updates).
- Server fn `submitBedsideConsult` in `src/lib/virtualis-consult.functions.ts`: verifies the device token and nurse session, picks the on-call physician per specialty (available first), saves the row and POSTs to Virtualis `POST /api/public/bedside-consult` with header `x-virtualis-key` (reuses `VIRTUALIS_ONCALL_KEY`). It retries 3 times, is idempotent on the consult id, and records an audit entry with `phi_accessed = true`.
- Server route `src/routes/api/public/consult-response.ts`: Virtualis POSTs `{ consult_id, physician_email, response: available|declined }` with the same key. The handler checks the key in constant time and checks that the email matches the assigned physician, then updates the status.
- "Start video visit" calls the existing `place_public_call` with the consult fields plus a `_consult_id` that links the two. It is only allowed when the status is `available`.
- Virtualis side: creates `threads`, adds the doctor in `thread_members` as `consultant` and in `consult_assignments`, adds a system message, and shows the two response buttons on threads with source `bedside`. It POSTs the reply to `https://virtualisconsult.com/api/public/consult-response`.
- Tests: picking a physician per specialty, the status changes (Start only after `available`), the acuity expiry times, and rejection of a bad key or wrong physician.
