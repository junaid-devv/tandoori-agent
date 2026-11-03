import { scopeBranchQuery, scopeRestaurantQuery } from "@/lib/tenant-scope";
import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-utils";
import { resolveRequestBranch } from "@/lib/branch-request";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { confirmedOrderRevenue, countsTowardRevenue } from "@/lib/order-revenue";

function getRangeStart(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

function getHourKey(createdAt: string) {
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime())) return "unknown";
  return `${date.getHours().toString().padStart(2, "0")}:00`;
}

export async function GET(req: NextRequest) {
  const auth = await resolveRequestBranch(req, { allowAllForAdmin: true });
  if (auth.response) return auth.response;

  const since = getRangeStart(30);

  try {
    let ordersQuery = supabaseAdmin
      .from("orders")
      .select(`
        id,
        conversation_id,
        type,
        status,
        subtotal,
        delivery_fee,
        total,
        created_at,
        order_items (
          name,
          qty,
          price
        )
      `)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    ordersQuery = scopeBranchQuery(ordersQuery, auth);

    const orders = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await ordersQuery.range(offset, offset + 999);
      if (error) throw error;
      orders.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }

    let conversationsQuery = supabaseAdmin
      .from("conversations")
      .select("id, mode, has_unread, created_at")
      .gte("created_at", since)
      .limit(1000);
    conversationsQuery = scopeBranchQuery(conversationsQuery, auth);
    const { data: conversations, error: conversationsError } = await conversationsQuery;
    if (conversationsError) throw conversationsError;

    let contactsQuery = supabaseAdmin
      .from("contacts")
      .select("id, total_orders, last_order_at")
      .gte("last_order_at", since)
      .limit(1000);
    contactsQuery = scopeRestaurantQuery(contactsQuery, auth.session);
    contactsQuery = scopeBranchQuery(contactsQuery, auth, "active_branch_id");
    const { data: contacts, error: contactsError } = await contactsQuery;
    if (contactsError) throw contactsError;

    const orderRows = orders ?? [];
    const deliveredOrders = orderRows.filter((order) => order.status === "delivered");
    const confirmedOrders = orderRows.filter((order) => countsTowardRevenue(String(order.status)));
    const activeOrders = orderRows.filter((order) => ["received", "preparing", "out_for_delivery"].includes(String(order.status)));
    const revenue = confirmedOrderRevenue(orderRows);
    const cancelled = orderRows.filter((order) => order.status === "cancelled").length;

    const typeBreakdown: Record<string, number> = {};
    const statusBreakdown: Record<string, number> = {};
    const hourlyDemand: Record<string, number> = {};
    const topItems = new Map<string, { name: string; qty: number; revenue: number }>();

    for (const order of orderRows) {
      typeBreakdown[String(order.type)] = (typeBreakdown[String(order.type)] ?? 0) + 1;
      statusBreakdown[String(order.status)] = (statusBreakdown[String(order.status)] ?? 0) + 1;
      const hour = getHourKey(String(order.created_at));
      hourlyDemand[hour] = (hourlyDemand[hour] ?? 0) + 1;

      const items = countsTowardRevenue(String(order.status)) && Array.isArray(order.order_items) ? order.order_items : [];
      for (const item of items) {
        const name = String(item.name ?? "").trim();
        if (!name) continue;
        const qty = Number(item.qty ?? 0);
        const revenueForItem = qty * Number(item.price ?? 0);
        const existing = topItems.get(name.toLowerCase()) ?? { name, qty: 0, revenue: 0 };
        existing.qty += Number.isFinite(qty) ? qty : 0;
        existing.revenue += Number.isFinite(revenueForItem) ? revenueForItem : 0;
        topItems.set(name.toLowerCase(), existing);
      }
    }

    const repeatCustomers = (contacts ?? []).filter((contact) => Number(contact.total_orders ?? 0) > 1).length;

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      rangeDays: 30,
      totals: {
        orders: orderRows.length,
        activeOrders: activeOrders.length,
        deliveredOrders: deliveredOrders.length,
        confirmedOrders: confirmedOrders.length,
        cancelledOrders: cancelled,
        revenue,
        conversations: conversations?.length ?? 0,
        unreadConversations: (conversations ?? []).filter((conversation) => conversation.has_unread).length,
        humanConversations: (conversations ?? []).filter((conversation) => conversation.mode === "human").length,
        repeatCustomers,
      },
      typeBreakdown,
      statusBreakdown,
      hourlyDemand: Object.entries(hourlyDemand)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([hour, count]) => ({ hour, count })),
      topItems: [...topItems.values()]
        .sort((left, right) => right.qty - left.qty)
        .slice(0, 10),
    });
  } catch (error) {
    return apiErrorResponse(error, { fallback: "Failed to load analytics.", context: "dashboard analytics GET" });
  }
}
