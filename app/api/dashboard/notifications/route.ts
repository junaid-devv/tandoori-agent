import { NextRequest, NextResponse } from "next/server";
import { resolveRequestBranch } from "@/lib/branch-request";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { apiErrorResponse } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await resolveRequestBranch(req, { allowAllForAdmin: true });
  if (auth.response) {
    return auth.response;
  }

  const { searchParams } = new URL(req.url);
  const sinceOrder = searchParams.get("since_order_at");
  const branchId = auth.branchId;

  try {
    // 1. Fetch unread conversations
    let convQuery = supabaseAdmin
      .from("conversations")
      .select("id, phone, name, has_unread, updated_at, messages(content, created_at)")
      .eq("has_unread", true)
      .order("updated_at", { ascending: false })
      .limit(20);

    if (branchId) {
      convQuery = convQuery.eq("branch_id", branchId);
    }

    // 2. Fetch latest new/active orders (received status)
    let ordersQuery = supabaseAdmin
      .from("orders")
      .select("id, order_number, type, status, total, created_at, conversations(phone, name)")
      .in("status", ["received", "preparing"])
      .order("created_at", { ascending: false })
      .limit(10);

    if (branchId) {
      ordersQuery = ordersQuery.eq("branch_id", branchId);
    }

    const [convRes, ordersRes] = await Promise.all([convQuery, ordersQuery]);

    const unreadConversations = convRes.data || [];
    const activeOrders = ordersRes.data || [];

    // Format latest unread message
    let latestMessage: { id: string; from: string; content: string; time: string } | null = null;
    if (unreadConversations.length > 0) {
      const topConv = unreadConversations[0];
      const msg = Array.isArray(topConv.messages) && topConv.messages.length > 0
        ? (topConv.messages[0] as { content?: string; created_at?: string })
        : null;
      latestMessage = {
        id: topConv.id,
        from: topConv.name || topConv.phone,
        content: msg?.content || "New WhatsApp message",
        time: topConv.updated_at,
      };
    }

    // Format latest order
    let latestOrder: { id: string; orderNumber: number; type: string; total: number; customer: string; time: string } | null = null;
    if (activeOrders.length > 0) {
      const topOrder = activeOrders[0];
      const conv = topOrder.conversations as unknown as { phone?: string; name?: string } | null;
      latestOrder = {
        id: topOrder.id,
        orderNumber: Number(topOrder.order_number),
        type: topOrder.type,
        total: Number(topOrder.total),
        customer: conv?.name || conv?.phone || "Customer",
        time: topOrder.created_at,
      };
    }

    return NextResponse.json({
      unreadMessagesCount: unreadConversations.length,
      latestMessage,
      activeOrdersCount: activeOrders.length,
      latestOrder,
      serverTime: new Date().toISOString(),
    });
  } catch (err: unknown) {
    return apiErrorResponse(err, {
      fallback: "Failed to fetch notification metrics",
      context: "dashboard notifications GET",
    });
  }
}
