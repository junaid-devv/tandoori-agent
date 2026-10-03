"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageSquare, ShoppingBag, TrendingUp, Zap, Settings, Activity, ArrowUpRight, AlertTriangle, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { clsx } from "clsx";
import { useDashboardContext } from "@/app/components/dashboard/DashboardProvider";
import { PageHeader } from "@/app/components/dashboard/PageHeader";
import { useDataCache, invalidateCache } from "@/lib/useDataCache";
import UniversityAdmissionsDashboard from "@/app/admissions/page";

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  received: { label: "New", bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500" },
  preparing: { label: "Preparing", bg: "bg-orange-50", text: "text-orange-700", dot: "bg-orange-500" },
  out_for_delivery: { label: "On Way", bg: "bg-indigo-50", text: "text-indigo-700", dot: "bg-indigo-500" },
  delivered: { label: "Done", bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  cancelled: { label: "Dropped", bg: "bg-slate-50", text: "text-slate-600", dot: "bg-slate-400" },
};

type DashboardOrder = {
  id: string;
  order_number: number;
  status: string;
  type: "delivery" | "pickup" | "dine-in";
  subtotal: number;
  created_at: string;
  branches?: { name?: string | null } | null;
  conversations?: { name?: string | null } | null;
};

type DashboardSummaryResponse = {
  active: number;
  today: number;
  revenue: number;
  chats: number;
  breakdown: Record<string, number>;
  recentOrders: DashboardOrder[];
};

type StaffAlert = {
  id: string;
  conversation_id: string;
  branch_id: string;
  kind: "human_handoff" | "tool_validation" | "webhook_processing" | "delivery_notification" | "customer_cancellation" | string;
  severity: "low" | "medium" | "high" | string;
  status: "open" | "acknowledged" | "resolved" | string;
  message: string;
  created_at: string;
  conversations?: { phone?: string | null; name?: string | null } | null;
  branches?: { name?: string | null; slug?: string | null } | null;
};

const ALERT_KIND_LABELS: Record<string, string> = {
  human_handoff: "Human Handoff",
  tool_validation: "AI Review",
  webhook_processing: "Webhook Failure",
  delivery_notification: "Delivery Notice",
  customer_cancellation: "Cancellation",
};

export default function DashboardPage() {
  if (
    process.env.NEXT_PUBLIC_APP_MODE === "university" ||
    process.env.APP_MODE === "university" ||
    process.env.NEXT_PUBLIC_APP_NAME?.toLowerCase().includes("university")
  ) {
    return <UniversityAdmissionsDashboard />;
  }

  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [localAlerts, setLocalAlerts] = useState<StaffAlert[] | null>(null);

  // Single-branch: no branch_id filter — always scoped to the restaurant
  const summaryUrl = "/api/dashboard/summary";
  const alertsUrl = "/api/staff-alerts?status=open&limit=8";

  const {
    data: summary,
    isLoading: summaryLoading,
    revalidate: revalidateSummary,
  } = useDataCache<DashboardSummaryResponse>(summaryUrl);

  const {
    data: fetchedAlerts,
    isLoading: alertsLoading,
    revalidate: revalidateAlerts,
  } = useDataCache<StaffAlert[]>(alertsUrl);

  // Merge fetched alerts into local state (so optimistic resolve works)
  useEffect(() => {
    if (fetchedAlerts) {
      setLocalAlerts(fetchedAlerts);
      setLastUpdatedAt(new Date().toISOString());
    }
  }, [fetchedAlerts]);

  const loading = summaryLoading || alertsLoading;
  const stats = summary
    ? { active: summary.active, today: summary.today, revenue: summary.revenue, chats: summary.chats, breakdown: summary.breakdown }
    : { active: 0, today: 0, revenue: 0, chats: 0, breakdown: {} as Record<string, number> };
  const recentOrders = summary?.recentOrders ?? [];
  const alerts = localAlerts ?? fetchedAlerts ?? [];

  const revalidate = useCallback(() => {
    revalidateSummary();
    revalidateAlerts();
  }, [revalidateSummary, revalidateAlerts]);

  const resolveAlert = useCallback(async (alertId: string) => {
    // Optimistic remove
    setLocalAlerts((current) => (current ?? []).filter((a) => a.id !== alertId));

    try {
      const response = await fetch(`/api/staff-alerts/${alertId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "resolved" }),
      });
      if (!response.ok) throw new Error("Failed to resolve staff alert");
      // Bust the alerts cache so next load is fresh
      invalidateCache("/api/staff-alerts");
    } catch (error) {
      console.error("Alert resolve failed", error);
      // Roll back optimistic update
      revalidateAlerts();
    }
  }, [revalidateAlerts]);

  // Periodic auto-refresh (12 s) — silent, no skeleton
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      revalidate();
    }, 12000);
    return () => window.clearInterval(interval);
  }, [revalidate]);

  return (
    <div className="space-y-3 pb-10">
      {/* Compact header bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-bold text-slate-900">Dashboard Overview</h1>
          <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/settings"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
            aria-label="Open settings"
          >
            <Settings size={14} />
          </Link>
          <Link
            href="/dashboard/orders"
            className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-xs font-semibold text-white transition hover:bg-brand-hover shadow-sm"
          >
            <span>Orders Queue</span>
            <ArrowUpRight size={13} />
          </Link>
        </div>
      </div>

      {/* KPI Section */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "Active Orders", val: stats.active, icon: Activity, color: "text-blue-600", bg: "bg-blue-50" },
          { label: "Orders Today", val: stats.today, icon: ShoppingBag, color: "text-emerald-600", bg: "bg-emerald-50" },
          { label: "Gross Revenue", val: `Rs. ${stats.revenue.toLocaleString()}`, icon: TrendingUp, color: "text-indigo-600", bg: "bg-indigo-50" },
          { label: "AI Interactions", val: stats.chats, icon: MessageSquare, color: "text-brand", bg: "bg-orange-50" },
        ].map((item, i) => (
          <div
            key={i}
            data-testid={`kpi-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
            className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-slate-300"
          >
            <div className="flex items-center justify-between gap-1 mb-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{item.label}</span>
              <div className={clsx("rounded-md p-1", item.bg)}>
                <item.icon size={13} className={item.color} />
              </div>
            </div>
            <div className="text-xl font-bold tracking-tight text-slate-900">
              {loading ? (
                <div className="h-7 w-20 bg-slate-100 animate-pulse rounded-md" />
              ) : (
                item.val
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {/* Activity Feed */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col lg:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-100 px-3.5 py-2.5 bg-slate-50/50">
            <h3 className="text-xs font-bold text-slate-800">Recent Transactions</h3>
            <div className="flex items-center gap-1.5 text-[10px] font-medium text-slate-500">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
              </span>
              <span>Real-time</span>
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {loading ? (
              Array(4).fill(0).map((_, i) => (
                <div key={i} className="p-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-slate-100 rounded-full animate-pulse" />
                    <div className="space-y-1.5">
                      <div className="h-3 w-28 bg-slate-100 rounded animate-pulse" />
                      <div className="h-2.5 w-16 bg-slate-50 rounded animate-pulse" />
                    </div>
                  </div>
                </div>
              ))
            ) : (
              recentOrders.map((o) => {
                const s = STATUS_CONFIG[o.status] || STATUS_CONFIG.received;
                const customerName = o.conversations?.name || "Guest User";
                const initials = customerName.substring(0, 2).toUpperCase();

                return (
                  <div key={o.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between hover:bg-slate-50/60 transition">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-600 shrink-0">
                        {initials}
                      </div>

                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 truncate">
                          {customerName}
                        </p>
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                          <span>#{o.order_number}</span>
                          <span>•</span>
                          <span className="capitalize">{o.type}</span>
                          {o.branches?.name ? (
                            <>
                              <span>•</span>
                              <span className="truncate">{o.branches.name}</span>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 pl-10 sm:pl-0 sm:gap-4">
                      <div className="text-left sm:text-right">
                        <p className="text-xs font-bold text-slate-900">Rs. {Number(o.subtotal).toLocaleString()}</p>
                        <p className="text-[10px] text-slate-400">{formatDistanceToNow(new Date(o.created_at), { addSuffix: true })}</p>
                      </div>

                      <div className={clsx("flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold shrink-0", s.bg, s.text)}>
                        <div className={clsx("w-1.5 h-1.5 rounded-full", s.dot)} />
                        {s.label}
                      </div>
                    </div>
                  </div>
                );
              })
            )}

            {!loading && recentOrders.length === 0 && (
              <div className="p-8 text-center text-slate-400 text-xs">
                No recent orders found.
              </div>
            )}
          </div>
        </div>

        {/* Right Sidebar Area */}
        <div className="space-y-3">
          {/* Staff Alerts Card */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-3.5 py-2.5 bg-slate-50/50">
              <div className="flex items-center gap-1.5">
                <h3 className="text-xs font-bold text-slate-800">Staff Alerts</h3>
                <span className="rounded-full bg-slate-100 px-1.5 py-0.2 text-[10px] font-bold text-slate-600">
                  {alerts.length}
                </span>
              </div>
              <AlertTriangle size={14} className={alerts.length > 0 ? "text-amber-500" : "text-slate-300"} />
            </div>

            <div className="divide-y divide-slate-100">
              {loading ? (
                Array(2).fill(0).map((_, index) => (
                  <div key={index} className="space-y-1.5 p-3">
                    <div className="h-2.5 w-20 animate-pulse rounded bg-slate-100" />
                    <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
                  </div>
                ))
              ) : alerts.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  No open staff alerts.
                </div>
              ) : (
                alerts.map((alert) => {
                  const label = ALERT_KIND_LABELS[alert.kind] ?? alert.kind.replaceAll("_", " ");
                  const customer = alert.conversations?.name || alert.conversations?.phone || "Customer";

                  return (
                    <div key={alert.id} className="p-3">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className={clsx(
                          "rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase",
                          alert.severity === "high" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700",
                        )}>
                          {label}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })}
                        </span>
                      </div>
                      <p className="text-xs font-medium text-slate-800 leading-snug">{alert.message}</p>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <Link
                          href={`/dashboard/conversations?conversation_id=${encodeURIComponent(alert.conversation_id)}`}
                          className="truncate text-[11px] font-semibold text-brand hover:underline"
                        >
                          {customer}
                        </Link>
                        <button
                          onClick={() => void resolveAlert(alert.id)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 transition"
                        >
                          <CheckCircle2 size={11} />
                          Resolve
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Fulfillment Pipeline */}
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm space-y-3">
            <h3 className="text-xs font-bold text-slate-800">Fulfillment Pipeline</h3>
            <div className="space-y-2.5">
              {['received', 'preparing', 'out_for_delivery'].map((key) => {
                const s = STATUS_CONFIG[key];
                const count = stats.breakdown[key] || 0;
                const progress = stats.today > 0 ? (count / stats.today) * 100 : 0;

                return (
                  <div key={key} className="space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-600 font-medium">{s.label}</span>
                      <span className="text-slate-900 font-bold">{count}</span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={clsx("h-full rounded-full transition-all duration-700", s.dot)}
                        style={{ width: `${Math.max(progress, 2)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Realtime Status Widget */}
          <div className="rounded-xl border border-zinc-900 bg-zinc-950 p-3.5 text-white shadow-sm space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Zap size={12} className="text-brand fill-brand" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Live Agent Sync</span>
              </div>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            </div>
            <p className="text-xs text-zinc-300">
              <strong className="text-white font-bold">{stats.active} orders</strong> active in kitchen &amp; delivery queue.
            </p>
            <Link
              href="/dashboard/conversations"
              className="flex items-center justify-center gap-1.5 w-full py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs font-semibold text-zinc-200 transition"
            >
              Open Live Chats
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
