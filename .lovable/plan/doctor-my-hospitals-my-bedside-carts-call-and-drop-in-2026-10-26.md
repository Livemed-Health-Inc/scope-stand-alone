# Doctor: my hospitals, my bedside carts, Call and Drop in

## What the doctor sees (waiting room)
A new "My hospitals" section above the waiting room:
- One card per assigned hospital and unit, taken from the doctor's active assignments.
- Each card lists that unit's active bedside carts: label, online/offline (last seen in the past 2 minutes), and whether a call is already in progress.
- Each cart has two buttons:
  - **Call**: rings the bedside cart. The nurse taps Answer or Decline, and the call opens in the same video + stethoscope screen used today.
  - **Drop in**: the cart shows a full-screen "Dr. X is dropping in" banner with a 10-second countdown and a Decline button. If nobody declines, the video opens automatically so the doctor can see the patient.
- Both buttons are disabled when the cart is offline or already on a call.

## What the bedside cart sees
- A pulsing incoming-call screen with a ringtone that shows the doctor's name and specialty, with Answer / Decline buttons (Call), or the countdown banner (Drop in).
- After the call is answered, both sides join the existing consult video visit.

## Safety and audit
- A doctor can only see and call carts at hospitals they are assigned to. The database checks this, not just the screen.
- Each call is logged as a visit (who, which cart, call or drop-in, answered/declined/missed) and appears in analytics and the audit trail.
- Unanswered calls are marked missed after 45 seconds.

## Technical details
- Migration: add `calls.initiated_by text default 'nurse'` ('nurse' | 'doctor') and `calls.mode text default 'call'` ('call' | 'drop_in'). Both are additive.
- New security-definer RPCs:
  - `my_bedside_stations()` returns devices joined to sites, filtered to the caller's active `doctor_assignments`, with `last_seen` and an active-call flag.
  - `doctor_call_device(_device_id, _mode)` checks the caller's doctor role and assignment, then inserts a `calls` row (`status 'ringing'`, `doctor_id = auth.uid()`, `device_id`, hospital/unit from the site) and logs a call event.
  - `device_incoming_call(_device_token)` returns the newest ringing doctor-initiated call for that cart, with the doctor's name and specialty.
  - `answer_public_call(_device_token, _call_id, _accept bool)` lets the bedside accept or decline.
- `DoctorStation.tsx`: new `MyStations` component. Outgoing calls show a "Calling…" state and open `VideoVisit` once the status is 'accepted'; the existing poll/realtime `loadCalls` must not treat doctor-initiated ringing calls as incoming.
- `NurseStation.tsx`: poll `device_incoming_call` every 3 seconds, render the incoming/drop-in overlay, auto-accept drop-in after the countdown, then enter `VideoVisit` as role patient.
- Tests: the assignment gate (an unassigned doctor is rejected) and the drop-in auto-accept timing.
