import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Panel({
  title,
  actions,
  children,
  className,
  testId,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section
      className={cn("flex min-w-0 flex-col rounded-lg border border-ink-700 bg-ink-900", className)}
      data-testid={testId}
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-ink-700 px-3">
        <h2 className="flex-1 text-xs font-semibold tracking-wide text-fg-muted uppercase">
          {title}
        </h2>
        {actions}
      </header>
      <div className="min-h-0 flex-1 p-3">{children}</div>
    </section>
  );
}
