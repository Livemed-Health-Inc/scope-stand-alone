import React, { createContext, useContext, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EncounterWorkspace } from "./EncounterWorkspace";
import type { WorkspaceCall } from "@/lib/workspace-context";

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ can: () => true }) }));
// Headless tabs reproduce selection/mount semantics without browser layout APIs.
vi.mock("@/components/ui/tabs", () => {
  const Selection = createContext({ value: "consult", onValueChange: (_: string) => {} });
  return {
    Tabs: ({ value, onValueChange, children }: any) => <Selection.Provider value={{ value, onValueChange }}>{children}</Selection.Provider>,
    TabsList: ({ children }: any) => <div>{children}</div>,
    TabsTrigger: ({ value, children }: any) => { const ctx = useContext(Selection); return <button data-tab={value} onClick={() => ctx.onValueChange(value)}>{children}</button>; },
    TabsContent: ({ value, children }: any) => useContext(Selection).value === value ? <div>{children}</div> : null,
  };
});

const call: WorkspaceCall = { id: "test-call", patient_name: "Test patient", patient_room: "12", hospital: "Test hospital", unit: "Test unit", reason: "Test reason" };
let tree: ReactTestRenderer | undefined;
afterEach(async () => { if (tree) await act(async () => tree?.unmount()); tree = undefined; });
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("native call lifecycle", () => {
  it("retains one native call through every panel and releases it on call end", async () => {
    const mounted = vi.fn();
    const released = vi.fn();
    function NativeCall() { useEffect(() => { mounted(); return released; }, []); return <div data-call="native" />; }
    await act(async () => { tree = create(<EncounterWorkspace call={call} station={<NativeCall />} />); });
    const original = tree?.root.findByProps({ "data-call": "native" });
    for (const tab of ["history", "chat", "note", "billing", "consult"]) {
      await act(async () => tree?.root.findByProps({ "data-tab": tab }).props["onClick"]());
      expect(tree?.root.findByProps({ "data-call": "native" })).toBe(original);
      expect(mounted).toHaveBeenCalledTimes(1);
      expect(released).not.toHaveBeenCalled();
    }
    await act(async () => tree?.update(<EncounterWorkspace call={null} station={<div />} />));
    expect(released).toHaveBeenCalledTimes(1);
  });

  it("never acquires media or starts capture on Note panel selection", async () => {
    const acquire = vi.fn();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: acquire } });
    try {
      await act(async () => { tree = create(<EncounterWorkspace call={call} station={<div />} />); });
      await act(async () => tree?.root.findByProps({ "data-tab": "note" }).props["onClick"]());
      expect(acquire).not.toHaveBeenCalled();
      const buttons = tree?.root.findAllByType("button").filter(b => b.props["disabled"]);
      expect(buttons?.length).toBe(1);
    } finally { vi.unstubAllGlobals(); }
  });
});