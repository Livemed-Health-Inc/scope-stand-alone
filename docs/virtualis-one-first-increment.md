# Virtualis One in Consult — bounded first increment

## Preview

`/one` — https://id-preview--28d15c76-d24b-45fb-86f5-8f9f6ca480b0.lovable.app/one

Entry: existing Virtualis One launcher tile or physician feature navigation. Existing `platform.one` and `doctor.station` permissions plus the existing physician persona are required. No permissions, identities or records were changed.

## Working reused features

- Existing doctor waiting room, incoming alerts, accept/decline/end, presence, hospital/cart assignments, calls/drop-ins and rounding workflow.
- Native `VideoVisit` and its Bluetooth stethoscope, separate scope audio, monitor waveform, camera selection and media lifecycle.
- Call/referral patient name, MRN, room, facility/unit, reason, acuity, specialty and referring nurse shared in the workspace header. Missing information is not fabricated. Call IDs are explicitly not canonical One encounter IDs.
- Panel changes retain the same native call outside tab content. Call end removes it. Standalone `/doctor` remains available and uses the existing default layout.
- Preview heart-audio labels now say “DEMO AUDIO — NOT A LIVE STETHOSCOPE” and “DEMO”; production gating, signal isolation and start/stop logic are unchanged.

## Remaining connections

- Canonical One patient/history/encounter linkage: unavailable. No competing store was created.
- Encounter-linked Chat thread read/reply connection: unavailable in this workspace. Existing signed server-to-server bedside delivery and nurse verification are untouched.
- Note launch/context, ambient capture, transcription, draft generation and signing: unavailable. No recording begins; capture stays disabled until an approved consent/media/both-participant-audio/encounter contract exists.
- ICD-10/billing/RVUs: unavailable; no fabricated results, claims, signatures or approvals.
- Mock EMR contract remains deferred.
- Standalone Chat/Note fallback actions open their public sites without copying any credentials or patient details.

## Source inspection

- Consult starting revision: `229a271d30bacb8646be9d20fc73ed39a1b895fd`.
- One read-only snapshot: `8b8a35c4` (project `2e29a090-42af-4198-bc03-522b3e857b96`). `docs/virtualis-one-unification.md` retains One as canonical platform. `docs/platform-api-v1.md` requires governed AAL2/facility entitlement and explicitly excludes encounter conversion, transcription, billing and signing. Draft writes remain activation-gated.
- Note read-only snapshot: `8236aef5` (project `eb9d503b-3831-420a-8d8b-d7ea0092bbc2`). Existing governed Note behavior was inspected, not imported or replaced.
- Chat read-only snapshot: `8b681df5` (project `3ec1480f-b477-4ac2-9b28-4cf3195bb527`). No authorized clinical embed/context contract found; preview-auth messaging was not reused.
- Existing Consult seams inspected: `src/lib/virtualis-chat.server.ts`, `src/lib/nurse-otp.functions.ts`, DoctorStation, VideoVisit, ProductEmbed and existing permission/auth flows. Legacy ProductEmbed is intentionally not used by One because it transfers sessions to external products.

## Exact changed files

- `src/routes/_authenticated/one.tsx` (new route/metadata)
- `src/components/EncounterWorkspace.tsx` (new panel shell)
- `src/components/EncounterWorkspace.test.tsx` (lifecycle tests)
- `src/lib/workspace-context.ts` (existing call context mapping/capability boundaries)
- `src/lib/workspace-context.test.ts` (mapping/fail-closed tests)
- `src/components/DoctorStation.tsx` (optional workspace render seam)
- `src/features/video-visit/VideoVisit.tsx` (optional embedded layout, truthful embedded status, demo labels)
- `src/components/FeatureNav.tsx` and `src/routes/_authenticated/home.tsx` (One entry points)
- `vitest.config.ts`, `package.json`, `bun.lock` (TSX tests and development-only renderer)
- `src/routeTree.gen.ts` (automatic generated route update, not manually edited)
- `AGENTS.md`, `roadmap.md`, this document (architecture and bounded verification record)
- Project memory records capture the user's constraints; no clinical or authentication database changes.

## Verification

- 31 tests pass across seven test files: eight call-context/capability tests, two workspace lifecycle/no-media-acquisition tests, plus existing nurse verification, consult routing/triage, drop-in and preview demo regression tests.
- Lifecycle test substitutes an instrumented native-call child; it proves shell tab changes preserve mount identity and call removal cleans up. It is not a real two-device call connectivity test.
- Automatic build/type verification succeeded after the test-config correction. No manual builds/typechecks were run.
- Authenticated Playwright check restored the requesting user's managed session and reached `/one`: physician access was denied, matching that account's non-doctor persona; no runtime errors. No role grants were altered to bypass this.
- Existing demo doctor password sign-in did not establish a session. Live doctor-call/tab switching and desktop/mobile workspace appearance remain unverified. Re-test with an existing doctor session before clinical use.
- Nothing published. No reference source projects modified, production-data migrations, identity-authority change, network integrations, recordings or clinical writes introduced.