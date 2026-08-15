import { createFileRoute, Link } from "@tanstack/react-router";
import { Building2, PlusCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/tech/")({
  head: () => ({
    meta: [
      { title: "Installation Console — Virtualis Field Tech" },
      {
        name: "description",
        content: "Start a new facility install or add a bedside tablet to an existing Virtualis facility.",
      },
      { property: "og:title", content: "Installation Console — Virtualis Field Tech" },
      { property: "og:description", content: "Field technician console for activating Virtualis bedside tablets." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TechHome,
});

function TechHome() {
  return (
    <>
      <div>
        <p className="label-caps">Installation</p>
        <h1 className="text-2xl font-semibold tracking-tight">What are you setting up today?</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Activation codes are issued by a LiveMed administrator. Have the code ready before activating a tablet.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          to="/tech/activate"
          search={{ site: "", code: "" }}
          className="panel-surface group flex flex-col gap-2 p-5 transition hover:border-primary"
        >
          <PlusCircle className="size-6 text-primary" />
          <h2 className="text-lg font-semibold">New facility</h2>
          <p className="text-sm text-muted-foreground">
            First tablet at a hospital unit that was just created by LiveMed. Enter the activation code to bind this
            device.
          </p>
          <span className="mt-auto pt-3 text-sm font-medium text-primary group-hover:underline">Activate tablet →</span>
        </Link>

        <Link to="/tech/facilities" className="panel-surface group flex flex-col gap-2 p-5 transition hover:border-primary">
          <Building2 className="size-6 text-primary" />
          <h2 className="text-lg font-semibold">Existing facility</h2>
          <p className="text-sm text-muted-foreground">
            Add another bedside tablet to a hospital unit that is already live. Pick the unit, then enter its activation
            code.
          </p>
          <span className="mt-auto pt-3 text-sm font-medium text-primary group-hover:underline">Choose facility →</span>
        </Link>
      </div>
    </>
  );
}
