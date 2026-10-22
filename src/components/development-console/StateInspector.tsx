"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { usePrinter } from "@/hooks/usePrinter";

/** Live JSON view of the exact PrinterState object the virtual display renders. */
export function StateInspector() {
  const state = usePrinter((s) => s.state);
  const [frozen, setFrozen] = useState<string | null>(null);
  const json = frozen ?? JSON.stringify(state, null, 2);

  return (
    <Panel
      title="Printer state"
      testId="state-inspector"
      actions={
        <>
          <Button onClick={() => setFrozen(frozen ? null : JSON.stringify(state, null, 2))}>
            {frozen ? "Live" : "Hold"}
          </Button>
          <Button onClick={() => void navigator.clipboard?.writeText(json)}>Copy</Button>
        </>
      }
    >
      <pre
        className="h-[360px] overflow-auto rounded-md bg-ink-950 p-2 font-mono text-2xs leading-4 text-fg-muted"
        data-testid="state-json"
      >
        {json}
      </pre>
    </Panel>
  );
}
