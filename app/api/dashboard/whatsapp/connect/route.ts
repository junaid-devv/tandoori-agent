import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/branch-request";
import { apiErrorResponse, readLimitedJsonBody } from "@/lib/api-utils";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

interface ConnectWhatsAppBody {
  code?: string;
  wabaId: string;
  phoneNumberId: string;
}

export async function POST(req: NextRequest) {
  const auth = await requireApiSession();
  if (auth.response) {
    return auth.response;
  }

  try {
    const body = await readLimitedJsonBody<ConnectWhatsAppBody>(req, 32 * 1024);
    const { code, wabaId, phoneNumberId } = body;

    if (!wabaId || !phoneNumberId) {
      return NextResponse.json(
        { error: "wabaId and phoneNumberId are required." },
        { status: 400 }
      );
    }

    const appId = process.env.NEXT_PUBLIC_META_APP_ID || process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET || process.env.WHATSAPP_APP_SECRET;

    let accessToken = process.env.WHATSAPP_ACCESS_TOKEN || "";

    // 1) If an OAuth authorization code was provided by Embedded Signup, exchange it for an Access Token
    if (code) {
      if (!appId || !appSecret) {
        console.warn("[whatsapp-connect] Missing META_APP_ID or META_APP_SECRET for code exchange. Falling back to configured access token.");
      } else {
        const tokenUrl = new URL("https://graph.facebook.com/v22.0/oauth/access_token");
        tokenUrl.searchParams.set("client_id", appId);
        tokenUrl.searchParams.set("client_secret", appSecret);
        tokenUrl.searchParams.set("code", code);

        const tokenRes = await fetch(tokenUrl.toString(), { method: "GET" });
        const tokenData = await tokenRes.json();

        if (!tokenRes.ok || !tokenData.access_token) {
          console.error("[whatsapp-connect] Token exchange failed:", tokenData);
          throw new Error(tokenData.error?.message || "Failed to exchange authorization code for access token.");
        }

        accessToken = tokenData.access_token;
      }
    }

    if (!accessToken) {
      throw new Error("No access token available. Please provide an authorization code or configure WHATSAPP_ACCESS_TOKEN.");
    }

    // 2) Automatically subscribe our webhook to the business's WABA
    const subscribeRes = await fetch(`https://graph.facebook.com/v22.0/${encodeURIComponent(wabaId)}/subscribed_apps`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    const subscribeData = await subscribeRes.json();
    if (!subscribeRes.ok || !subscribeData.success) {
      console.warn("[whatsapp-connect] Webhook auto-subscription warning:", subscribeData);
    }

    // 3) Fetch phone number details from Graph API to verify display name and status
    let verifiedName: string | null = null;
    let displayPhoneNumber: string | null = null;
    try {
      const phoneRes = await fetch(`https://graph.facebook.com/v22.0/${encodeURIComponent(phoneNumberId)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (phoneRes.ok) {
        const phoneData = await phoneRes.json();
        verifiedName = phoneData.verified_name || null;
        displayPhoneNumber = phoneData.display_phone_number || null;
      }
    } catch (e) {
      console.warn("[whatsapp-connect] Could not fetch phone details:", e);
    }

    const targetRestaurantId =
      auth.session.restaurantId || new URL(req.url).searchParams.get("restaurant_id");

    if (!targetRestaurantId) {
      return NextResponse.json(
        { error: "No restaurant context found. Please specify a restaurant." },
        { status: 400 },
      );
    }

    // 4) Update restaurant profile to enable Meta Cloud API
    await supabaseAdmin
      .from("restaurant_profiles")
      .update({
        whatsapp_provider: "meta",
        updated_at: new Date().toISOString(),
      })
      .eq("id", targetRestaurantId);

    // 5) Upsert into whatsapp_configs mapping phone_number_id to restaurant
    await supabaseAdmin
      .from("whatsapp_configs")
      .upsert(
        {
          phone_number_id: phoneNumberId,
          restaurant_id: targetRestaurantId,
          waba_id: wabaId,
          display_phone_number: displayPhoneNumber,
          verified_name: verifiedName,
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "phone_number_id" },
      );

    return NextResponse.json({
      success: true,
      message: "WhatsApp Business Account connected and subscribed successfully! 🎉",
      data: {
        wabaId,
        phoneNumberId,
        displayPhoneNumber,
        verifiedName,
        webhookSubscribed: Boolean(subscribeData?.success),
        coexistenceEnabled: true,
      },
    });
  } catch (error) {
    return apiErrorResponse(error, {
      fallback: "Failed to connect WhatsApp account.",
      context: "POST /api/dashboard/whatsapp/connect",
    });
  }
}
