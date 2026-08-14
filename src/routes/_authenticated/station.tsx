import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/station")({
  beforeLoad: () => {
    throw redirect({ to: "/doctor" });
  },
  component: () => null,
});
