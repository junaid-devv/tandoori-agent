import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, readLimitedJsonBody } from "@/lib/api-utils";
import { resolveRequestBranch } from "@/lib/branch-request";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { cache } from "@/lib/core/cache";

const SYSTEM_BODY_LIMIT_BYTES = 4096;

export async function GET(req: NextRequest) {
  try {
    const auth = await resolveRequestBranch(req, { allowAllForAdmin: true });
    if (auth.response) {
      return auth.response;
    }

    const startTime = Date.now();

    // Parallel count queries across core database tables
    const [
      ordersRes,
      conversationsRes,
      messagesRes,
      contactsRes,
      menuItemsRes,
      agentTurnsRes,
      webhookEventsRes,
      staffAlertsRes,
      rateLimitsRes,
    ] = await Promise.all([
      supabaseAdmin.from("orders").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("conversations").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("messages").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("contacts").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("menu_items").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("agent_turns").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("webhook_events").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("staff_alerts").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("rate_limits").select("key", { count: "exact", head: true }),
    ]);

    const pingLatencyMs = Date.now() - startTime;

    // Fetch active unread alerts & pending orders
    const [unreadAlertsRes, activeOrdersRes] = await Promise.all([
      supabaseAdmin.from("staff_alerts").select("id", { count: "exact", head: true }).eq("is_read", false),
      supabaseAdmin.from("orders").select("id", { count: "exact", head: true }).in("status", ["pending", "accepted", "preparing"]),
    ]);

    return NextResponse.json({
      database: {
        status: "healthy",
        ping_latency_ms: pingLatencyMs,
        provider: "Supabase PostgreSQL (Cloud)",
        ssl_enabled: true,
        pooling_enabled: true,
      },
      table_counts: {
        orders: ordersRes.count ?? 0,
        active_orders: activeOrdersRes.count ?? 0,
        conversations: conversationsRes.count ?? 0,
        messages: messagesRes.count ?? 0,
        contacts: contactsRes.count ?? 0,
        menu_items: menuItemsRes.count ?? 0,
        agent_turns: agentTurnsRes.count ?? 0,
        webhook_events: webhookEventsRes.count ?? 0,
        staff_alerts: staffAlertsRes.count ?? 0,
        unread_alerts: unreadAlertsRes.count ?? 0,
        rate_limits: rateLimitsRes.count ?? 0,
      },
      cache: {
        active_entries: (await cache.size?.()) ?? 0,
      },
    });
  } catch (error) {
    return apiErrorResponse(error, { fallback: "Failed to load database system stats", context: "settings/system GET" });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await resolveRequestBranch(req, { allowAllForAdmin: true });
    if (auth.response) {
      return auth.response;
    }

    const body = await readLimitedJsonBody<{ action?: string }>(req, SYSTEM_BODY_LIMIT_BYTES);

    if (body.action === "clear_cache") {
      await cache.clear?.();
      return NextResponse.json({ success: true, message: "In-memory database cache purged successfully." });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    return apiErrorResponse(error, { fallback: "Failed to execute database action", context: "settings/system POST" });
  }
}
