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
      description="The exact object the display renders."
      testId="state-inspector"
      actions={
        <>
          <Button
            variant={frozen ? "active" : "default"}
            onClick={() => setFrozen(frozen ? null : JSON.stringify(state, null, 2))}
          >
            {frozen ? "Resume live" : "Hold"}
          </Button>
          <Button variant="ghost" onClick={() => void navigator.clipboard?.writeText(json)}>
            Copy
          </Button>
        </>
      }
    >
      <pre
        className="h-[400px] overflow-auto rounded-md bg-bench p-3 font-mono text-[11.5px] leading-5 text-fg-muted"
        data-testid="state-json"
      >
        {json}
      </pre>
    </Panel>
  );
}
