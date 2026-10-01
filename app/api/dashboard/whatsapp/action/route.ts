import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/branch-request";
import { apiErrorResponse, readLimitedJsonBody } from "@/lib/api-utils";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type WhatsAppActionBody = {
  action: "test_message" | "disconnect" | "reconnect";
  recipientPhone?: string;
};

export async function POST(req: NextRequest) {
  const auth = await requireApiSession();
  if (auth.response) {
    return auth.response;
  }

  try {
    const body = await readLimitedJsonBody<WhatsAppActionBody>(req, 16 * 1024);
    const { action, recipientPhone } = body;

    if (!action) {
      return NextResponse.json({ error: "Action is required." }, { status: 400 });
    }

    const targetRestaurantId =
      auth.session.restaurantId || new URL(req.url).searchParams.get("restaurant_id");

    if (action === "test_message") {
      if (!recipientPhone) {
        return NextResponse.json({ error: "recipientPhone is required for test_message." }, { status: 400 });
      }

      const digits = recipientPhone.replace(/[^0-9]/g, "");

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
        token
      );

      return NextResponse.json({
        success: true,
        message: `Test message sent to +${digits}! Message ID: ${res.messageId || "sent"}`,
        data: res,
      });
    }

    if (action === "disconnect") {
      if (targetRestaurantId) {
        await supabaseAdmin
          .from("whatsapp_configs")
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq("restaurant_id", targetRestaurantId);
      }

      return NextResponse.json({
        success: true,
        message: "WhatsApp provider disabled.",
      });
    }

    if (action === "reconnect") {
      if (targetRestaurantId) {
        await supabaseAdmin
          .from("whatsapp_configs")
          .update({ is_active: true, updated_at: new Date().toISOString() })
          .eq("restaurant_id", targetRestaurantId);
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
