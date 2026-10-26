# New Consult workflow on the bedside screen

Bring the Virtualis "New Consult" form to the bedside tablet so the nurse fills in the consult first, then calls a physician with the details attached.

## What the nurse sees
1. A large **New consult** button at the top of the bedside screen (the current specialty list stays below it).
2. The New Consult screen, with the same sections and order as Virtualis:
   - **Sending facility**: filled in with the tablet's hospital and unit (read-only, since the tablet belongs to one unit).
   - **Patient information**: an Existing / New patient toggle, patient name or room, and an optional MRN.
   - **Reason**: free text describing the condition.
   - **Acuity**: Critical (5 min), Urgent (30 min), or Routine (4 hr), shown as the same bar icons. A suggestion based on simple keywords appears ("Suggested: Urgent · Apply"), as in Virtualis when its model is unavailable.
   - **Specialists**: searchable chips. You can pick more than one.
   - **Send consult**: turns on once patient, reason, acuity and at least one specialty are filled in.
3. After sending, the nurse sees the on-call physicians for the chosen specialties, online ones first, each with a **Call** button. The call rings exactly as it does today.
4. **On the doctor side**, the incoming-call card and the video visit show the patient, room, reason and an acuity badge.

## What is left out
- The trained acuity/routing model and its feedback tracking. Virtualis falls back to keyword suggestions when the model is unavailable, and this screen does the same.
- Searching existing patients only finds patients from this tablet's earlier consults. There is no hospital record lookup, which matches Virtualis.

## Technical details
- New `src/components/NewConsult.tsx`, styled with this app's tokens and shadcn parts and copying the field structure of Virtualis `screens.jsx` `NewConsult`. `suggestAcuity` keyword rules go in `src/lib/consult/acuity.ts` with a unit test (for example, "chest pain" gives Critical).
- `NurseStation.tsx`: a `newConsult` view state. On send, the form data is kept and the physician list is filtered to the chosen specialties.
- Migration: add nullable `patient_name`, `mrn`, `acuity`, `specialties text[]` columns to `calls`. Extend `place_public_call` with optional `_patient_name`, `_mrn`, `_acuity`, `_specialties` parameters (old calls keep working). Extend `device_incoming_call`/`get_public_call` and the doctor's call query to return them.
- `DoctorStation.tsx` / `IncomingDoctorCall.tsx` / `VideoVisit.tsx` show the consult summary.
- Patient name and MRN are PHI: these are written to the audit log with `phi_accessed = true`, and the existing RLS on `calls` already limits them to call participants.
