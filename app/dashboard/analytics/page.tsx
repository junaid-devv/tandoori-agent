"use client";

import { useCallback, useMemo, useState } from "react";
import { BarChart3, Loader2, RefreshCw, ShoppingBag, Users, Utensils } from "lucide-react";
import { clsx } from "clsx";
import { useDashboardContext } from "@/app/components/dashboard/DashboardProvider";
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
  const { selectedBranchId, selectedBranch } = useDashboardContext();
  const [refreshing, setRefreshing] = useState(false);

  const analyticsUrl = useMemo(() =>
    selectedBranchId === "all"
      ? "/api/dashboard/analytics"
      : `/api/dashboard/analytics?branch_id=${encodeURIComponent(selectedBranchId)}`,
    [selectedBranchId],
  );

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

  if (loading && !data) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-slate-400">
        <Loader2 size={28} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-4 sm:space-y-6 sm:pb-10">
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-3 md:flex-row md:items-end md:justify-between sm:pb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-3xl">Analytics</h1>
          <p className="mt-0.5 text-xs text-slate-500 sm:mt-1 sm:text-sm">
            Last {data?.rangeDays ?? 30} days{selectedBranch ? ` for ${selectedBranch.name}` : " across accessible branches"}.
          </p>
        </div>
        <button
          onClick={() => void loadAnalytics(true)}
          disabled={refreshing}
          className="inline-flex w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50 sm:w-auto"
        >
          {refreshing ? <Loader2 size={16} className="mr-2 animate-spin" /> : <RefreshCw size={16} className="mr-2" />}
          Refresh
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">{error}</div>
      ) : null}

      {data ? (
        <>
          <section className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
            {[
              { label: "Orders", value: data.totals.orders, icon: ShoppingBag },
              { label: "Revenue", value: money(data.totals.revenue), icon: BarChart3 },
              { label: "Repeat Customers", value: data.totals.repeatCustomers, icon: Users },
              { label: "Active Orders", value: data.totals.activeOrders, icon: Utensils },
            ].map((metric) => (
              <div key={metric.label} className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
                <div className="mb-2 flex items-center justify-between gap-2 sm:mb-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 sm:text-xs">{metric.label}</p>
                  <metric.icon size={16} className="text-brand" />
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
