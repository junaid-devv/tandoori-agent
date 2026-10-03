"use client";

import { useCallback, useMemo, useState } from "react";
import { BarChart3, Loader2, RefreshCw, ShoppingBag, Users, Utensils } from "lucide-react";
import { clsx } from "clsx";
import { useDashboardContext } from "@/app/components/dashboard/DashboardProvider";
import { PageHeader } from "@/app/components/dashboard/PageHeader";
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
      // Bust cache so refresh button always fetches fresh
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
    <div className="space-y-4 pb-4 sm:space-y-6 sm:pb-10">
      <PageHeader
        title="Analytics"
        description={`Last ${data?.rangeDays ?? 30} days — orders, revenue & customer trends.`}
        actions={
          <button
            onClick={() => void loadAnalytics(true)}
            disabled={refreshing}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
            aria-label="Refresh analytics"
          >
            {refreshing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            <span className="hidden sm:inline">Refresh</span>
          </button>
        }
      />

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">{error}</div>
      ) : null}

      {loading && !data ? (
        <div className="flex h-[40vh] items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 shadow-sm">
          <Loader2 size={24} className="animate-spin" />
        </div>
      ) : null}

      {data ? (
        <>
          <section className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
            {[
              { label: "Orders", value: data.totals.orders, icon: ShoppingBag, surface: "bg-orange-50/55 border-orange-100", iconColor: "text-brand" },
              { label: "Revenue", value: money(data.totals.revenue), icon: BarChart3, surface: "bg-emerald-50/55 border-emerald-100", iconColor: "text-emerald-600" },
              { label: "Repeat Customers", value: data.totals.repeatCustomers, icon: Users, surface: "bg-indigo-50/55 border-indigo-100", iconColor: "text-indigo-600" },
              { label: "Active Orders", value: data.totals.activeOrders, icon: Utensils, surface: "bg-blue-50/55 border-blue-100", iconColor: "text-blue-600" },
            ].map((metric) => (
              <div key={metric.label} className={clsx("rounded-xl border p-3 shadow-sm sm:p-4", metric.surface)}>
                <div className="mb-2 flex items-center justify-between gap-2 sm:mb-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 sm:text-xs">{metric.label}</p>
                  <metric.icon size={16} className={metric.iconColor} />
                </div>
                <p className="break-words text-xl font-bold text-slate-900 sm:text-2xl">{metric.value}</p>
              </div>
            ))}
          </section>

          <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
              <h2 className="text-base font-bold text-slate-900">Hourly Demand</h2>
              <div className="mt-5 space-y-2">
                {data.hourlyDemand.length === 0 ? (
                  <p className="text-sm text-slate-500">No order activity in this range.</p>
                ) : (
                  data.hourlyDemand.map((item) => (
                    <div key={item.hour} className="grid grid-cols-[44px_1fr_32px] items-center gap-2 text-sm sm:grid-cols-[54px_1fr_36px] sm:gap-3">
                      <span className="text-xs font-semibold text-slate-500">{item.hour}</span>
                      <div className="h-2 rounded-full bg-slate-100">
                        <div
                          className="h-2 rounded-full bg-brand"
                          style={{ width: `${Math.max(6, (item.count / maxHourCount) * 100)}%` }}
                        />
                      </div>
                      <span className="text-right text-xs font-bold text-slate-700">{item.count}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
              <h2 className="text-base font-bold text-slate-900">Order Mix</h2>
              <div className="mt-5 space-y-3">
                {Object.entries(data.typeBreakdown).map(([type, count]) => (
                  <div key={type} className="flex items-center justify-between text-sm">
                    <span className="capitalize text-slate-600">{label(type)}</span>
                    <span className="font-bold text-slate-900">{count}</span>
                  </div>
                ))}
              </div>
              <div className="mt-6 border-t border-slate-100 pt-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Status</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {Object.entries(data.statusBreakdown).map(([status, count]) => (
                    <span key={status} className={clsx("rounded-lg px-2.5 py-1 text-xs font-semibold capitalize", status === "cancelled" ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-700")}>
                      {label(status)}: {count}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
            <h2 className="text-base font-bold text-slate-900">Top Items</h2>
            <div className="mt-5 space-y-3">
              {data.topItems.length === 0 ? (
                <p className="text-sm text-slate-500">No item sales in this range.</p>
              ) : (
                data.topItems.map((item) => (
                  <div key={item.name} className="grid gap-2 text-sm sm:grid-cols-[minmax(160px,240px)_1fr_96px] sm:items-center sm:gap-3">
                    <div className="flex items-center justify-between gap-3 sm:block">
                      <span className="min-w-0 truncate font-semibold text-slate-800">{item.name}</span>
                      <span className="shrink-0 text-xs font-semibold text-slate-500 sm:hidden">
                        {item.qty} sold
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100">
                      <div
                        className="h-2 rounded-full bg-slate-800"
                        style={{ width: `${Math.max(6, (item.qty / maxTopItemQty) * 100)}%` }}
                      />
                    </div>
                    <span className="hidden text-right text-xs font-semibold text-slate-500 sm:block">
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
