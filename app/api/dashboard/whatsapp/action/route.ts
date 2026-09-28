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

    if (action === "test_message") {
      if (!recipientPhone) {
        return NextResponse.json({ error: "recipientPhone is required for test_message." }, { status: 400 });
      }

      const digits = recipientPhone.replace(/[^0-9]/g, "");
      const res = await sendWhatsAppMessage(
        digits,
        "👋 Hello from ORDERiQ! Your Meta WhatsApp Cloud API connection with Coexistence is working perfectly."
      );

      return NextResponse.json({
        success: true,
        message: `Test message sent to ${digits}! Message ID: ${res.messageId || "sent"}`,
        data: res,
      });
    }

    if (action === "disconnect") {
      await supabaseAdmin
        .from("restaurant_profiles")
        .update({ whatsapp_provider: "none", updated_at: new Date().toISOString() })
        .eq("id", "default");

      return NextResponse.json({
        success: true,
        message: "WhatsApp provider disabled.",
      });
    }

    if (action === "reconnect") {
      await supabaseAdmin
        .from("restaurant_profiles")
        .update({ whatsapp_provider: "meta", updated_at: new Date().toISOString() })
        .eq("id", "default");

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
