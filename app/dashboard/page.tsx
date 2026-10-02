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
    <div className="animate-fade-in space-y-4 sm:space-y-6">
      <PageHeader
        title="Dashboard"
        description="Restaurant overview & live performance"
        actions={
          <>
          <Link href="/dashboard/settings" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900" aria-label="Open settings">
            <Settings size={18} />
          </Link>
          <Link href="/dashboard/orders" className="flex h-9 items-center justify-center gap-2 rounded-lg bg-brand px-3 text-sm font-semibold text-white shadow-sm shadow-orange-200 transition-all hover:bg-brand-hover">
            <span className="hidden sm:inline">Manage Orders</span>
            <ArrowUpRight size={16} />
          </Link>
          </>
        }
      />

      {/* KPI Section */}
      <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
        {[
          { label: "Active Orders", val: stats.active, icon: Activity, color: "text-blue-600", bg: "bg-blue-50", surface: "bg-blue-50/50 border-blue-100" },
          { label: "Orders Today", val: stats.today, icon: ShoppingBag, color: "text-emerald-600", bg: "bg-emerald-50", surface: "bg-emerald-50/50 border-emerald-100" },
          { label: "Gross Revenue", val: `Rs. ${stats.revenue.toLocaleString()}`, icon: TrendingUp, color: "text-indigo-600", bg: "bg-indigo-50", surface: "bg-indigo-50/50 border-indigo-100" },
          { label: "AI Interactions", val: stats.chats, icon: MessageSquare, color: "text-brand", bg: "bg-orange-50", surface: "bg-orange-50/55 border-orange-100" },
        ].map((item, i) => (
          <div key={i} data-testid={`kpi-${item.label.toLowerCase().replace(/\s+/g, "-")}`} className={clsx("flex min-h-[88px] flex-col justify-between rounded-xl border p-3 shadow-sm sm:min-h-[124px] sm:p-5", item.surface)}>
            <div className="mb-3 flex items-start justify-between gap-2 sm:mb-4">
              <span className="text-xs font-semibold leading-tight text-slate-500 sm:text-sm">{item.label}</span>
              <div className={clsx("rounded-lg p-1.5 sm:p-2", item.bg)}>
                <item.icon size={16} className={item.color} />
              </div>
            </div>
            <div className="break-words text-xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              {loading ? (
                <div className="h-9 w-24 bg-slate-100 animate-pulse rounded-md mt-1" />
              ) : (
                item.val
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3 lg:gap-8">
        {/* Activity Feed */}
        <div className="ui-card flex flex-col overflow-hidden lg:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-100 bg-white/50 px-4 py-3 sm:px-6 sm:py-5">
            <h3 className="font-semibold text-slate-900">Recent Transactions</h3>
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Live</span>
            </div>
          </div>

          <div className="divide-y divide-slate-50">
            {loading ? (
              Array(4).fill(0).map((_, i) => (
                <div key={i} className="p-6 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-slate-100 rounded-full animate-pulse" />
                    <div className="space-y-2">
                      <div className="h-4 w-32 bg-slate-100 rounded animate-pulse" />
                      <div className="h-3 w-20 bg-slate-50 rounded animate-pulse" />
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
                  <div key={o.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4">
                    <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                      <div className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-xs font-bold text-slate-500">
                        {initials}
                      </div>

                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900">
                          {customerName}
                        </p>
                        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-2">
                          <span className="text-xs text-slate-500">Order #{o.order_number}</span>
                          <span className="w-1 h-1 rounded-full bg-slate-300" />
                          <span className="text-xs text-slate-500 capitalize">{o.type}</span>
                          {o.branches?.name ? (
                            <>
                              <span className="w-1 h-1 rounded-full bg-slate-300" />
                              <span className="truncate text-xs text-slate-500">{o.branches.name}</span>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 pl-12 sm:gap-6 sm:pl-0">
                      <div className="text-left sm:text-right">
                        <p className="text-sm font-medium text-slate-900">Rs. {Number(o.subtotal).toLocaleString()}</p>
                        <p className="mt-0.5 text-xs text-slate-400">{formatDistanceToNow(new Date(o.created_at), { addSuffix: true })}</p>
                      </div>

                      <div className={clsx("flex w-28 items-center gap-2 rounded-full px-2.5 py-1.5 text-xs font-medium", s.bg, s.text)}>
                        <div className={clsx("w-1.5 h-1.5 rounded-full", s.dot)} />
                        {s.label}
                      </div>
                    </div>
                  </div>
                );
              })
            )}

            {!loading && recentOrders.length === 0 && (
              <div className="p-8 text-center text-slate-500 text-sm">
                No recent orders found.
              </div>
            )}
          </div>
        </div>

        {/* Right Sidebar Area */}
        <div className="space-y-6">
          <div className="ui-card overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 sm:px-6 sm:py-5">
              <div>
                <h3 className="font-semibold text-slate-900">Staff Alerts</h3>
                <p className="mt-0.5 text-xs text-slate-500">{alerts.length} open item{alerts.length === 1 ? "" : "s"}</p>
              </div>
              <AlertTriangle size={18} className={alerts.length > 0 ? "text-amber-500" : "text-slate-300"} />
            </div>

            <div className="divide-y divide-slate-100">
              {loading ? (
                Array(3).fill(0).map((_, index) => (
                  <div key={index} className="space-y-2 px-6 py-4">
                    <div className="h-3 w-24 animate-pulse rounded bg-slate-100" />
                    <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
                  </div>
                ))
              ) : alerts.length === 0 ? (
                <div className="px-6 py-8 text-center text-sm text-slate-500">
                  No open staff alerts.
                </div>
              ) : (
                alerts.map((alert) => {
                  const label = ALERT_KIND_LABELS[alert.kind] ?? alert.kind.replaceAll("_", " ");
                  const customer = alert.conversations?.name || alert.conversations?.phone || "Customer";

                  return (
                    <div key={alert.id} className="px-4 py-3 sm:px-6 sm:py-4">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <span className={clsx(
                          "rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider",
                          alert.severity === "high" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700",
                        )}>
                          {label}
                        </span>
                        <span className="text-[11px] text-slate-400">
                          {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })}
                        </span>
                      </div>
                      <p className="text-sm font-medium leading-snug text-slate-900">{alert.message}</p>
                      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <Link
                          href={`/dashboard/conversations?conversation_id=${encodeURIComponent(alert.conversation_id)}`}
                          className="truncate text-xs font-semibold text-brand hover:text-orange-600"
                        >
                          Open chat: {customer}
                        </Link>
                        <button
                          onClick={() => void resolveAlert(alert.id)}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                        >
                          <CheckCircle2 size={12} />
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
          <div className="ui-card p-4 sm:p-6">
            <h3 className="mb-4 font-semibold text-slate-900 sm:mb-6">Fulfillment Pipeline</h3>
            <div className="space-y-4 sm:space-y-5">
              {['received', 'preparing', 'out_for_delivery'].map((key) => {
                const s = STATUS_CONFIG[key];
                const count = stats.breakdown[key] || 0;
                const progress = stats.today > 0 ? (count / stats.today) * 100 : 0;

                return (
                  <div key={key} className="space-y-2">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-slate-600 font-medium">{s.label}</span>
                      <span className="text-slate-900 font-semibold">{count}</span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={clsx("h-full rounded-full transition-all duration-1000", s.dot)}
                        style={{ width: `${Math.max(progress, 2)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* AI Status Card matched to Sidebar theme */}
          <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 p-4 text-white shadow-xl sm:p-6">
            <div
              className="absolute inset-0 opacity-[0.04]"
              style={{ backgroundImage: "linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px)", backgroundSize: "28px 28px" }}
            />

            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-4">
                <div className="p-1.5 bg-orange-500/20 rounded-md">
                  <Zap size={14} className="text-brand fill-orange-500/20" />
                </div>
                <p className="text-xs font-medium text-zinc-400 uppercase tracking-widest">Realtime Status</p>
              </div>

              <h4 className="text-xl font-semibold mb-2 text-white">Live Updates Active</h4>
              <p className="text-sm text-zinc-400 leading-relaxed mb-6">
                The dashboard is subscribed to live order and message updates. It currently shows <strong className="text-white font-medium">{stats.active} active orders</strong>{lastUpdatedAt ? ` and was refreshed ${formatDistanceToNow(new Date(lastUpdatedAt), { addSuffix: true })}.` : "."}
              </p>

              <Link href="/dashboard/conversations" className="flex items-center justify-center gap-2 w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-xl text-sm font-medium text-zinc-200 transition-colors">
                View Live Interactions
              </Link>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
