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
    <header className="relative overflow-hidden rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm sm:px-5 sm:py-4">
      <div
        className="pointer-events-none absolute inset-y-0 right-0 hidden w-1/2 opacity-80 sm:block"
        style={{
          background:
            "linear-gradient(135deg, rgba(234,88,12,0.12), rgba(255,247,237,0.32) 42%, transparent 70%)",
          clipPath: "polygon(22% 0, 100% 0, 100% 100%, 0 100%)",
        }}
      />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">
              {title}
            </h1>
            {meta}
          </div>
          {description ? (
            <p className="mt-0.5 line-clamp-1 text-xs text-slate-500 sm:text-sm">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="no-scrollbar flex max-w-[46%] shrink-0 items-center justify-end gap-2 overflow-x-auto sm:max-w-none">
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}
