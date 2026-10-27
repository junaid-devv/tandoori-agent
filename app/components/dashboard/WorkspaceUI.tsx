import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertCircle, ArrowRight, Inbox } from "lucide-react";
import { clsx } from "clsx";

export function MetricCard({ label, value, detail, icon: Icon, loading, accent = false, testId }: { label: string; value: ReactNode; detail?: ReactNode; icon: LucideIcon; loading?: boolean; accent?: boolean; testId?: string }) {
  return <div data-testid={testId} className={clsx("ui-card metric-card min-w-0 p-4 sm:p-5", accent && "metric-card-accent")}>
    <div className="mb-3 flex items-center justify-between gap-2"><p className="metric-label text-xs font-medium text-slate-500">{label}</p><span className="metric-icon rounded-lg bg-[#fff0e4] p-2 text-[#b43e00]"><Icon size={16} strokeWidth={1.7} /></span></div>
    {loading ? <div className="h-9 w-24 animate-pulse rounded bg-slate-100" /> : <p className="metric-value break-words text-[clamp(16px,4.5vw,24px)] sm:text-[28px] font-semibold leading-tight text-slate-900">{value}</p>}
    {detail && <p className="metric-detail mt-2 text-[11px] leading-relaxed text-slate-500">{detail}</p>}
  </div>;
}

export function EmptyState({ title, description, icon: Icon = Inbox, action }: { title: string; description: string; icon?: LucideIcon; action?: ReactNode }) {
  return <div className="flex flex-col items-center justify-center px-6 py-14 text-center"><span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-500"><Icon size={22} strokeWidth={1.5} /></span><p className="text-sm font-semibold text-slate-700">{title}</p><p className="mt-2 max-w-sm text-xs leading-relaxed text-slate-500">{description}</p>{action && <div className="mt-5">{action}</div>}</div>;
}

export function ErrorNotice({ message, retry }: { message: string; retry?: () => void }) {
  return <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700"><AlertCircle size={17} className="shrink-0" /><p className="min-w-0 flex-1">{message}</p>{retry && <button onClick={retry} className="flex items-center gap-1 font-semibold underline underline-offset-4">Try again<ArrowRight size={13} /></button>}</div>;
}

export function SectionNav<T extends string>({ items, value, onChange, label = "Page sections" }: { items: { key: T; label: string; icon?: ReactNode; description?: string; badge?: string }[]; value: T; onChange: (value: T) => void; label?: string }) {
  return <nav aria-label={label} className="section-nav no-scrollbar">{items.map(item => <button key={item.key} type="button" aria-current={value === item.key ? "page" : undefined} onClick={() => onChange(item.key)}>{item.icon}<span>{item.label}</span>{item.badge && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-500">{item.badge}</span>}</button>)}</nav>;
}

export function FormSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section className="ui-card overflow-hidden"><div className="border-b border-slate-100 px-6 py-5"><h2 className="ui-section-title">{title}</h2><p className="mt-1.5 text-xs leading-relaxed text-slate-500">{description}</p></div><div className="p-6">{children}</div></section>;
}
