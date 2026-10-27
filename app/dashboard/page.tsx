"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Activity, ArrowRight, ArrowUpRight, Check, CheckCircle2, MessageSquare, RefreshCw, ShoppingBag, TrendingUp, UtensilsCrossed } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { clsx } from "clsx";
import { toast } from "sonner";
import { useDashboardContext } from "@/app/components/dashboard/DashboardProvider";
import { PageHeader } from "@/app/components/dashboard/PageHeader";
import { EmptyState, ErrorNotice, MetricCard } from "@/app/components/dashboard/WorkspaceUI";
import { useDataCache, invalidateCache } from "@/lib/useDataCache";
import UniversityAdmissionsDashboard from "@/app/admissions/page";

type DashboardOrder = { id: string; order_number: number; status: string; type: string; subtotal: number; created_at: string; branches?: { name?: string | null } | null; conversations?: { name?: string | null } | null };
type Summary = { active: number; today: number; revenue: number; chats: number; breakdown: Record<string, number>; recentOrders: DashboardOrder[] };
type StaffAlert = { id: string; conversation_id: string; kind: string; severity: string; message: string; created_at: string; conversations?: { phone?: string | null; name?: string | null } | null };
const statuses: Record<string, { label: string; style: string; color: string }> = {
  received: { label: "New", style: "bg-blue-50 text-blue-700", color: "bg-blue-500" },
  preparing: { label: "Preparing", style: "bg-orange-50 text-orange-700", color: "bg-orange-500" },
  out_for_delivery: { label: "Out for delivery", style: "bg-violet-50 text-violet-700", color: "bg-violet-500" },
  delivered: { label: "Delivered", style: "bg-emerald-50 text-emerald-700", color: "bg-emerald-500" },
  cancelled: { label: "Cancelled", style: "bg-slate-100 text-slate-500", color: "bg-slate-400" },
};

export default function DashboardPage() {
  if (process.env.NEXT_PUBLIC_APP_MODE === "university" || process.env.APP_MODE === "university" || process.env.NEXT_PUBLIC_APP_NAME?.toLowerCase().includes("university")) return <UniversityAdmissionsDashboard />;
  return <RestaurantOverview />;
}

function RestaurantOverview() {
  const { profile } = useDashboardContext();
  const summary = useDataCache<Summary>("/api/dashboard/summary");
  const alertsQuery = useDataCache<StaffAlert[]>("/api/staff-alerts?status=open&limit=8");
  const [resolving, setResolving] = useState<string | null>(null);
  const refreshSummary = summary.revalidate;
  const refreshAlerts = alertsQuery.revalidate;
  const refresh = useCallback(() => { refreshSummary(); refreshAlerts(); }, [refreshSummary, refreshAlerts]);
  useEffect(() => { const timer = window.setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 12000); return () => clearInterval(timer); }, [refresh]);
  const data = summary.data;
  const alerts = alertsQuery.data || [];
  const orders = data?.recentOrders || [];
  const visibleOrders = orders.slice(0, 5);
  async function resolveAlert(id: string) {
    setResolving(id);
    try {
      const response = await fetch(`/api/staff-alerts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "resolved" }) });
      if (!response.ok) throw new Error("Could not resolve this alert. Please try again.");
      invalidateCache("/api/staff-alerts"); alertsQuery.revalidate(); toast.success("Alert resolved");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not resolve alert."); } finally { setResolving(null); }
  }
  return <div className="overview-page space-y-5">
    <PageHeader title="Overview" description={`${profile.app_name} · Your operations at a glance.`} meta={<span className="status-pill bg-[#fff0e4] text-[#9a3412]"><span className="h-1.5 w-1.5 rounded-full bg-[#f97316]" />Auto-refresh</span>} actions={<><button className="ui-button" onClick={refresh} disabled={summary.isRevalidating} aria-label="Refresh overview"><RefreshCw size={14} className={clsx(summary.isRevalidating && "animate-spin")} /><span className="hidden sm:inline">Refresh</span></button><Link href="/dashboard/orders" className="ui-button ui-button-primary">View orders<ArrowUpRight size={15} /></Link></>} />
    {summary.error && <ErrorNotice message="We couldn’t load your overview. Please try again." retry={refresh} />}
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <MetricCard label="Orders today" value={data?.today ?? "—"} detail="Orders placed today" icon={ShoppingBag} loading={summary.isLoading} testId="kpi-orders-today" />
      <MetricCard label="Revenue · 30 days" value={data ? `Rs. ${data.revenue.toLocaleString()}` : "—"} detail="Delivered orders · latest 500" icon={TrendingUp} loading={summary.isLoading} accent testId="kpi-gross-revenue" />
      <MetricCard label="Active orders" value={data?.active ?? "—"} detail="In the kitchen or on the way" icon={Activity} loading={summary.isLoading} testId="kpi-active-orders" />
      <MetricCard label="Conversations" value={data?.chats ?? "—"} detail="Across this workspace" icon={MessageSquare} loading={summary.isLoading} testId="kpi-ai-interactions" />
    </div>
    <div className="overview-grid">
      <section className="ui-card overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"><div><h2 className="ui-section-title">Recent orders</h2><p className="mt-1 text-xs text-slate-500">Your latest customer activity</p></div><Link href="/dashboard/orders" className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-brand">View all<ArrowRight size={14} /></Link></div>
        {summary.isLoading ? <div className="space-y-4 p-6">{[0,1,2,3].map(item => <div key={item} className="h-14 animate-pulse rounded-lg bg-slate-50" />)}</div> : orders.length ? <><div className="divide-y divide-slate-100 sm:hidden">{visibleOrders.map(order => { const status = statuses[order.status] || statuses.received; return <Link key={order.id} href="/dashboard/orders" className="flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-slate-50"><div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-800">#{order.order_number}<span className="ml-2 font-normal">{order.conversations?.name || "Walk-in customer"}</span></p><p className="mt-1 text-[11px] capitalize text-slate-500">{order.type} · {formatDistanceToNow(new Date(order.created_at), { addSuffix: true })}</p></div><div className="shrink-0 text-right"><p className="text-xs font-semibold text-slate-700">Rs. {Number(order.subtotal).toLocaleString()}</p><span className={clsx("status-pill mt-1", status.style)}>{status.label}</span></div></Link>; })}</div><div className="hidden overflow-x-auto sm:block"><table className="overview-table w-full min-w-[540px] text-left text-xs"><thead className="border-b border-slate-100 bg-slate-50/50 text-[10px] font-medium uppercase tracking-wider text-slate-500"><tr><th className="px-6 py-3 font-medium">Order / Customer</th><th className="px-3 py-3 font-medium">Status</th><th className="px-3 py-3 font-medium">Amount</th><th className="px-6 py-3 text-right font-medium">Received</th></tr></thead><tbody className="divide-y divide-slate-100">{visibleOrders.map(order => { const status = statuses[order.status] || statuses.received; return <tr key={order.id} className="hover:bg-slate-50/60"><td className="px-6 py-4"><Link href="/dashboard/orders" className="font-semibold text-slate-800 hover:text-brand">#{order.order_number}<span className="ml-2 font-normal text-slate-500">{order.conversations?.name || "Walk-in customer"}</span></Link><p className="mt-1 capitalize text-[11px] text-slate-500">{order.type}{order.branches?.name && ` · ${order.branches.name}`}</p></td><td className="px-3 py-4"><span className={clsx("status-pill", status.style)}><span className={clsx("h-1 w-1 rounded-full", status.color)} />{status.label}</span></td><td className="whitespace-nowrap px-3 py-4 font-medium text-slate-700">Rs. {Number(order.subtotal).toLocaleString()}</td><td className="whitespace-nowrap px-6 py-4 text-right text-[11px] text-slate-500">{formatDistanceToNow(new Date(order.created_at), { addSuffix: true })}</td></tr>; })}</tbody></table></div></> : <EmptyState title="Ready for your next order" description="Orders will appear here as customers place them through WhatsApp." icon={ShoppingBag} action={<Link className="ui-button" href="/dashboard/whatsapp">Manage WhatsApp<ArrowRight size={14} /></Link>} />}
        <div className="flex items-center justify-between border-t border-slate-100 px-6 py-3 text-[11px] text-slate-500"><span>Latest {visibleOrders.length} orders</span><span>Restaurant activity</span></div>
      </section>
      <div className="overview-side">
        <section className="ui-card p-5"><div className="mb-4 flex items-center justify-between"><h2 className="ui-section-title">Order pipeline</h2><UtensilsCrossed size={16} className="text-slate-500" /></div><div className="space-y-3">{["received", "preparing", "out_for_delivery"].map(key => { const status = statuses[key]; const count = data?.breakdown[key] || 0; return <div key={key}><div className="mb-2 flex justify-between text-xs"><span className="text-slate-500">{status.label}</span><span className="font-semibold text-slate-800">{data ? count : "—"}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={clsx("h-full rounded-full transition-[width]", status.color)} style={{ width: `${data?.today ? Math.min(100, count / data.today * 100) : 0}%` }} /></div></div>; })}</div><Link href="/dashboard/orders" className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4 text-xs font-medium text-slate-500 hover:text-brand">Open order queue<ArrowRight size={14} /></Link></section>
        <section className="ui-card overflow-hidden"><div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><h2 className="ui-section-title">Needs attention</h2><span className="status-pill bg-slate-100 text-slate-500">{alerts.length}</span></div>{alertsQuery.error ? <div className="p-4"><ErrorNotice message="Couldn’t load staff alerts." retry={alertsQuery.revalidate} /></div> : alertsQuery.isLoading ? <div className="m-5 h-20 animate-pulse rounded bg-slate-50" /> : alerts.length ? <div className="overview-alerts divide-y divide-slate-100">{alerts.map(alert => <div key={alert.id} className="p-5"><span className={clsx("status-pill mb-2", alert.severity === "high" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700")}>{alert.kind.replaceAll("_", " ")}</span><p className="text-xs leading-relaxed text-slate-600">{alert.message}</p><div className="mt-3 flex items-center justify-between gap-2"><Link href={`/dashboard/conversations?conversation_id=${encodeURIComponent(alert.conversation_id)}`} className="truncate text-xs font-medium text-brand">{alert.conversations?.name || "Open conversation"}</Link><button disabled={resolving === alert.id} onClick={() => void resolveAlert(alert.id)} className="flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-900 disabled:opacity-50"><Check size={13} />Resolve</button></div></div>)}</div> : <div className="flex items-start gap-3 p-5"><CheckCircle2 size={19} className="mt-0.5 shrink-0 text-emerald-500" /><div><p className="text-xs font-medium text-slate-700">You’re all caught up</p><p className="mt-1 text-[11px] leading-relaxed text-slate-500">Customer requests that need your team will appear here.</p></div></div>}</section>
      </div>
    </div>
  </div>;
}
