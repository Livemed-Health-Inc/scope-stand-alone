import { useState, type ReactNode } from "react";
import { Building2, FileText, History, MessageSquare, MicOff, Stethoscope, Unplug, ReceiptText, ExternalLink } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { workspaceContext, WORKSPACE_CONNECTIONS, type WorkspaceCall } from "@/lib/workspace-context";

const PANELS = [
  { id: "consult", label: "Consult & video", icon: Stethoscope },
  { id: "history", label: "Patient history", icon: History },
  { id: "chat", label: "Virtualis Chat", icon: MessageSquare },
  { id: "note", label: "Virtualis Note", icon: FileText },
  { id: "billing", label: "Coding & RVUs", icon: ReceiptText },
];

function Unavailable({ title, children }: { title: string; children: ReactNode }) {
  return <div className="py-6">
    <div className="flex flex-wrap items-center gap-2"><Unplug className="size-5 text-muted-foreground" /><h2 className="text-lg font-semibold">{title}</h2><Badge variant="secondary">Not connected</Badge></div>
    <div className="mt-3 max-w-2xl space-y-4 text-sm text-muted-foreground">{children}</div>
  </div>;
}

/** Native call lives outside tab content: changing panels never remounts media. */
export function EncounterWorkspace({ call, station }: { call: WorkspaceCall | null; station: ReactNode }) {
  const [panel, setPanel] = useState("consult");
  const context = workspaceContext(call);
  const { can } = useAuth();
  return <section aria-label="Virtualis One encounter workspace" className="min-w-0">
    <div className="border-b border-border bg-card px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-semibold text-primary">LiveMed · Physician workspace</p><h1 className="mt-1 text-2xl font-semibold">Virtualis One</h1></div>
        <Badge variant="secondary">{context ? "Accepted consult" : "Waiting room"}</Badge>
      </div>
      {context ? <div className="mt-4 space-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1"><h2 className="text-lg font-semibold break-words">{context.patientName}</h2>{context.mrn && <span className="text-sm text-muted-foreground">MRN {context.mrn}</span>}{context.acuity && <Badge variant="outline">{context.acuity}</Badge>}</div>
        <p className="flex items-start gap-2 text-sm text-muted-foreground"><Building2 className="mt-0.5 size-4 shrink-0" /><span>{context.hospital} · {context.unit}{context.room ? ` · Room ${context.room}` : ""}</span></p>
        <p className="break-words text-sm">{context.reason}</p>
        {context.specialties.length > 0 && <p className="text-xs text-muted-foreground">{context.specialties.join(" · ")}</p>}
        {context.nurseName && <p className="text-xs text-muted-foreground">Referring nurse: {context.nurseName}</p>}
        <p className="break-all font-mono text-[11px] text-muted-foreground">Consult call: {context.callId} · One encounter not linked</p>
      </div> : <p className="mt-3 text-sm text-muted-foreground">No active patient consult</p>}
    </div>
    <Tabs value={panel} onValueChange={setPanel} className="min-w-0">
      <div className="overflow-x-auto border-b border-border px-4 py-3 sm:px-6"><TabsList aria-label="Encounter panels" className="w-max max-w-none">{PANELS.map(({ id, label, icon: Icon }) => <TabsTrigger key={id} value={id} className="gap-2"><Icon className="size-4" />{label}</TabsTrigger>)}</TabsList></div>
      <div className={call || panel === "consult" ? "px-4 py-4 sm:px-6" : "hidden"} aria-hidden={!call && panel !== "consult"}>
        {station}
      </div>
      <div className="px-4 sm:px-6">
        <TabsContent value="consult"><p className="pb-4 text-xs text-muted-foreground">{context ? "Canonical patient history and documentation are not linked to this call." : "Patient details appear when a bedside consult is accepted."}</p></TabsContent>
        <TabsContent value="history"><Unavailable title="Patient history"><p>One’s patient and encounter connection is not configured here. Prior visits, medications, allergies, and results are unavailable.</p>{context && <p>Current referral: {context.reason}</p>}</Unavailable></TabsContent>
        <TabsContent value="chat"><Unavailable title="Virtualis Chat thread"><p>{can("platform.chat") ? "The existing bedside-to-Chat delivery workflow is unchanged. This workspace does not yet have an authorized encounter-thread connection." : "Your account does not have Virtualis Chat access."}</p><p>No messages are loaded or sent from this panel.</p>{can("platform.chat") && <Button variant="outline" asChild><a href="https://virtualischat.com" target="_blank" rel="noopener noreferrer"><ExternalLink />Open standalone Chat</a></Button>}</Unavailable></TabsContent>
        <TabsContent value="note"><Unavailable title="Virtualis Note"><p>{can("platform.note") ? "Encounter-bound notes and ambient capture are not connected." : "Your account does not have Virtualis Note access."}</p><div className="flex flex-wrap items-center gap-3"><Button variant="secondary" disabled={!WORKSPACE_CONNECTIONS.ambientCapture}><MicOff />Capture unavailable</Button><span>Not recording</span></div><p>Capture requires participant consent, media permissions, both participants’ call audio, and an approved encounter connection. No audio is recorded or sent to Note.</p>{can("platform.note") && <Button variant="outline" asChild><a href="https://virtualisnote.ai" target="_blank" rel="noopener noreferrer"><ExternalLink />Open standalone Note</a></Button>}</Unavailable></TabsContent>
        <TabsContent value="billing"><Unavailable title="Coding & RVU review"><p>No ICD-10, billing-code, or RVU recommendations are available for this call. A connected, reviewed clinical note is required.</p><p>No note is signed and no claims or billing approvals are submitted here.</p><Button variant="secondary" disabled={!WORKSPACE_CONNECTIONS.billing}><ReceiptText />Recommendations unavailable</Button></Unavailable></TabsContent>
      </div>
    </Tabs>
  </section>;
}