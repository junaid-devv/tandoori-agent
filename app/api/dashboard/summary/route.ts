import { scopeBranchQuery } from "@/lib/tenant-scope";
import type { DashboardSession } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-utils";
import { resolveRequestBranch } from "@/lib/branch-request";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { confirmedOrderRevenue, REVENUE_ORDER_STATUSES } from "@/lib/order-revenue";

const ACTIVE_STATUSES = ["received", "preparing", "out_for_delivery"] as const;
const ALL_STATUSES = ["received", "preparing", "out_for_delivery", "delivered", "cancelled"] as const;

function getUtcRangeStart(daysAgo = 0): string {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  if (daysAgo > 0) {
    utc.setUTCDate(utc.getUTCDate() - daysAgo);
  }
  return utc.toISOString();
}

async function countRows(table: "orders" | "conversations", options: {
  branchId: string | null;
  session: DashboardSession | null;
  statuses?: readonly string[];
  status?: string;
  gteCreatedAt?: string;
}) {
  let query = supabaseAdmin.from(table).select("id", { count: "exact", head: true });
  query = scopeBranchQuery(query, options);
  if (options.statuses && options.statuses.length > 0) {
    query = query.in("status", [...options.statuses]);
  }
  if (options.status) {
    query = query.eq("status", options.status);
  }
  if (options.gteCreatedAt) {
    query = query.gte("created_at", options.gteCreatedAt);
  }

  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

export async function GET(req: NextRequest) {
  const auth = await resolveRequestBranch(req, { allowAllForAdmin: true });
  if (auth.response) {
    return auth.response;
  }

  try {
    const todayStartIso = getUtcRangeStart(0);
    const thirtyDaysStartIso = getUtcRangeStart(30);

    const [
      active,
      today,
      chats,
      received,
      preparing,
      outForDelivery,
      delivered,
      cancelled,
      revenueRows,
      recentOrdersRes,
    ] = await Promise.all([
      countRows("orders", { session: auth.session, branchId: auth.branchId, statuses: ACTIVE_STATUSES }),
      countRows("orders", { session: auth.session, branchId: auth.branchId, gteCreatedAt: todayStartIso }),
      countRows("conversations", { session: auth.session, branchId: auth.branchId }),
      countRows("orders", { session: auth.session, branchId: auth.branchId, status: "received" }),
      countRows("orders", { session: auth.session, branchId: auth.branchId, status: "preparing" }),
      countRows("orders", { session: auth.session, branchId: auth.branchId, status: "out_for_delivery" }),
      countRows("orders", { session: auth.session, branchId: auth.branchId, status: "delivered" }),
      countRows("orders", { session: auth.session, branchId: auth.branchId, status: "cancelled" }),
      (async () => {
        const rows = [];
        for (let offset = 0; ; offset += 1000) {
          let query = supabaseAdmin
          .from("orders")
          .select("status, subtotal, delivery_fee, total")
          .in("status", [...REVENUE_ORDER_STATUSES])
          .gte("created_at", thirtyDaysStartIso)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(offset, offset + 999);
          query = scopeBranchQuery(query, auth);
          const { data, error } = await query;
          if (error) throw error;
          rows.push(...(data ?? []));
          if (!data || data.length < 1000) return rows;
        }
      })(),
      (() => {
        let query = supabaseAdmin
          .from("orders")
          .select(`
            id,
            order_number,
            status,
            type,
            subtotal,
            created_at,
            branches (name),
            conversations (name)
          `)
          .order("created_at", { ascending: false })
          .limit(8);
        query = scopeBranchQuery(query, auth);
        return query;
      })(),
    ]);

    if (recentOrdersRes.error) throw recentOrdersRes.error;

    const revenue = confirmedOrderRevenue(revenueRows);
    const breakdown: Record<string, number> = {
      received,
      preparing,
      out_for_delivery: outForDelivery,
      delivered,
      cancelled,
    };

    return NextResponse.json({
      active,
      today,
      revenue,
      chats,
      breakdown,
      recentOrders: recentOrdersRes.data ?? [],
      statusKeys: ALL_STATUSES,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return apiErrorResponse(error, { fallback: "Failed to load dashboard summary.", context: "dashboard summary GET" });
  }
}
