"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertOctagon,
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChefHat,
  ChevronDown,
  ChevronUp,
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
  UserRound,
  UtensilsCrossed,
} from "lucide-react";
import { clsx } from "clsx";
import { format, formatDistanceToNow } from "date-fns";
import { useDashboardContext } from "@/app/components/dashboard/DashboardProvider";
import { PageHeader } from "@/app/components/dashboard/PageHeader";
import { toast } from "sonner";
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

const STATUS_MAP: Record<
  OrderStatus,
  { label: string; badge: string; borderAccent: string; icon: typeof Clock }
> = {
  received: {
    label: "New Order",
    badge: "bg-blue-100 text-blue-800 border-blue-200",
    borderAccent: "border-l-blue-500",
    icon: Clock,
  },
  preparing: {
    label: "In Kitchen",
    badge: "bg-amber-100 text-amber-800 border-amber-200",
    borderAccent: "border-l-amber-500",
    icon: ChefHat,
  },
  out_for_delivery: {
    label: "On The Way",
    badge: "bg-indigo-100 text-indigo-800 border-indigo-200",
    borderAccent: "border-l-indigo-500",
    icon: Truck,
  },
  delivered: {
    label: "Delivered",
    badge: "bg-emerald-100 text-emerald-800 border-emerald-200",
    borderAccent: "border-l-emerald-500",
    icon: CheckCircle2,
  },
  cancelled: {
    label: "Cancelled",
    badge: "bg-red-100 text-red-800 border-red-200 font-bold",
    borderAccent: "border-l-red-500",
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

function getCancellationMinutesRemaining(order: Order): number {
  const createdAt = new Date(order.created_at).getTime();
  if (!Number.isFinite(createdAt)) return 0;
  const windowMs = 10 * 60 * 1000;
  const remaining = Math.ceil((windowMs - (Date.now() - createdAt)) / 60000);
  return Math.max(0, remaining);
}

function getSlaTimeBadge(createdAt: string) {
  const elapsedMs = Date.now() - new Date(createdAt).getTime();
  const mins = Math.max(0, Math.floor(elapsedMs / 60000));
  if (mins < 10) {
    return {
      text: `${mins}m ago`,
      classes: "bg-emerald-50 text-emerald-700 border-emerald-200",
      dot: "bg-emerald-500",
    };
  }
  if (mins < 25) {
    return {
      text: `${mins}m ago`,
      classes: "bg-amber-50 text-amber-700 border-amber-200",
      dot: "bg-amber-500",
    };
  }
  return {
    text: `${mins}m ago (SLA)`,
    classes: "bg-red-50 text-red-700 border-red-200 font-semibold",
    dot: "bg-red-500 animate-pulse",
  };
}

export default function OrdersPage() {
  const { selectedBranchId, selectedBranch } = useDashboardContext();
  const [activeTab, setActiveTab] = useState<FilterTab>("active");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [assignees, setAssignees] = useState<Record<string, string>>({});

  const ordersUrl = useMemo(() => {
    const branchQuery = selectedBranchId === "all" ? "" : `&branch_id=${encodeURIComponent(selectedBranchId)}`;
    return `/api/orders?limit=100${branchQuery}`;
  }, [selectedBranchId]);

  const {
    data: orders,
    isLoading: loading,
    revalidate,
  } = useDataCache<Order[]>(ordersUrl);

  // Sync assignees state from fetched orders
  useEffect(() => {
    if (orders) {
      setAssignees(Object.fromEntries(orders.map((order) => [order.id, order.assigned_to ?? ""])));
    }
  }, [orders]);

  // Periodic auto-refresh — silent, no skeleton
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
      toast.success("Order updated.");
      // Bust cache so next render fetches fresh data
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

    if ((nextStatus === "cancelled" || nextStatus === "delivered") && !window.confirm(`Confirm marking order #${order.order_number} as ${nextStatus.replaceAll("_", " ")}?`)) {
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
    <div className="space-y-4 pb-6 sm:space-y-6 sm:pb-12">
      <PageHeader
        title="Kitchen & Order Queue"
        description={selectedBranch ? `Live orders for ${selectedBranch.name}.` : "Live orders across all branches."}
        meta={
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-100 px-3 py-1 text-xs font-bold text-brand">
              <span className="h-2 w-2 rounded-full bg-brand animate-ping" />
              {counts.active} Active
            </span>
            {counts.cancelled > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-700">
                <Ban size={12} /> {counts.cancelled} Cancelled
              </span>
            )}
          </div>
        }
        actions={
          <div className="flex items-center gap-2">
            {/* View Mode Toggle */}
            <div className="hidden sm:flex items-center rounded-lg border border-slate-200 bg-white p-0.5 shadow-xs">
              <button
                onClick={() => setViewMode("cards")}
                className={clsx(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition",
                  viewMode === "cards" ? "bg-slate-900 text-white shadow-xs" : "text-slate-600 hover:text-slate-900"
                )}
                title="Detailed Cards View"
              >
                <LayoutGrid size={14} />
                <span>Cards</span>
              </button>
              <button
                onClick={() => setViewMode("kds")}
                className={clsx(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition",
                  viewMode === "kds" ? "bg-slate-900 text-white shadow-xs" : "text-slate-600 hover:text-slate-900"
                )}
                title="Kitchen Display Board View"
              >
                <Kanban size={14} />
                <span>Kitchen Board (KDS)</span>
              </button>
            </div>

            <button
              onClick={() => revalidate()}
              disabled={loading}
              className="flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-700 shadow-xs transition-colors hover:bg-slate-50 disabled:opacity-50"
              aria-label="Refresh orders"
            >
              <RefreshCw size={14} className={clsx(loading && "animate-spin text-brand")} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        }
      />

      {/* Cancellation Request Staff Alert Banner */}
      {counts.cancellationRequests > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border-2 border-rose-300 bg-gradient-to-r from-rose-50 to-red-50 p-4 shadow-sm animate-pulse">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-100 text-red-700">
              <AlertOctagon size={22} className="animate-bounce" />
            </div>
            <div>
              <p className="text-sm font-bold text-red-900">
                ⚠️ {counts.cancellationRequests} Order Cancellation Request(s) Pending Review!
              </p>
              <p className="text-xs text-red-700">
                Customer(s) requested cancellation. Stop food preparation immediately and review below.
              </p>
            </div>
          </div>
          <button
            onClick={() => setActiveTab("active")}
            className="rounded-xl bg-red-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-red-700 transition"
          >
            Review Requests
          </button>
        </div>
      )}

      {/* Filter Tabs & Search Bar */}
      <div className="sticky top-0 z-10 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/95 p-2.5 shadow-sm backdrop-blur lg:static lg:flex-row lg:items-center lg:justify-between">
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-1">
          {[
            { key: "all", label: "All", count: counts.all },
            { key: "active", label: "Active Queue", count: counts.active },
            { key: "received", label: "New", count: counts.received },
            { key: "preparing", label: "In Kitchen", count: counts.preparing },
            { key: "out_for_delivery", label: "On Delivery", count: counts.out_for_delivery },
            { key: "delivered", label: "Delivered", count: counts.delivered },
            { key: "cancelled", label: "Cancelled", count: counts.cancelled },
          ].map((tab) => {
            const isCurrent = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as FilterTab)}
                className={clsx(
                  "shrink-0 flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all",
                  isCurrent
                    ? "bg-white text-slate-900 shadow-xs ring-1 ring-slate-200"
                    : "text-slate-500 hover:text-slate-800 hover:bg-slate-200/50"
                )}
              >
                <span>{tab.label}</span>
                <span
                  className={clsx(
                    "rounded-full px-1.5 py-0.2 text-[10px] font-black",
                    isCurrent ? (tab.key === "cancelled" ? "bg-red-100 text-red-800" : "bg-orange-100 text-orange-800") : "bg-slate-200 text-slate-600"
                  )}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="relative w-full lg:w-80">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search #, name, phone, item..."
            className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2 pl-9 pr-3 text-sm text-slate-800 outline-none transition-all focus:border-orange-300 focus:bg-white focus:ring-2 focus:ring-brand/15"
          />
        </div>
      </div>

      {/* Main Content: KDS View vs Cards View */}
      {viewMode === "kds" ? (
        <KitchenBoardView
          orders={filteredOrders}
          savingId={savingId}
          onStatusChange={handleStatusChange}
        />
      ) : (
        <div className="space-y-3.5">
          {loading && filteredOrders.length === 0 ? (
            Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-32 animate-pulse rounded-2xl border border-slate-200 bg-white" />
            ))
          ) : filteredOrders.length === 0 ? (
            <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-white py-20 text-center text-slate-500">
              <ShoppingBag size={32} className="mx-auto mb-3 text-slate-400" />
              <p className="text-base font-semibold text-slate-700">No orders match this view.</p>
              <p className="text-xs text-slate-400 mt-1">Try selecting a different filter tab or clearing your search.</p>
            </div>
          ) : (
            filteredOrders.map((order) => {
              const expanded = expandedId === order.id;
              const isCancelled = order.status === "cancelled";
              const isCancellationRequested = Boolean(order.cancellation_requested_at && order.status !== "cancelled");
              const statusMeta = STATUS_MAP[order.status];
              const total = Number(order.subtotal) + Number(order.delivery_fee);
              const totalItems = order.order_items.reduce((sum, item) => sum + item.qty, 0);
              const sla = getSlaTimeBadge(order.created_at);
              const cleanPhone = (order.conversations?.phone ?? "").replace(/\D/g, "");

              return (
                <div
                  key={order.id}
                  data-testid={`order-card-${order.order_number}`}
                  className={clsx(
                    "relative overflow-hidden rounded-2xl border transition-all shadow-xs",
                    isCancelled
                      ? "border-red-300 bg-red-50/15 border-l-6 border-l-red-500"
                      : isCancellationRequested
                      ? "border-rose-400 bg-rose-50/25 border-l-6 border-l-rose-500 ring-2 ring-rose-200"
                      : clsx(
                          expanded ? "border-brand/40 shadow-md ring-1 ring-brand/20" : "border-slate-200 hover:border-slate-300",
                          statusMeta.borderAccent,
                          "border-l-6 bg-white"
                        )
                  )}
                >
                  <div
                    className="cursor-pointer p-4 sm:p-5"
                    onClick={() => setExpandedId(expanded ? null : order.id)}
                  >
                    {/* CRITICAL WARNING BANNER: CANCELLED BY CUSTOMER */}
                    {isCancelled && (
                      <div className="mb-3.5 flex items-center justify-between rounded-xl border border-red-200 bg-red-100/80 px-3.5 py-2.5 text-xs text-red-950 shadow-xs">
                        <div className="flex items-center gap-2.5">
                          <AlertOctagon size={20} className="text-red-600 shrink-0" />
                          <div>
                            <span className="font-black tracking-wide text-red-900 uppercase">
                              🛑 Order Cancelled by Customer
                            </span>
                            {order.cancelled_at && (
                              <span className="ml-2 font-medium text-red-800">
                                ({formatDistanceToNow(new Date(order.cancelled_at), { addSuffix: true })})
                              </span>
                            )}
                            <p className="text-[11px] font-semibold text-red-700 mt-0.5">
                              Kitchen Staff Alert: DO NOT cook, pack, or dispatch this order.
                            </p>
                          </div>
                        </div>
                        <span className="rounded-md bg-red-200/90 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-red-900">
                          Void
                        </span>
                      </div>
                    )}

                    {/* URGENT WARNING BANNER: PENDING CANCELLATION REQUEST */}
                    {isCancellationRequested && (
                      <div className="mb-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 rounded-xl border-2 border-rose-400 bg-rose-100/90 p-3 text-xs text-rose-950 shadow-sm animate-pulse">
                        <div className="flex items-center gap-2.5">
                          <AlertTriangle size={20} className="text-rose-700 shrink-0" />
                          <div>
                            <span className="font-extrabold uppercase tracking-wide text-rose-950">
                              ⚠️ Customer Requested Cancellation ({formatDistanceToNow(new Date(order.cancellation_requested_at!), { addSuffix: true })})
                            </span>
                            <p className="text-[11px] font-semibold text-rose-800 mt-0.5">
                              Customer asked to cancel via WhatsApp chat. Stop kitchen cooking immediately!
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleStatusChange(order, "cancelled");
                          }}
                          disabled={savingId === order.id}
                          className="shrink-0 rounded-xl bg-red-600 px-3.5 py-2 text-xs font-extrabold text-white shadow hover:bg-red-700 transition active:scale-95"
                        >
                          Confirm & Mark Cancelled
                        </button>
                      </div>
                    )}

                    {/* Header Row: Order Number, Customer, Meta, Actions */}
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      {/* Left: Order # and Badges */}
                      <div className="flex flex-wrap items-center gap-3">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Order</p>
                          <p className={clsx("text-2xl font-black tracking-tight", isCancelled ? "text-slate-400 line-through" : "text-slate-900")}>
                            #{order.order_number}
                          </p>
                        </div>

                        {/* Status Badge */}
                        <span className={clsx("inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-bold uppercase tracking-wider", statusMeta.badge)}>
                          <statusMeta.icon size={13} />
                          <span>{statusMeta.label}</span>
                        </span>

                        {/* Order Type Badge */}
                        <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold capitalize text-slate-700">
                          {order.type === "delivery" ? <Truck size={13} className="text-blue-600" /> : <Package size={13} className="text-amber-600" />}
                          <span>{order.type.replace("-", " ")}</span>
                        </span>

                        {/* SLA Elapsed Pill */}
                        <span className={clsx("inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs", sla.classes)}>
                          <span className={clsx("h-1.5 w-1.5 rounded-full", sla.dot)} />
                          <span>{sla.text}</span>
                        </span>
                      </div>

                      {/* Middle: Customer Details & Contact Links */}
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                          <span className="text-base font-bold text-slate-900 truncate">
                            {order.conversations?.name ?? "Guest Customer"}
                          </span>

                          {order.conversations?.phone && (
                            <div className="flex items-center gap-1.5">
                              <a
                                href={`tel:${order.conversations.phone}`}
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 rounded-md border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs font-semibold text-brand hover:bg-orange-100 transition"
                                title="Call customer"
                              >
                                <Phone size={11} />
                                <span>{order.conversations.phone}</span>
                              </a>
                              {cleanPhone && (
                                <a
                                  href={`https://wa.me/${cleanPhone}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition"
                                  title="Chat on WhatsApp"
                                >
                                  <MessageCircle size={11} />
                                  <span>WhatsApp</span>
                                </a>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Meta: Branch, Address, Assignee */}
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                          {order.branches?.name && <span>{order.branches.name}</span>}
                          {order.address && (
                            <span className="inline-flex max-w-sm items-center gap-1 truncate text-slate-600 font-medium">
                              <MapPin size={12} className="shrink-0 text-slate-400" />
                              <span className="truncate">{order.address}</span>
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1 text-slate-400">
                            <UserRound size={12} />
                            <span>{order.assigned_to ?? "Unassigned"}</span>
                          </span>
                        </div>
                      </div>

                      {/* Right: Total, Cancel Window & Kitchen Quick Actions */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between lg:justify-end gap-3 border-t border-slate-100 pt-3 lg:border-0 lg:pt-0">
                        <div className="text-left sm:text-right">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                            {totalItems} items • COD
                          </p>
                          <p className="text-xl font-black text-slate-900">
                            Rs. {total.toLocaleString()}
                          </p>
                          {ACTIVE_STATUSES.includes(order.status) && (
                            <p className="text-[11px] font-medium text-slate-500">
                              Cancel window: <span className="font-bold text-slate-700">{getCancellationMinutesRemaining(order)}m left</span>
                            </p>
                          )}
                        </div>

                        {/* Quick Action Buttons for Kitchen Staff */}
                        <div className="flex items-center gap-2">
                          {order.status === "received" && (
                            <>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleStatusChange(order, "preparing");
                                }}
                                disabled={savingId === order.id}
                                className="inline-flex items-center gap-1.5 rounded-xl bg-orange-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-orange-700 transition active:scale-95 disabled:opacity-50"
                              >
                                <ChefHat size={14} />
                                <span>Start Cooking</span>
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleStatusChange(order, "cancelled");
                                }}
                                disabled={savingId === order.id}
                                className="inline-flex items-center gap-1 rounded-xl border border-red-200 bg-white px-2.5 py-2 text-xs font-bold text-red-600 hover:bg-red-50 transition active:scale-95 disabled:opacity-50"
                                title="Cancel Order"
                              >
                                <Ban size={13} />
                                <span className="hidden xl:inline">Cancel</span>
                              </button>
                            </>
                          )}

                          {order.status === "preparing" && (
                            <>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleStatusChange(order, "out_for_delivery");
                                }}
                                disabled={savingId === order.id}
                                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-indigo-700 transition active:scale-95 disabled:opacity-50"
                              >
                                <Truck size={14} />
                                <span>Ready / Dispatch</span>
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleStatusChange(order, "cancelled");
                                }}
                                disabled={savingId === order.id}
                                className="inline-flex items-center gap-1 rounded-xl border border-red-200 bg-white px-2.5 py-2 text-xs font-bold text-red-600 hover:bg-red-50 transition active:scale-95 disabled:opacity-50"
                                title="Cancel Order"
                              >
                                <Ban size={13} />
                                <span className="hidden xl:inline">Cancel</span>
                              </button>
                            </>
                          )}

                          {order.status === "out_for_delivery" && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleStatusChange(order, "delivered");
                              }}
                              disabled={savingId === order.id}
                              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 transition active:scale-95 disabled:opacity-50"
                            >
                              <CheckCircle2 size={14} />
                              <span>Mark Delivered</span>
                            </button>
                          )}

                          {/* Secondary status dropdown for override / tests */}
                          <div className="relative min-w-0">
                            <select
                              data-testid={`order-status-select-${order.order_number}`}
                              value={order.status}
                              disabled={savingId === order.id}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => void handleStatusChange(order, e.target.value as OrderStatus)}
                              className="w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 py-2 pl-3 pr-8 text-[11px] font-bold uppercase tracking-wider text-slate-700 outline-none transition-all focus:ring-2 focus:ring-brand/10 hover:bg-slate-100"
                            >
                              {getStatusOptions(order.status).map((status) => (
                                <option key={status} value={status}>
                                  {status.replaceAll("_", " ")}
                                </option>
                              ))}
                            </select>
                            <ChevronDown
                              size={13}
                              className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                            />
                          </div>

                          {/* Expand details button */}
                          <button
                            data-testid={`order-expand-${order.order_number}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedId(expanded ? null : order.id);
                            }}
                            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 transition shadow-xs"
                            title={expanded ? "Collapse Details" : "Expand Details"}
                          >
                            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* DIRECT ITEMS PREVIEW (No expand needed!) */}
                    <div className="mt-3.5 pt-3 border-t border-slate-100/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mr-1 flex items-center gap-1">
                          <UtensilsCrossed size={12} /> Items:
                        </span>
                        {order.order_items.map((item) => (
                          <span
                            key={item.id}
                            className={clsx(
                              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold shadow-2xs",
                              isCancelled
                                ? "border-slate-200 bg-slate-100 text-slate-500 line-through"
                                : "border-orange-100 bg-orange-50/50 text-slate-800"
                            )}
                          >
                            <span className="rounded bg-orange-200/80 px-1.5 py-0.2 text-[10px] font-black text-orange-950">
                              {item.qty}×
                            </span>
                            <span>{item.name}</span>
                            {item.size && <span className="text-[10px] text-slate-500 font-normal">({item.size})</span>}
                          </span>
                        ))}
                      </div>

                      {order.customer_instructions && (
                        <div className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-900 font-medium">
                          <MessageSquareText size={13} className="text-amber-600 shrink-0" />
                          <span className="font-bold text-amber-950">Special Note:</span>
                          <span className="truncate max-w-xs">{order.customer_instructions}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Expanded Audit & Assignment Details */}
                  {expanded && (
                    <div className="border-t border-slate-200/80 bg-slate-50/50 px-4 py-5 sm:px-6">
                      <div className="grid gap-6 lg:grid-cols-2">
                        {/* Column 1: Detailed Items & Assignment */}
                        <div className="space-y-4">
                          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
                            <div className="mb-3 flex items-center justify-between">
                              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                                Detailed Line Items
                              </p>
                              <span className="text-xs font-bold text-slate-700">{totalItems} items total</span>
                            </div>
                            <div className="space-y-2">
                              {order.order_items.map((item) => (
                                <div
                                  key={item.id}
                                  className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3.5 py-2.5"
                                >
                                  <div>
                                    <p className="text-sm font-bold text-slate-900">
                                      {formatOrderItemLabel(item)} <span className="text-brand">×{item.qty}</span>
                                    </p>
                                    <p className="text-xs text-slate-500">Rs. {item.price.toLocaleString()} each</p>
                                  </div>
                                  <span className="text-sm font-extrabold text-slate-900">
                                    Rs. {(item.price * item.qty).toLocaleString()}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </section>

                          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
                            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                              Order Assignment (Kitchen Chef or Rider)
                            </p>
                            <div className="flex flex-col gap-2 sm:flex-row">
                              <input
                                value={assignees[order.id] ?? ""}
                                onChange={(e) => setAssignees((prev) => ({ ...prev, [order.id]: e.target.value }))}
                                placeholder="e.g. Chef Ali / Rider Tariq..."
                                className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-sm outline-none focus:bg-white focus:border-orange-300 focus:ring-2 focus:ring-brand/10"
                              />
                              <button
                                onClick={() => void handleAssign(order)}
                                disabled={savingId === order.id}
                                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 transition disabled:opacity-50"
                              >
                                Save Assignment
                              </button>
                            </div>
                          </section>
                        </div>

                        {/* Column 2: Audit Timeline & Customer Notification */}
                        <div className="space-y-4">
                          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
                            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">
                              Order & Payment Summary
                            </p>
                            <div className="space-y-2.5 text-sm text-slate-700">
                              <div className="flex justify-between">
                                <span>Placed At</span>
                                <span className="font-semibold text-slate-900">
                                  {format(new Date(order.created_at), "dd MMM yyyy, hh:mm a")}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span>Fulfillment Type</span>
                                <span className="font-semibold capitalize text-slate-900">
                                  {order.type.replace("-", " ")}
                                </span>
                              </div>
                              {order.address && (
                                <div className="flex justify-between gap-4">
                                  <span>Delivery Address</span>
                                  <span className="text-right font-semibold text-slate-900">{order.address}</span>
                                </div>
                              )}
                              {order.cancelled_at && (
                                <div className="flex justify-between text-red-600">
                                  <span className="font-bold">Cancelled At</span>
                                  <span className="font-bold">
                                    {format(new Date(order.cancelled_at), "dd MMM yyyy, hh:mm a")}
                                  </span>
                                </div>
                              )}
                              <div className="border-t border-slate-100 pt-2 flex justify-between">
                                <span>Food Subtotal</span>
                                <span className="font-semibold text-slate-900">
                                  Rs. {Number(order.subtotal).toLocaleString()}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span>Delivery Fee</span>
                                <span className="font-semibold text-slate-900">
                                  Rs. {Number(order.delivery_fee).toLocaleString()}
                                </span>
                              </div>
                              <div className="border-t border-slate-200 pt-2 flex justify-between text-base">
                                <span className="font-extrabold text-slate-900">Total Due (COD)</span>
                                <span className="font-black text-brand">
                                  Rs. {(Number(order.subtotal) + Number(order.delivery_fee)).toLocaleString()}
                                </span>
                              </div>
                            </div>
                          </section>

                          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
                            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                              Customer WhatsApp Notification
                            </p>
                            {order.status_notification_status ? (
                              <div className="space-y-1.5 text-xs text-slate-700">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={clsx(
                                      "rounded-md px-2 py-0.5 text-[10px] font-black uppercase tracking-wider",
                                      order.status_notification_status === "sent"
                                        ? "bg-emerald-100 text-emerald-800"
                                        : order.status_notification_status === "failed"
                                        ? "bg-red-100 text-red-800"
                                        : "bg-slate-100 text-slate-700"
                                    )}
                                  >
                                    {order.status_notification_status}
                                  </span>
                                  {order.status_notified_at && (
                                    <span className="text-slate-500">
                                      {formatDistanceToNow(new Date(order.status_notified_at), { addSuffix: true })}
                                    </span>
                                  )}
                                </div>
                                {order.status_notification_error && (
                                  <p className="text-red-600 font-medium">{order.status_notification_error}</p>
                                )}
                              </div>
                            ) : (
                              <p className="text-xs text-slate-500">No external status notification sent yet.</p>
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
}: {
  orders: Order[];
  savingId: string | null;
  onStatusChange: (order: Order, nextStatus: OrderStatus) => Promise<void>;
}) {
  const columns: Array<{ status: OrderStatus; title: string; color: string; badge: string }> = [
    { status: "received", title: "New Orders", color: "border-blue-300 bg-blue-50/50", badge: "bg-blue-600 text-white" },
    { status: "preparing", title: "In Kitchen (Cooking)", color: "border-amber-300 bg-amber-50/50", badge: "bg-amber-600 text-white" },
    { status: "out_for_delivery", title: "Ready / Out for Delivery", color: "border-indigo-300 bg-indigo-50/50", badge: "bg-indigo-600 text-white" },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {columns.map((col) => {
        const colOrders = orders.filter((o) => o.status === col.status);
        return (
          <div key={col.status} className={clsx("flex flex-col rounded-2xl border p-3 shadow-xs", col.color)}>
            <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-2">
              <span className="text-xs font-black uppercase tracking-wider text-slate-700">{col.title}</span>
              <span className={clsx("rounded-full px-2 py-0.5 text-xs font-black", col.badge)}>
                {colOrders.length}
              </span>
            </div>

            <div className="space-y-3 flex-1 overflow-y-auto max-h-[750px] pr-1">
              {colOrders.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-xs text-slate-400">
                  No orders in this stage
                </div>
              ) : (
                colOrders.map((order) => {
                  const sla = getSlaTimeBadge(order.created_at);
                  const isCancelRequested = Boolean(order.cancellation_requested_at && order.status !== "cancelled");
                  return (
                    <div
                      key={order.id}
                      data-testid={`order-card-${order.order_number}`}
                      className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm space-y-3"
                    >
                      {/* Cancellation warning in KDS */}
                      {isCancelRequested && (
                        <div className="rounded-lg bg-red-100 p-2 text-xs font-bold text-red-900 flex items-center gap-1.5 animate-pulse">
                          <AlertOctagon size={15} className="text-red-700" />
                          <span>CUSTOMER REQUESTED CANCEL!</span>
                        </div>
                      )}

                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-lg font-black text-slate-900">#{order.order_number}</span>
                          <p className="text-xs font-bold text-slate-700">{order.conversations?.name ?? "Customer"}</p>
                        </div>
                        <span className={clsx("rounded-md border px-2 py-0.5 text-[11px] font-bold", sla.classes)}>
                          {sla.text}
                        </span>
                      </div>

                      {/* Items list with quantities */}
                      <div className="space-y-1 rounded-lg bg-slate-50 p-2 text-xs">
                        {order.order_items.map((i) => (
                          <div key={i.id} className="flex justify-between font-bold text-slate-800">
                            <span>
                              <span className="text-brand mr-1">{i.qty}×</span>
                              {i.name}
                            </span>
                            {i.size && <span className="text-slate-400 font-normal">({i.size})</span>}
                          </div>
                        ))}
                      </div>

                      {order.customer_instructions && (
                        <p className="rounded-md bg-amber-50 border border-amber-200 p-1.5 text-xs text-amber-900 font-medium">
                          ⚠️ {order.customer_instructions}
                        </p>
                      )}

                      {/* Action Button */}
                      <div className="pt-1">
                        {order.status === "received" && (
                          <button
                            onClick={() => void onStatusChange(order, "preparing")}
                            disabled={savingId === order.id}
                            className="w-full rounded-xl bg-orange-600 py-2 text-xs font-extrabold text-white hover:bg-orange-700 transition"
                          >
                            👨‍🍳 Start Cooking
                          </button>
                        )}
                        {order.status === "preparing" && (
                          <button
                            onClick={() => void onStatusChange(order, "out_for_delivery")}
                            disabled={savingId === order.id}
                            className="w-full rounded-xl bg-indigo-600 py-2 text-xs font-extrabold text-white hover:bg-indigo-700 transition"
                          >
                            🛵 Ready / Dispatch
                          </button>
                        )}
                        {order.status === "out_for_delivery" && (
                          <button
                            onClick={() => void onStatusChange(order, "delivered")}
                            disabled={savingId === order.id}
                            className="w-full rounded-xl bg-emerald-600 py-2 text-xs font-extrabold text-white hover:bg-emerald-700 transition"
                          >
                            ✅ Mark Delivered
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
