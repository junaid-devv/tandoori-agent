"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertOctagon,
  AlertTriangle,
  Ban,
  Check,
  CheckCircle2,
  ChefHat,
  ChevronDown,
  Clock,
  Kanban,
  LayoutGrid,
  MapPin,
  MessageCircle,
  MessageSquareText,
  Package,
  Phone,
  RefreshCw,
  Search,
  ShoppingBag,
  Truck,
  UtensilsCrossed,
  X,
  Printer,
} from "lucide-react";
import { clsx } from "clsx";
import { format, formatDistanceToNow } from "date-fns";
import { useDashboardContext } from "@/app/components/dashboard/DashboardProvider";
import { ErrorNotice } from "@/app/components/dashboard/WorkspaceUI";
import { PageHeader } from "@/app/components/dashboard/PageHeader";
import { toast } from "sonner";
import { printOrderReceipt } from "@/lib/thermal-printer";
import { useDataCache, invalidateCache } from "@/lib/useDataCache";

type OrderStatus = "received" | "preparing" | "out_for_delivery" | "delivered" | "cancelled";
type FilterTab = "all" | "active" | "received" | "preparing" | "out_for_delivery" | "delivered" | "cancelled";
type ViewMode = "cards" | "kds";

interface OrderItem {
  id: string;
  name: string;
  qty: number;
  price: number;
  size: string | null;
  addons: unknown;
  item_instructions: string | null;
}

interface Order {
  id: string;
  branch_id: string;
  order_number: number;
  type: "delivery" | "pickup" | "dine-in";
  status: OrderStatus;
  subtotal: number;
  delivery_fee: number;
  customer_instructions: string | null;
  cancellation_requested_at: string | null;
  cancelled_at: string | null;
  address: string | null;
  guests: number | null;
  reservation_time: string | null;
  pickup_time: string | null;
  assigned_to: string | null;
  status_notified_at: string | null;
  status_notification_status: "sent" | "failed" | "skipped" | null;
  status_notification_error: string | null;
  created_at: string;
  order_items: OrderItem[];
  branches: { name: string; slug: string } | null;
  conversations: { phone: string; name: string | null } | null;
}

const ACTIVE_STATUSES: OrderStatus[] = ["received", "preparing", "out_for_delivery"];
const STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  received: ["preparing", "cancelled"],
  preparing: ["out_for_delivery", "delivered", "cancelled"],
  out_for_delivery: ["delivered", "cancelled"],
  delivered: [],
  cancelled: ["received"],
};

const STATUS_CONFIG: Record<
  OrderStatus,
  {
    label: string;
    badge: string;
    dot: string;
    icon: typeof Clock;
  }
> = {
  received: {
    label: "New Order",
    badge: "bg-sky-50 text-sky-700 border-sky-200/70",
    dot: "bg-sky-500",
    icon: Clock,
  },
  preparing: {
    label: "In Kitchen",
    badge: "bg-amber-50 text-amber-700 border-amber-200/70",
    dot: "bg-amber-500",
    icon: ChefHat,
  },
  out_for_delivery: {
    label: "On Delivery",
    badge: "bg-indigo-50 text-indigo-700 border-indigo-200/70",
    dot: "bg-indigo-500",
    icon: Truck,
  },
  delivered: {
    label: "Delivered",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200/70",
    dot: "bg-emerald-500",
    icon: CheckCircle2,
  },
  cancelled: {
    label: "Cancelled",
    badge: "bg-rose-50 text-rose-700 border-rose-200/70",
    dot: "bg-rose-500",
    icon: Ban,
  },
};

function getStatusOptions(current: OrderStatus) {
  return [current, ...STATUS_TRANSITIONS[current]];
}

function getAddonList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function formatOrderItemLabel(item: OrderItem) {
  const details: string[] = [];
  if (item.size) details.push(item.size);
  const addons = getAddonList(item.addons);
  if (addons.length > 0) details.push(`Add-ons: ${addons.join(", ")}`);
  if (item.item_instructions) details.push(item.item_instructions);
  if (details.length === 0) return item.name;
  return `${item.name} (${details.join(" | ")})`;
}

function formatElapsedTime(createdAt: string) {
  const date = new Date(createdAt);
  const elapsedMs = Date.now() - date.getTime();
  const mins = Math.max(0, Math.floor(elapsedMs / 60000));

  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) {
    const hours = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem > 0 ? `${hours}h ${rem}m ago` : `${hours}h ago`;
  }
  return format(date, "d MMM, h:mm a");
}

export default function OrdersPage() {
  const {
    profile,
    receiptPaperWidth,
  } = useDashboardContext();
  const [activeTab, setActiveTab] = useState<FilterTab>("active");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [assignees, setAssignees] = useState<Record<string, string>>({});

  const handlePrintOrder = async (order: Order, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await printOrderReceipt(order as any, {
        paperWidth: receiptPaperWidth,
        restaurantName: profile.app_name,
        branchName: order.branches?.name,
      });
      toast.success(`🖨️ Printing receipt for Order #${order.order_number}`);
    } catch (err) {
      console.error("Failed to print receipt:", err);
      toast.error("Failed to trigger print job");
    }
  };

  // Single-branch: always load all orders for this restaurant
  const ordersUrl = "/api/orders?limit=100";

  const {
    data: orders,
    isLoading: loading,
    error: ordersError,
    revalidate,
  } = useDataCache<Order[]>(ordersUrl);

  // Sync assignees state from fetched orders
  useEffect(() => {
    if (orders) {
      setAssignees(Object.fromEntries(orders.map((order) => [order.id, order.assigned_to ?? ""])));
    }
  }, [orders]);

  // Periodic auto-refresh — silent, no skeleton flicker
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      revalidate();
    }, 12000);
    return () => window.clearInterval(interval);
  }, [revalidate]);

  const updateOrder = async (orderId: string, payload: { status?: OrderStatus; assigned_to?: string | null }) => {
    setSavingId(orderId);
    try {
      const response = await fetch(`/api/orders/${orderId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Order update failed");
      toast.success("Order updated successfully.");
      // Invalidate cache so fresh data is loaded
      invalidateCache("/api/orders");
      revalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Order update failed.");
    } finally {
      setSavingId(null);
    }
  };

  const handleStatusChange = async (order: Order, nextStatus: OrderStatus) => {
    if (nextStatus === order.status) return;
    if (!STATUS_TRANSITIONS[order.status].includes(nextStatus)) {
      toast.error(`Cannot move ${order.status.replaceAll("_", " ")} to ${nextStatus.replaceAll("_", " ")}.`);
      return;
    }

    if (
      (nextStatus === "cancelled" || nextStatus === "delivered") &&
      !window.confirm(`Confirm marking order #${order.order_number} as ${nextStatus.replaceAll("_", " ")}?`)
    ) {
      return;
    }

    await updateOrder(order.id, { status: nextStatus });
  };

  const handleAssign = async (order: Order) => {
    await updateOrder(order.id, { assigned_to: assignees[order.id]?.trim() || null });
  };

  const counts = useMemo(() => {
    const list = orders ?? [];
    return {
      all: list.length,
      active: list.filter((o) => ACTIVE_STATUSES.includes(o.status)).length,
      received: list.filter((o) => o.status === "received").length,
      preparing: list.filter((o) => o.status === "preparing").length,
      out_for_delivery: list.filter((o) => o.status === "out_for_delivery").length,
      delivered: list.filter((o) => o.status === "delivered").length,
      cancelled: list.filter((o) => o.status === "cancelled").length,
      cancellationRequests: list.filter((o) => Boolean(o.cancellation_requested_at && o.status !== "cancelled")).length,
    };
  }, [orders]);

  const filteredOrders = useMemo(() => {
    return (orders ?? []).filter((order) => {
      const matchesTab =
        activeTab === "all" ||
        (activeTab === "active" && ACTIVE_STATUSES.includes(order.status)) ||
        (activeTab === "received" && order.status === "received") ||
        (activeTab === "preparing" && order.status === "preparing") ||
        (activeTab === "out_for_delivery" && order.status === "out_for_delivery") ||
        (activeTab === "delivered" && order.status === "delivered") ||
        (activeTab === "cancelled" && order.status === "cancelled");

      const query = searchTerm.toLowerCase().trim();
      const matchesSearch =
        !query ||
        order.order_number.toString().includes(query) ||
        (order.conversations?.name ?? "").toLowerCase().includes(query) ||
        (order.conversations?.phone ?? "").toLowerCase().includes(query) ||
        (order.address ?? "").toLowerCase().includes(query) ||
        (order.assigned_to ?? "").toLowerCase().includes(query) ||
        order.order_items.some((item) => item.name.toLowerCase().includes(query));

      return matchesTab && matchesSearch;
    });
  }, [orders, activeTab, searchTerm]);

  return (
    <div className="orders-page space-y-5 pb-2">
      <PageHeader title="Orders" description="A clear path from a new order to a happy customer." meta={<span className="status-pill bg-orange-50 text-brand">{counts.active} active</span>} actions={<>
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
          <button aria-pressed={viewMode === "cards"} onClick={() => setViewMode("cards")} className={clsx("flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium", viewMode === "cards" ? "bg-slate-100 text-slate-800" : "text-slate-400")}><LayoutGrid size={14} />List</button>
          <button aria-pressed={viewMode === "kds"} onClick={() => setViewMode("kds")} className={clsx("flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium", viewMode === "kds" ? "bg-slate-100 text-slate-800" : "text-slate-400")}><Kanban size={14} />Kitchen board</button>
        </div>
        <button className="ui-button" disabled={loading} onClick={revalidate} aria-label="Refresh orders"><RefreshCw size={14} className={clsx(loading && "animate-spin")} /><span className="hidden sm:inline">Refresh</span></button>
      </>} />
      {ordersError && <ErrorNotice message="We couldn’t load your orders. Please try again." retry={revalidate} />}

      {/* ── Cancellation Request Urgent Alert ────────────────────────── */}
      {counts.cancellationRequests > 0 && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 rounded-xl border border-rose-200 bg-rose-50/80 p-3 shadow-xs">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-600">
              <AlertOctagon size={15} />
            </div>
            <div>
              <p className="text-xs font-bold text-rose-950">
                {counts.cancellationRequests} Order Cancellation Request(s) Pending Review
              </p>
              <p className="text-[11px] text-rose-700">
                Customer requested cancellation via WhatsApp. Stop kitchen preparation and resolve below.
              </p>
            </div>
          </div>
          <button
            onClick={() => setActiveTab("active")}
            className="shrink-0 rounded-lg bg-rose-600 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-700 transition"
          >
            Review Orders
          </button>
        </div>
      )}

      {/* ── Filter Bar & Search Controls ─────────────────────────────── */}
      <div className="ui-card flex flex-col-reverse gap-3 p-3 xl:flex-row xl:items-center xl:justify-between">
        {/* Navigation Tabs */}
        <div className="no-scrollbar flex items-center gap-1 overflow-x-auto p-0.5">
          {[
            { key: "all", label: "All", count: counts.all },
            { key: "active", label: "Active", count: counts.active },
            { key: "received", label: "New", count: counts.received },
            { key: "preparing", label: "Kitchen", count: counts.preparing },
            { key: "out_for_delivery", label: "Delivery", count: counts.out_for_delivery },
            { key: "delivered", label: "Delivered", count: counts.delivered },
            { key: "cancelled", label: "Cancelled", count: counts.cancelled },
          ].map((tab) => {
            const isCurrent = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as FilterTab)}
                aria-pressed={isCurrent}
                className={clsx(
                  "flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all whitespace-nowrap",
                  isCurrent
                    ? "bg-slate-900 text-white shadow-xs"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                )}
              >
                <span>{tab.label}</span>
                <span
                  className={clsx(
                    "rounded px-1.5 py-0.2 text-[9px] font-bold",
                    isCurrent
                      ? "bg-slate-800 text-slate-200"
                      : "bg-slate-100 text-slate-600"
                  )}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search Input */}
        <div className="relative w-full xl:w-64 xl:shrink-0">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            aria-label="Search orders" placeholder="Search orders, customers or phone..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50 min-h-10 py-2 pl-8 pr-7 text-xs text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-brand/40 focus:bg-white"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              title="Clear search"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* ── Main View: Cards View vs KDS View ────────────────────────── */}
      {viewMode === "kds" ? (
        <KitchenBoardView
          orders={filteredOrders}
          savingId={savingId}
          onStatusChange={handleStatusChange}
          onPrint={handlePrintOrder}
        />
      ) : (
        <div className="space-y-4">
          {loading && filteredOrders.length === 0 ? (
            Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-28 animate-pulse rounded-2xl border border-slate-200/80 bg-white" />
            ))
          ) : filteredOrders.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center text-slate-500">
              <ShoppingBag size={28} className="mx-auto mb-2 text-slate-400" />
              <p className="text-sm font-semibold text-slate-800">No orders match this view</p>
              <p className="text-xs text-slate-400 mt-0.5">Try choosing another tab or clearing your search filters.</p>
            </div>
          ) : (
            filteredOrders.map((order) => {
              const expanded = expandedId === order.id;
              const isCancelled = order.status === "cancelled";
              const isCancellationRequested = Boolean(order.cancellation_requested_at && order.status !== "cancelled");
              const statusMeta = STATUS_CONFIG[order.status];
              const total = Number(order.subtotal) + Number(order.delivery_fee);
              const totalItems = order.order_items.reduce((sum, item) => sum + item.qty, 0);

              const cleanPhone = (order.conversations?.phone ?? "").replace(/\D/g, "");
              const timeDisplay = formatElapsedTime(order.created_at);

              // Calculate if delayed in active state (> 25 mins)
              const elapsedMins = Math.max(0, Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000));
              const isDelayed = ACTIVE_STATUSES.includes(order.status) && elapsedMins >= 25;

              return (
                <div
                  key={order.id}
                  data-testid={`order-card-${order.order_number}`}
                  className={clsx(
                    "group relative overflow-hidden rounded-xl border bg-white transition-all shadow-xs",
                    isCancelled
                      ? "border-slate-200 bg-slate-50/50 opacity-80"
                      : isCancellationRequested
                      ? "border-rose-300 ring-1 ring-rose-200"
                      : expanded
                      ? "border-slate-300 ring-1 ring-slate-200/80"
                      : "border-slate-200 hover:border-slate-300 hover:shadow-xs"
                  )}
                >
                  {/* Cancellation alert strip */}
                  {isCancellationRequested && (
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1.5 border-b border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-950">
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle size={13} className="text-rose-600 shrink-0" />
                        <span className="font-semibold text-[11px]">
                          Customer requested cancellation ({formatDistanceToNow(new Date(order.cancellation_requested_at!), { addSuffix: true })})
                        </span>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleStatusChange(order, "cancelled");
                        }}
                        disabled={savingId === order.id}
                        className="rounded-md bg-rose-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-rose-700 transition"
                      >
                        Confirm Cancellation
                      </button>
                    </div>
                  )}

                  {/* Main Card Body */}
                  <div
                    className="p-4 cursor-pointer"
                    onClick={() => setExpandedId(expanded ? null : order.id)}
                  >
                    {/* Row 1: Order Identity, Customer, Status, Amount & Actions */}
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                      {/* Left: Info */}
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Order Number */}
                        <span className={clsx("text-sm font-bold font-mono tracking-tight", isCancelled ? "text-slate-400 line-through" : "text-slate-900")}>
                          #{order.order_number}
                        </span>

                        {/* Status Badge */}
                        <span className={clsx("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold", statusMeta.badge)}>
                          <span className={clsx("h-1.5 w-1.5 rounded-full", statusMeta.dot)} />
                          <span>{statusMeta.label}</span>
                        </span>

                        {/* Fulfillment Type */}
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 capitalize">
                          {order.type === "delivery" ? (
                            <Truck size={12} className="text-slate-400" />
                          ) : (
                            <Package size={12} className="text-slate-400" />
                          )}
                          <span>{order.type.replace("-", " ")}</span>
                        </span>

                        {/* Placed Timestamp */}
                        <span className="text-[11px] text-slate-400">
                          {timeDisplay}
                        </span>

                        {/* Delay indicator */}
                        {isDelayed && (
                          <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.2 text-[10px] font-semibold text-amber-800">
                            Delayed
                          </span>
                        )}

                        <span className="text-slate-300">•</span>

                        {/* Customer Name & Quick Contacts */}
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-slate-800">
                            {order.conversations?.name ?? "Guest Customer"}
                          </span>

                          {order.conversations?.phone && (
                            <div className="flex items-center gap-1">
                              <a
                                href={`tel:${order.conversations.phone}`}
                                onClick={(e) => e.stopPropagation()}
                                className="flex h-5.5 w-5.5 items-center justify-center rounded border border-slate-200 bg-slate-50 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                                title={`Call ${order.conversations.phone}`}
                              >
                                <Phone size={10} />
                              </a>
                              {cleanPhone && (
                                <a
                                  href={`https://wa.me/${cleanPhone}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="flex h-5.5 w-5.5 items-center justify-center rounded border border-emerald-200 bg-emerald-50 text-emerald-700 transition hover:bg-emerald-100"
                                  title="Chat on WhatsApp"
                                >
                                  <MessageCircle size={10} />
                                </a>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Delivery Address */}
                        {order.address && (
                          <div className="hidden 2xl:flex items-center gap-1 text-[11px] text-slate-400 max-w-xs truncate" title={order.address}>
                            <MapPin size={11} className="shrink-0 text-slate-400" />
                            <span className="truncate">{order.address}</span>
                          </div>
                        )}
                      </div>

                      {/* Right: Amount & Compact Actions */}
                      <div className="flex items-center justify-between lg:justify-end gap-3 pt-1 border-t border-slate-100 lg:border-0 lg:pt-0">
                        {/* Price & Items count */}
                        <div className="text-left lg:text-right shrink-0">
                          <p className="text-xs font-bold text-slate-900">
                            Rs. {total.toLocaleString()}
                          </p>
                          <p className="text-[10px] text-slate-400">
                            {totalItems} items · COD
                          </p>
                        </div>

                        {/* Compact Action Controls */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          {/* Primary Step Progression Button */}
                          {order.status === "received" && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleStatusChange(order, "preparing");
                              }}
                              disabled={savingId === order.id}
                              className="inline-flex items-center gap-1 rounded-lg bg-brand h-9 px-3 text-[11px] font-bold text-white hover:bg-brand-hover transition disabled:opacity-50"
                            >
                              <ChefHat size={12} />
                              <span>Start preparing</span>
                            </button>
                          )}

                          {order.status === "preparing" && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleStatusChange(order, "out_for_delivery");
                              }}
                              disabled={savingId === order.id}
                              className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 h-9 px-3 text-[11px] font-bold text-white hover:bg-indigo-700 transition disabled:opacity-50"
                            >
                              <Truck size={12} />
                              <span>Dispatch</span>
                            </button>
                          )}

                          {order.status === "out_for_delivery" && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleStatusChange(order, "delivered");
                              }}
                              disabled={savingId === order.id}
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 h-9 px-3 text-[11px] font-bold text-white hover:bg-emerald-700 transition disabled:opacity-50"
                            >
                              <Check size={12} />
                              <span>Delivered</span>
                            </button>
                          )}

                          {/* Print Receipt Button */}
                          <button
                            data-testid={`order-print-${order.order_number}`}
                            onClick={(e) => void handlePrintOrder(order, e)}
                            className="flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 transition shadow-2xs"
                            title="Print thermal receipt"
                          >
                            <Printer size={12} className="mr-1 text-slate-500" />
                            <span>Print</span>
                          </button>

                          {/* Expand Details Toggle */}
                          <button
                            data-testid={`order-expand-${order.order_number}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedId(expanded ? null : order.id);
                            }}
                            className={clsx(
                              "flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500 transition hover:bg-slate-100",
                              expanded && "bg-slate-200/80"
                            )}
                            aria-expanded={expanded}
                            aria-label={expanded ? "Collapse order details" : "Expand order details"}
                            title={expanded ? "Collapse details" : "Expand details"}
                          >
                            <ChevronDown
                              size={13}
                              className={clsx("transition-transform duration-200", expanded && "rotate-180")}
                            />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Row 2: Clean Items Summary & Special Instruction Callout */}
                    <div className="mt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="text-[11px] font-semibold text-slate-400 mr-1 flex items-center gap-1">
                          <UtensilsCrossed size={11} /> Items:
                        </span>
                        {order.order_items.map((item) => (
                          <span
                            key={item.id}
                            className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 font-medium"
                          >
                            <span className="font-bold text-slate-900">{item.qty}×</span>
                            <span>{item.name}</span>
                            {item.size && <span className="text-[10px] text-slate-400">({item.size})</span>}
                          </span>
                        ))}
                      </div>

                      {order.customer_instructions && (
                        <div className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-900">
                          <MessageSquareText size={11} className="text-amber-600 shrink-0" />
                          <span className="font-semibold">Note:</span>
                          <span className="truncate max-w-sm">{order.customer_instructions}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── Expanded Order Details Drawer ─────────────────────────── */}
                  {expanded && (
                    <div className="border-t border-slate-200/80 bg-slate-50/50 p-4 sm:p-5">
                      <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-slate-800">Order details</h3><p className="mt-1 text-xs text-slate-500">Update status, check the receipt and manage fulfillment.</p></div>                          {/* Secondary Status Dropdown */}
                          <div className="relative">
                            <select
                              data-testid={`order-status-select-${order.order_number}`}
                              value={order.status}
                              disabled={savingId === order.id}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => void handleStatusChange(order, e.target.value as OrderStatus)}
                              className="h-10 appearance-none rounded-lg border border-slate-200 bg-slate-50 py-0 pl-2 pr-5 text-[11px] font-semibold text-slate-700 outline-none hover:bg-white focus:border-slate-300"
                              aria-label={`Change status for order #${order.order_number}`}
                            >
                              {getStatusOptions(order.status).map((status) => (
                                <option key={status} value={status}>
                                  {status.replaceAll("_", " ")}
                                </option>
                              ))}
                            </select>
                            <ChevronDown
                              size={10}
                              className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400"
                            />
                          </div>

</div>
                      <div className="grid gap-4 lg:grid-cols-2">
                        {/* Column 1: Itemized Receipt Table */}
                        <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs">
                          <div className="mb-3 flex items-center justify-between">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                              Itemized Receipt
                            </h3>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-slate-500">
                                {totalItems} total units
                              </span>
                              <button
                                type="button"
                                onClick={(e) => void handlePrintOrder(order, e)}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 transition active:scale-95 shadow-2xs"
                              >
                                <Printer size={12} className="text-slate-500" />
                                <span>Print Receipt</span>
                              </button>
                            </div>
                          </div>

                          <div className="divide-y divide-slate-100 text-xs">
                            {order.order_items.map((item) => (
                              <div key={item.id} className="py-2.5 flex items-start justify-between">
                                <div>
                                  <p className="font-semibold text-slate-900">
                                    <span className="font-bold text-brand mr-1">{item.qty}×</span>
                                    {formatOrderItemLabel(item)}
                                  </p>
                                  <p className="text-slate-400 mt-0.5">Rs. {item.price.toLocaleString()} each</p>
                                </div>
                                <span className="font-bold text-slate-900">
                                  Rs. {(item.price * item.qty).toLocaleString()}
                                </span>
                              </div>
                            ))}
                          </div>

                          <div className="mt-3 border-t border-slate-200 pt-3 space-y-1.5 text-xs text-slate-600">
                            <div className="flex justify-between">
                              <span>Subtotal</span>
                              <span className="font-semibold text-slate-800">
                                Rs. {Number(order.subtotal).toLocaleString()}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span>Delivery Fee</span>
                              <span className="font-semibold text-slate-800">
                                Rs. {Number(order.delivery_fee).toLocaleString()}
                              </span>
                            </div>
                            <div className="flex justify-between border-t border-slate-100 pt-2 text-sm font-bold text-slate-900">
                              <span>Total Due (COD)</span>
                              <span className="text-brand">Rs. {total.toLocaleString()}</span>
                            </div>
                          </div>
                        </section>

                        {/* Column 2: Order Info, Assignment & Notifications */}
                        <div className="space-y-4">
                          {/* Details & Delivery Info */}
                          <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs text-xs space-y-2.5">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                              Customer & Delivery Details
                            </h3>

                            <div className="flex justify-between text-slate-600">
                              <span>Customer</span>
                              <span className="font-semibold text-slate-900">
                                {order.conversations?.name ?? "Guest Customer"}
                              </span>
                            </div>

                            {order.conversations?.phone && (
                              <div className="flex justify-between text-slate-600">
                                <span>Phone</span>
                                <span className="font-mono font-medium text-slate-900">
                                  {order.conversations.phone}
                                </span>
                              </div>
                            )}

                            {order.address && (
                              <div className="flex justify-between gap-4 text-slate-600">
                                <span className="shrink-0">Address</span>
                                <span className="text-right font-medium text-slate-900">{order.address}</span>
                              </div>
                            )}

                            <div className="flex justify-between text-slate-600">
                              <span>Placed At</span>
                              <span className="font-medium text-slate-900">
                                {format(new Date(order.created_at), "dd MMM yyyy, h:mm a")}
                              </span>
                            </div>

                            {order.cancelled_at && (
                              <div className="flex justify-between text-rose-600">
                                <span className="font-semibold">Cancelled At</span>
                                <span className="font-medium">
                                  {format(new Date(order.cancelled_at), "dd MMM yyyy, h:mm a")}
                                </span>
                              </div>
                            )}
                          </section>

                          {/* Assignment input */}
                          <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                              Kitchen or Rider Assignment
                            </h3>
                            <div className="flex gap-2">
                              <input
                                value={assignees[order.id] ?? ""}
                                onChange={(e) => setAssignees((prev) => ({ ...prev, [order.id]: e.target.value }))}
                                placeholder="e.g. Chef Ali or Rider Tariq"
                                className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-800 outline-none focus:border-slate-300 focus:bg-white"
                              />
                              <button
                                onClick={() => void handleAssign(order)}
                                disabled={savingId === order.id}
                                className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 transition disabled:opacity-50"
                              >
                                Save
                              </button>
                            </div>
                          </section>

                          {/* WhatsApp Delivery Status */}
                          <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs text-xs">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                              WhatsApp Status Notification
                            </h3>
                            {order.status_notification_status ? (
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={clsx(
                                      "rounded-md px-2 py-0.5 text-[10px] font-bold uppercase",
                                      order.status_notification_status === "sent"
                                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                        : order.status_notification_status === "failed"
                                        ? "bg-rose-50 text-rose-700 border border-rose-200"
                                        : "bg-slate-100 text-slate-600"
                                    )}
                                  >
                                    {order.status_notification_status}
                                  </span>
                                  {order.status_notified_at && (
                                    <span className="text-slate-400">
                                      {formatDistanceToNow(new Date(order.status_notified_at), { addSuffix: true })}
                                    </span>
                                  )}
                                </div>
                                {order.status_notification_error && (
                                  <p className="text-rose-600">{order.status_notification_error}</p>
                                )}
                              </div>
                            ) : (
                              <p className="text-slate-400">No external status notification sent yet.</p>
                            )}
                          </section>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ── Kitchen Board (KDS View) Component ──────────────────────────────────────
function KitchenBoardView({
  orders,
  savingId,
  onStatusChange,
  onPrint,
}: {
  orders: Order[];
  savingId: string | null;
  onStatusChange: (order: Order, nextStatus: OrderStatus) => Promise<void>;
  onPrint?: (order: Order, e?: React.MouseEvent) => void;
}) {
  const columns: Array<{
    status: OrderStatus;
    title: string;
    badge: string;
    nextStatus?: OrderStatus;
    actionLabel?: string;
    btnClass?: string;
  }> = [
    {
      status: "received",
      title: "New Orders",
      badge: "bg-sky-100 text-sky-800",
      nextStatus: "preparing",
      actionLabel: "Start Cooking",
      btnClass: "bg-brand hover:bg-brand-hover text-white",
    },
    {
      status: "preparing",
      title: "Cooking in Kitchen",
      badge: "bg-amber-100 text-amber-800",
      nextStatus: "out_for_delivery",
      actionLabel: "Ready / Dispatch",
      btnClass: "bg-indigo-600 hover:bg-indigo-700 text-white",
    },
    {
      status: "out_for_delivery",
      title: "Ready / Out for Delivery",
      badge: "bg-indigo-100 text-indigo-800",
      nextStatus: "delivered",
      actionLabel: "Mark Delivered",
      btnClass: "bg-emerald-600 hover:bg-emerald-700 text-white",
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {columns.map((col) => {
        const colOrders = orders.filter((o) => o.status === col.status);
        return (
          <div key={col.status} className="flex flex-col rounded-2xl border border-slate-200/80 bg-slate-100/50 p-3 shadow-xs">
            {/* Column Header */}
            <div className="mb-3 flex items-center justify-between border-b border-slate-200/80 pb-2.5">
              <span className="text-xs font-bold text-slate-700">{col.title}</span>
              <span className={clsx("rounded-full px-2 py-0.5 text-xs font-bold", col.badge)}>
                {colOrders.length}
              </span>
            </div>

            {/* Orders Lane */}
            <div className="space-y-3 flex-1 overflow-y-auto md:max-h-[calc(100dvh-310px)] pr-0.5">
              {colOrders.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-white/60 p-8 text-center text-xs text-slate-400">
                  No orders in this stage
                </div>
              ) : (
                colOrders.map((order) => {
                  const timeDisplay = formatElapsedTime(order.created_at);
                  const isCancelRequested = Boolean(order.cancellation_requested_at && order.status !== "cancelled");

                  return (
                    <div
                      key={order.id}
                      data-testid={`order-card-${order.order_number}`}
                      className="rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-xs space-y-2.5"
                    >
                      {/* Cancellation warning in KDS */}
                      {isCancelRequested && (
                        <div className="rounded-lg bg-rose-50 border border-rose-200 p-2 text-xs font-bold text-rose-800 flex items-center gap-1.5">
                          <AlertOctagon size={14} className="text-rose-600 shrink-0" />
                          <span>Customer requested cancellation!</span>
                        </div>
                      )}

                      {/* Header */}
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-base font-extrabold font-mono text-slate-900">
                            #{order.order_number}
                          </span>
                          <p className="text-xs font-medium text-slate-600">
                            {order.conversations?.name ?? "Guest Customer"}
                          </p>
                        </div>
                        <span className="rounded-md border border-slate-200/80 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                          {timeDisplay}
                        </span>
                      </div>

                      {/* Items ticket */}
                      <div className="space-y-1 rounded-lg border border-slate-100 bg-slate-50/70 p-2 text-xs">
                        {order.order_items.map((i) => (
                          <div key={i.id} className="flex justify-between text-slate-800">
                            <span className="font-medium">
                              <span className="font-bold text-brand mr-1">{i.qty}×</span>
                              {i.name}
                            </span>
                            {i.size && <span className="text-slate-400 text-[11px]">({i.size})</span>}
                          </div>
                        ))}
                      </div>

                      {/* Customer Note */}
                      {order.customer_instructions && (
                        <p className="rounded-lg border border-amber-200/80 bg-amber-50/70 p-2 text-xs text-amber-900">
                          <span className="font-semibold">Note:</span> {order.customer_instructions}
                        </p>
                      )}

                      {/* Action Button & Print */}
                      <div className="flex items-center gap-2">
                        {onPrint && (
                          <button
                            type="button"
                            onClick={(e) => onPrint(order, e)}
                            className="flex h-8 items-center justify-center rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition active:scale-95 shrink-0 shadow-2xs"
                            title="Print thermal ticket"
                          >
                            <Printer size={13} className="mr-1 text-slate-500" />
                            <span>Print</span>
                          </button>
                        )}
                        {col.nextStatus && col.actionLabel && (
                          <button
                            onClick={() => void onStatusChange(order, col.nextStatus!)}
                            disabled={savingId === order.id}
                            className={clsx(
                              "flex-1 rounded-xl py-2 text-xs font-semibold shadow-xs transition active:scale-98 disabled:opacity-50",
                              col.btnClass
                            )}
                          >
                            {col.actionLabel}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
