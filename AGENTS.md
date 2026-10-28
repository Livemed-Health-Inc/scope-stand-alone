<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->
- Bedside nurse identity (unit_nurses, OTP/TOTP secrets, nurse_sessions) is verified only in src/lib/nurse-otp.functions.ts with the admin client; secret tables have no client grants — keeps codes and authenticator secrets off the browser.
- Bedside consults reach Virtualis Chat only via server-to-server calls (src/lib/virtualis-chat.server.ts, /api/public/consult-*) signed with VIRTUALIS_ONCALL_KEY; bedside_consults tables have no client grants and are read through device-token server fns — keeps PHI off the browser except the owning tablet.
- Virtualis One is an additive authenticated frontend at /one: reuse DoctorStation's renderWorkspace seam and keep its native VideoVisit outside tab content so panel changes cannot tear down the call.
- Derive workspace referral context only from the authorized existing call; a call ID is not a canonical One encounter ID, and no parallel patient store or identity authority is permitted.
- Keep remote history, Chat thread, Note, capture and billing panels disconnected until approved encounter-scoped contracts exist; never pass credentials or PHI through legacy ProductEmbed for the unified workspace.
