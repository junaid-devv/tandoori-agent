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
    <header className="relative overflow-hidden rounded-xl sm:rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm sm:px-5 sm:py-4">
      <div
        className="pointer-events-none absolute inset-y-0 right-0 hidden w-1/2 opacity-80 sm:block"
        style={{
          background:
            "linear-gradient(135deg, rgba(234,88,12,0.12), rgba(255,247,237,0.32) 42%, transparent 70%)",
          clipPath: "polygon(22% 0, 100% 0, 100% 100%, 0 100%)",
        }}
      />
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
