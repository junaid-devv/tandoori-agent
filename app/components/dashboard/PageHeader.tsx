import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  meta,
  actions,
}: {
  title: string;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h1 className="text-sm font-bold text-slate-900">{title}</h1>
        {meta}
        {description && (
          <p className="hidden text-xs text-slate-500 sm:block">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
