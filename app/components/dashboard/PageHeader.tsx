import type { ReactNode } from "react";

export function PageHeader({ title, description, meta, actions, eyebrow }: { title: string; description?: ReactNode; meta?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return <div className="page-heading flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
    <div className="min-w-0">
      {eyebrow && <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-brand">{eyebrow}</p>}
      <div className="flex flex-wrap items-center gap-3"><h1 className="text-[26px] font-semibold leading-tight tracking-[-0.8px] text-slate-900 sm:text-[28px]">{title}</h1>{meta}</div>
      {description && <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-slate-500">{description}</p>}
    </div>
    {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
  </div>;
}
