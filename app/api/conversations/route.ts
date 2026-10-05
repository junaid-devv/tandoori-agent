import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-utils";
import { resolveRequestBranch } from "@/lib/branch-request";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getRestaurantProfile } from "@/lib/restaurant-profile";

export async function GET(req: NextRequest) {
  const auth = await resolveRequestBranch(req, { allowAllForAdmin: true });
  if (auth.response) {
    return auth.response;
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(Number.parseInt(searchParams.get("limit") ?? "40", 10) || 40, 1), 100);
  const offset = Math.max(Number.parseInt(searchParams.get("offset") ?? "0", 10) || 0, 0);
  const unreadOnly = searchParams.get("unread_only") === "1";
  const lite = searchParams.get("lite") === "1";

  // Resolve active connected WhatsApp number to auto-switch inbox
  const profile = await getRestaurantProfile().catch(() => null);
  const activeProvider = profile?.whatsapp_provider || (process.env.WA_AKG_BASE_URL ? "wa_akg" : "meta");
  let activeBusinessPhone: string | null = null;
  if (activeProvider === "wa_akg") {
    activeBusinessPhone = (profile?.support_phone || "923155160301").replace(/[^0-9]/g, "");
  } else if (activeProvider === "meta") {
    activeBusinessPhone = "923355488186";
  }

  const requestedPhone = searchParams.get("whatsapp_phone");
  const filterPhone = requestedPhone === "all" ? null : (requestedPhone || activeBusinessPhone);

  if (lite) {
    let query = supabaseAdmin.from("conversations").select(`
      id,
      branch_id,
      phone,
      name,
      mode,
      has_unread,
      whatsapp_phone,
      updated_at,
      created_at,
      contacts (
        id,
        preferred_language,
        tags,
        notes,
        total_orders,
        last_order_at
      ),
      messages (
        content,
        created_at
      )
    `);

    query = query.order("updated_at", { ascending: false });
    if (auth.branchId) {
      query = query.eq("branch_id", auth.branchId);
    }
    if (unreadOnly) {
      query = query.eq("has_unread", true);
    }
    if (filterPhone) {
      query = query.eq("whatsapp_phone", filterPhone);
    }
    if (activeBusinessPhone) {
      // Never show the business's own phone as a customer conversation
      query = query.neq("phone", activeBusinessPhone);
    }

    const { data, error } = await query
      .order("created_at", { ascending: false, foreignTable: "messages" })
      .limit(1, { foreignTable: "messages" })
      .range(offset, offset + limit - 1);

    if (error) {
      return apiErrorResponse(error, { fallback: "Failed to load conversations.", context: "conversations GET lite" });
    }

    const normalized = (data ?? []).map((conv: any) => {
      const lastMsgAt = conv.messages?.[0]?.created_at || conv.created_at;
      return {
        ...conv,
        last_message_at: lastMsgAt,
      };
    }).sort((a: any, b: any) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());

    return NextResponse.json(normalized);
  }

  let query = supabaseAdmin.from("conversations").select(`
      id,
      branch_id,
      phone,
      name,
      mode,
      has_unread,
      whatsapp_phone,
      updated_at,
      created_at,
      branches (id, name, slug, address),
      contacts (
        id,
        preferred_language,
        tags,
        notes,
        total_orders,
        last_order_at
      ),
      conversation_states (
        stage,
        order_type,
        address,
        guests,
        reservation_time,
        pickup_time,
        cart,
        last_error,
        is_bot_active,
        invalid_step_count,
        escalation_reason,
        escalated_at
      ),
      messages (
        content,
        role,
        sender_kind,
        delivery_status,
        created_at
      )
    `);
  query = query.order("updated_at", { ascending: false });

  if (auth.branchId) {
    query = query.eq("branch_id", auth.branchId);
  }
  if (unreadOnly) {
    query = query.eq("has_unread", true);
  }
  if (filterPhone) {
    query = query.eq("whatsapp_phone", filterPhone);
  }
  if (activeBusinessPhone) {
    query = query.neq("phone", activeBusinessPhone);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false, foreignTable: "messages" })
    .limit(1, { foreignTable: "messages" })
    .range(offset, offset + limit - 1);

  if (error) {
    return apiErrorResponse(error, { fallback: "Failed to load conversations.", context: "conversations GET" });
  }

  const normalized = (data ?? []).map((conv: any) => {
    const lastMsgAt = conv.messages?.[0]?.created_at || conv.created_at;
    return {
      ...conv,
      last_message_at: lastMsgAt,
    };
  }).sort((a: any, b: any) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());

  return NextResponse.json(normalized);
}
