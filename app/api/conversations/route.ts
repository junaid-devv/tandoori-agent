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
    const { data: metaConfig } = await supabaseAdmin
      .from("whatsapp_configs")
      .select("display_phone_number")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    activeBusinessPhone = (metaConfig?.display_phone_number || profile?.support_phone || "923355488186").replace(/[^0-9]/g, "");
  }

  const requestedPhone = searchParams.get("whatsapp_phone");
  const filterPhone = requestedPhone === "all" ? null : (requestedPhone || activeBusinessPhone);

  const buildLiteQuery = (targetPhone: string | null) => {
    let q = supabaseAdmin.from("conversations").select(`
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

    q = q.order("updated_at", { ascending: false });
    if (auth.branchId) {
      q = q.eq("branch_id", auth.branchId);
    }
    if (unreadOnly) {
      q = q.eq("has_unread", true);
    }
    if (targetPhone) {
      q = q.eq("whatsapp_phone", targetPhone);
    }
    return q
      .order("created_at", { ascending: false, foreignTable: "messages" })
      .limit(1, { foreignTable: "messages" })
      .range(offset, offset + limit - 1);
  };

  if (lite) {
    let { data, error } = await buildLiteQuery(filterPhone);

    // If default auto-filter produced no results and no explicit filter was requested,
    // fallback to showing all conversations so the user never sees a broken empty inbox.
    if (!error && (!data || data.length === 0) && !requestedPhone && filterPhone) {
      const fallback = await buildLiteQuery(null);
      if (!fallback.error && fallback.data && fallback.data.length > 0) {
        data = fallback.data;
      }
    }

    if (error) {
      return apiErrorResponse(error, { fallback: "Failed to load conversations.", context: "conversations GET lite" });
    }

    const normalized = (data ?? []).map((conv: any) => {
      const lastMsgAt = conv.messages?.[0]?.created_at || conv.created_at;
      const isSelfTest = Boolean(activeBusinessPhone && conv.phone === activeBusinessPhone);
      return {
        ...conv,
        last_message_at: lastMsgAt,
        is_self_test: isSelfTest,
      };
    }).sort((a: any, b: any) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());

    return NextResponse.json(normalized);
  }

  const buildFullQuery = (targetPhone: string | null) => {
    let q = supabaseAdmin.from("conversations").select(`
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
    q = q.order("updated_at", { ascending: false });

    if (auth.branchId) {
      q = q.eq("branch_id", auth.branchId);
    }
    if (unreadOnly) {
      q = q.eq("has_unread", true);
    }
    if (targetPhone) {
      q = q.eq("whatsapp_phone", targetPhone);
    }

    return q
      .order("created_at", { ascending: false, foreignTable: "messages" })
      .limit(1, { foreignTable: "messages" })
      .range(offset, offset + limit - 1);
  };

  let { data, error } = await buildFullQuery(filterPhone);

  if (!error && (!data || data.length === 0) && !requestedPhone && filterPhone) {
    const fallback = await buildFullQuery(null);
    if (!fallback.error && fallback.data && fallback.data.length > 0) {
      data = fallback.data;
    }
  }

  if (error) {
    return apiErrorResponse(error, { fallback: "Failed to load conversations.", context: "conversations GET" });
  }

  const normalized = (data ?? []).map((conv: any) => {
    const lastMsgAt = conv.messages?.[0]?.created_at || conv.created_at;
    const isSelfTest = Boolean(activeBusinessPhone && conv.phone === activeBusinessPhone);
    return {
      ...conv,
      last_message_at: lastMsgAt,
      is_self_test: isSelfTest,
    };
  }).sort((a: any, b: any) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());

  return NextResponse.json(normalized);
}
