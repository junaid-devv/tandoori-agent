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
    <header className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs sm:px-6 sm:py-4.5">
      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-bold tracking-tight text-slate-950 sm:text-2xl">
              {title}
            </h1>
            {meta}
          </div>
          {description ? (
            <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 sm:line-clamp-1 sm:text-sm">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-slate-100 pt-2.5 sm:border-0 sm:pt-0 sm:justify-end">
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}
