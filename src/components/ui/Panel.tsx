import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  testId,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section
      className={cn("flex min-w-0 flex-col rounded-lg border border-line bg-surface", className)}
      data-testid={testId}
    >
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-3">
        <div className="min-w-[12rem] flex-1">
          <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
          {description && <p className="text-[13px] text-fg-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
      </header>
      <div className="min-h-0 flex-1 p-4 pt-3">{children}</div>
    </section>
  );
}
