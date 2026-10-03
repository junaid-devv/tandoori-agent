"use client";

import { useCallback, useMemo, useState } from "react";
import { BarChart3, Loader2, RefreshCw, ShoppingBag, Users, Utensils } from "lucide-react";
import { clsx } from "clsx";
import { useDataCache, invalidateCache } from "@/lib/useDataCache";

type AnalyticsPayload = {
  generatedAt: string;
  rangeDays: number;
  totals: {
    orders: number;
    activeOrders: number;
    deliveredOrders: number;
    cancelledOrders: number;
    revenue: number;
    conversations: number;
    unreadConversations: number;
    humanConversations: number;
    repeatCustomers: number;
  };
  typeBreakdown: Record<string, number>;
  statusBreakdown: Record<string, number>;
  hourlyDemand: Array<{ hour: string; count: number }>;
  topItems: Array<{ name: string; qty: number; revenue: number }>;
};

function money(value: number) {
  return `Rs. ${Math.round(value).toLocaleString()}`;
}

function label(value: string) {
  return value.replaceAll("_", " ").replaceAll("-", " ");
}

export default function AnalyticsPage() {
  const [refreshing, setRefreshing] = useState(false);

  // Single-branch: always load analytics for this restaurant
  const analyticsUrl = "/api/dashboard/analytics";

  const {
    data,
    isLoading: loading,
    error: fetchError,
    revalidate,
  } = useDataCache<AnalyticsPayload>(analyticsUrl);

  const error = fetchError?.message ?? null;

  const loadAnalytics = useCallback((showRefreshing = false) => {
    if (showRefreshing) {
      setRefreshing(true);
      invalidateCache("/api/dashboard/analytics");
      setTimeout(() => setRefreshing(false), 600);
    }
    revalidate();
  }, [revalidate]);

  const maxHourCount = useMemo(
    () => Math.max(1, ...(data?.hourlyDemand.map((item) => item.count) ?? [1])),
    [data],
  );
  const maxTopItemQty = useMemo(
    () => Math.max(1, ...(data?.topItems.map((item) => item.qty) ?? [1])),
    [data],
  );

  return (
    <div className="space-y-3 pb-10">
      {/* Compact Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-bold text-slate-900">Analytics</h1>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
            Last {data?.rangeDays ?? 30} days
          </span>
        </div>
        <button
          onClick={() => void loadAnalytics(true)}
          disabled={refreshing}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          aria-label="Refresh analytics"
        >
          {refreshing ? <Loader2 size={13} className="animate-spin text-brand" /> : <RefreshCw size={13} />}
          <span>Refresh</span>
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700">{error}</div>
      ) : null}

      {loading && !data ? (
        <div className="flex h-48 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 shadow-sm">
          <Loader2 size={20} className="animate-spin text-brand" />
        </div>
      ) : null}

      {data ? (
        <>
          <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Orders", value: data.totals.orders, icon: ShoppingBag, color: "text-brand", bg: "bg-orange-50" },
              { label: "Revenue", value: money(data.totals.revenue), icon: BarChart3, color: "text-emerald-600", bg: "bg-emerald-50" },
              { label: "Repeat Customers", value: data.totals.repeatCustomers, icon: Users, color: "text-indigo-600", bg: "bg-indigo-50" },
              { label: "Active Queue", value: data.totals.activeOrders, icon: Utensils, color: "text-blue-600", bg: "bg-blue-50" },
            ].map((metric) => (
              <div key={metric.label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-slate-300">
                <div className="mb-1.5 flex items-center justify-between gap-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{metric.label}</p>
                  <div className={clsx("rounded-md p-1", metric.bg)}>
                    <metric.icon size={13} className={metric.color} />
                  </div>
                </div>
                <p className="break-words text-xl font-bold tracking-tight text-slate-900">{metric.value}</p>
              </div>
            ))}
          </section>

          <section className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-xs font-bold text-slate-800">Hourly Demand</h2>
              <div className="mt-3 space-y-2">
                {data.hourlyDemand.length === 0 ? (
                  <p className="text-xs text-slate-400">No order activity in this range.</p>
                ) : (
                  data.hourlyDemand.map((item) => (
                    <div key={item.hour} className="grid grid-cols-[40px_1fr_28px] items-center gap-2 text-xs">
                      <span className="text-[11px] font-semibold text-slate-500">{item.hour}</span>
                      <div className="h-2 rounded-full bg-slate-100">
                        <div
                          className="h-2 rounded-full bg-brand"
                          style={{ width: `${Math.max(6, (item.count / maxHourCount) * 100)}%` }}
                        />
                      </div>
                      <span className="text-right text-[11px] font-bold text-slate-700">{item.count}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-xs font-bold text-slate-800">Order Mix</h2>
              <div className="mt-3 space-y-2">
                {Object.entries(data.typeBreakdown).map(([type, count]) => (
                  <div key={type} className="flex items-center justify-between text-xs">
                    <span className="capitalize text-slate-600">{label(type)}</span>
                    <span className="font-bold text-slate-900">{count}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 border-t border-slate-100 pt-3">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Status Breakdown</h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Object.entries(data.statusBreakdown).map(([status, count]) => (
                    <span key={status} className={clsx("rounded-md px-2 py-0.5 text-[11px] font-semibold capitalize", status === "cancelled" ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-700")}>
                      {label(status)}: {count}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-xs font-bold text-slate-800">Top Selling Items</h2>
            <div className="mt-3 space-y-2.5">
              {data.topItems.length === 0 ? (
                <p className="text-xs text-slate-400">No item sales in this range.</p>
              ) : (
                data.topItems.map((item) => (
                  <div key={item.name} className="grid gap-2 text-xs sm:grid-cols-[minmax(140px,200px)_1fr_80px] sm:items-center sm:gap-3">
                    <span className="min-w-0 truncate font-semibold text-slate-800">{item.name}</span>
                    <div className="h-2 rounded-full bg-slate-100">
                      <div
                        className="h-2 rounded-full bg-slate-800"
                        style={{ width: `${Math.max(6, (item.qty / maxTopItemQty) * 100)}%` }}
                      />
                    </div>
                    <span className="text-right text-[11px] font-semibold text-slate-500">
                      {item.qty} sold
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
