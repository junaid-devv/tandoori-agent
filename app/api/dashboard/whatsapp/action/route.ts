import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/branch-request";
import { apiErrorResponse, readLimitedJsonBody } from "@/lib/api-utils";
import { sendWhatsAppMessage, sendWaAkgMessage, isWaAkgProvider } from "@/lib/whatsapp";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { performWaAkgAction } from "@/lib/wa-akg-client";
import { getRestaurantProfile } from "@/lib/restaurant-profile";

export const dynamic = "force-dynamic";

type WhatsAppActionBody = {
  action:
    | "test_message"
    | "disconnect"
    | "reconnect"
    | "switch_provider"
    | "start"
    | "stop"
    | "restart"
    | "logout"
    | "pair"
    | "create_session"
    | "auto_webhook";
  provider?: "meta" | "wa_akg" | "none";
  recipientPhone?: string;
  phoneNumber?: string;
  webhookUrl?: string;
};

export async function POST(req: NextRequest) {
  const auth = await requireApiSession();
  if (auth.response) {
    return auth.response;
  }

  try {
    const body = await readLimitedJsonBody<WhatsAppActionBody>(req, 32 * 1024);
    const { action, provider, recipientPhone, phoneNumber, webhookUrl } = body;

    if (!action) {
      return NextResponse.json({ error: "Action is required." }, { status: 400 });
    }

    const targetRestaurantId =
      auth.session.restaurantId || new URL(req.url).searchParams.get("restaurant_id");

    // 1. Switch Provider (Meta <-> WA-AKG <-> None)
    if (action === "switch_provider") {
      if (!provider || !["meta", "wa_akg", "none"].includes(provider)) {
        return NextResponse.json({ error: "Invalid provider. Must be meta, wa_akg, or none." }, { status: 400 });
      }

      if (targetRestaurantId) {
        await supabaseAdmin
          .from("restaurant_profiles")
          .update({
            whatsapp_provider: provider,
            updated_at: new Date().toISOString(),
          })
          .eq("id", targetRestaurantId);
      }

      return NextResponse.json({
        success: true,
        message: `Active provider set to ${provider.toUpperCase()}`,
        provider,
      });
    }

    // 2. WA-AKG Baileys Gateway Actions
    const waAkgActions = ["start", "stop", "restart", "logout", "pair", "create_session", "auto_webhook"] as const;
    if (waAkgActions.includes(action as (typeof waAkgActions)[number])) {
      const result = await performWaAkgAction(
        action as "start" | "stop" | "restart" | "logout" | "pair" | "create_session" | "auto_webhook",
        { phoneNumber, webhookUrl },
      );

      // If user started or paired session, ensure restaurant_profiles.whatsapp_provider is wa_akg
      if (action === "create_session" || action === "start" || action === "auto_webhook") {
        if (targetRestaurantId) {
          await supabaseAdmin
            .from("restaurant_profiles")
            .update({ whatsapp_provider: "wa_akg", updated_at: new Date().toISOString() })
            .eq("id", targetRestaurantId);
        }
      }

      return NextResponse.json(result);
    }

    // 3. Test Live Messaging
    if (action === "test_message") {
      if (!recipientPhone) {
        return NextResponse.json({ error: "recipientPhone is required for test_message." }, { status: 400 });
      }

      const digits = recipientPhone.replace(/[^0-9]/g, "");
      const profile = await getRestaurantProfile(targetRestaurantId ?? undefined);

      if (profile.whatsapp_provider === "wa_akg" || isWaAkgProvider()) {
        const res = await sendWaAkgMessage(
          digits,
          "👋 Hello from ORDERiQ! Your WA-AKG (Baileys) WhatsApp connection is active and working perfectly.",
        );
        return NextResponse.json({
          success: true,
          message: `Test message sent via WA-AKG to +${digits}! Message ID: ${res.messageId || "sent"}`,
          data: res,
        });
      }

      // Meta Cloud API test
      let phoneId: string | undefined;
      let token: string | undefined;

      if (targetRestaurantId) {
        const { data: config } = await supabaseAdmin
          .from("whatsapp_configs")
          .select("phone_number_id, access_token")
          .eq("restaurant_id", targetRestaurantId)
          .eq("is_active", true)
          .order("updated_at", { ascending: false })
          .maybeSingle();

        if (config?.phone_number_id) {
          phoneId = config.phone_number_id;
        }
        if (config?.access_token) {
          token = config.access_token;
        }
      }

      const res = await sendWhatsAppMessage(
        digits,
        "👋 Hello from ORDERiQ! Your Meta WhatsApp Cloud API connection with Coexistence is working perfectly.",
        phoneId,
        token,
      );

      return NextResponse.json({
        success: true,
        message: `Test message sent via Meta Cloud API to +${digits}! Message ID: ${res.messageId || "sent"}`,
        data: res,
      });
    }

    // 4. Disconnect Meta Cloud API
    if (action === "disconnect") {
      if (targetRestaurantId) {
        await Promise.all([
          supabaseAdmin
            .from("whatsapp_configs")
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq("restaurant_id", targetRestaurantId),
          supabaseAdmin
            .from("restaurant_profiles")
            .update({ whatsapp_provider: "none", updated_at: new Date().toISOString() })
            .eq("id", targetRestaurantId),
        ]);
      }

      return NextResponse.json({
        success: true,
        message: "WhatsApp provider disabled.",
      });
    }

    // 5. Reconnect Meta Cloud API
    if (action === "reconnect") {
      if (targetRestaurantId) {
        await Promise.all([
          supabaseAdmin
            .from("whatsapp_configs")
            .update({ is_active: true, updated_at: new Date().toISOString() })
            .eq("restaurant_id", targetRestaurantId),
          supabaseAdmin
            .from("restaurant_profiles")
            .update({ whatsapp_provider: "meta", updated_at: new Date().toISOString() })
            .eq("id", targetRestaurantId),
        ]);
      }

      return NextResponse.json({
        success: true,
        message: "Meta Cloud API provider enabled.",
      });
    }

    return NextResponse.json({ error: `Unsupported action: ${action}` }, { status: 400 });
  } catch (error) {
    return apiErrorResponse(error, {
      fallback: "Failed to execute WhatsApp action.",
      context: "POST /api/dashboard/whatsapp/action",
    });
  }
}
