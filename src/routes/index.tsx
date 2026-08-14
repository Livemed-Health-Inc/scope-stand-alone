import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Stethoscope, Activity, Radio, ShieldCheck, Waves } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Virtualis Consult — Remote Stethoscope Consults" },
      {
        name: "description",
        content:
          "A standalone bedside-to-physician consult station: live physician presence, one-tap calls, and a remote digital stethoscope with audio-video exam.",
      },
      { property: "og:title", content: "Virtualis Consult — Remote Stethoscope Consults" },
      {
        property: "og:description",
        content: "Bedside nurses reach on-call physicians instantly, with a remote digital stethoscope exam built in.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) void navigate({ to: "/doctor" });
  }, [loading, user]);

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-4 py-16">
      <div className="flex items-center gap-2 text-primary">
        <Stethoscope className="size-6" />
        <span className="font-semibold tracking-tight text-foreground">Virtualis Consult</span>
      </div>

      <h1 className="mt-8 max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
        The bedside call button for on-call physicians — with a stethoscope built in.
      </h1>
      <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
        A standalone consult station. Nurses see who's on call and reach them in one tap. Physicians wait in a virtual
        room, accept the call, and run a remote auscultation and A/V exam.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Button asChild size="lg">
          <Link to="/nurse">Open nurse station</Link>
        </Button>
        <Button asChild size="lg" variant="secondary">
          <Link to="/auth">Physician sign in</Link>
        </Button>
      </div>

      <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { icon: Activity, title: "Live presence", body: "Physicians show online, offline or in-consult in real time." },
          { icon: Radio, title: "One-tap call", body: "Ring the right specialty from the unit, with room and reason." },
          { icon: Waves, title: "Remote stethoscope", body: "Cardiac and pulmonary sites, bell/diaphragm, live waveform." },
          { icon: ShieldCheck, title: "Role separated", body: "Nurse and physician workflows on separate secure accounts." },
        ].map((f) => (
          <li key={f.title} className="panel-surface p-4">
            <f.icon className="size-5 text-primary" />
            <p className="mt-3 font-medium">{f.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{f.body}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
