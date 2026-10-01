import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/branch-request";
import { apiErrorResponse, readLimitedJsonBody } from "@/lib/api-utils";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

interface ConnectWhatsAppBody {
  code?: string;
  wabaId?: string;
  phoneNumberId?: string;
}

export async function POST(req: NextRequest) {
  const auth = await requireApiSession();
  if (auth.response) {
    return auth.response;
  }

  try {
    const body = await readLimitedJsonBody<ConnectWhatsAppBody>(req, 32 * 1024);
    let { code, wabaId, phoneNumberId } = body;

    const appId = process.env.NEXT_PUBLIC_META_APP_ID || process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET || process.env.WHATSAPP_APP_SECRET;

    let accessToken = process.env.WHATSAPP_ACCESS_TOKEN || "";
    let exchangedToken: string | null = null;

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

        if (tokenRes.ok && tokenData.access_token) {
          exchangedToken = tokenData.access_token;
          accessToken = tokenData.access_token;
        } else {
          console.error("[whatsapp-connect] Token exchange failed:", tokenData);
          // If code exchange failed but we have a system token, continue with system token
          if (!accessToken) {
            throw new Error(tokenData.error?.message || "Failed to exchange authorization code for access token.");
          }
        }
      }
    }

    if (!accessToken) {
      throw new Error("No access token available. Please provide an authorization code or configure WHATSAPP_ACCESS_TOKEN.");
    }

    // 2) If wabaId is missing, auto-discover it via debug_token inspect using granular_scopes
    if (!wabaId && appId && appSecret) {
      try {
        const tokenToInspect = exchangedToken || accessToken;
        const debugUrl = new URL("https://graph.facebook.com/v22.0/debug_token");
        debugUrl.searchParams.set("input_token", tokenToInspect);
        debugUrl.searchParams.set("access_token", `${appId}|${appSecret}`);

        const debugRes = await fetch(debugUrl.toString());
        if (debugRes.ok) {
          const debugData = await debugRes.json();
          const granularScopes = (debugData?.data?.granular_scopes as Array<{ scope: string; target_ids?: string[] }>) || [];
          const wabaScope = granularScopes.find(
            (s) => s.scope === "whatsapp_business_management" || s.scope === "whatsapp_business_messaging"
          );
          if (wabaScope?.target_ids?.length) {
            wabaId = wabaScope.target_ids[0];
            console.log("[whatsapp-connect] Auto-discovered wabaId from debug_token:", wabaId);
          }
        }
      } catch (debugErr) {
        console.warn("[whatsapp-connect] Could not inspect debug_token:", debugErr);
      }
    }

    // 3) Fallback discovery for wabaId via /me/whatsapp_business_accounts
    if (!wabaId) {
      try {
        const meRes = await fetch(
          `https://graph.facebook.com/v22.0/me?fields=whatsapp_business_accounts&access_token=${encodeURIComponent(accessToken)}`
        );
        if (meRes.ok) {
          const meData = await meRes.json();
          const accounts = meData?.whatsapp_business_accounts?.data;
          if (Array.isArray(accounts) && accounts.length > 0) {
            wabaId = accounts[0].id;
            console.log("[whatsapp-connect] Auto-discovered wabaId from /me:", wabaId);
          }
        }
      } catch (meErr) {
        console.warn("[whatsapp-connect] Could not inspect /me/whatsapp_business_accounts:", meErr);
      }
    }

    let verifiedName: string | null = null;
    let displayPhoneNumber: string | null = null;

    // 4) If phoneNumberId is missing and we have wabaId, auto-discover phone number via /wabaId/phone_numbers
    if (wabaId && !phoneNumberId) {
      try {
        const phoneListRes = await fetch(
          `https://graph.facebook.com/v22.0/${encodeURIComponent(wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (phoneListRes.ok) {
          const phoneListData = await phoneListRes.json();
          const phoneItem = phoneListData?.data?.[0];
          if (phoneItem?.id) {
            phoneNumberId = phoneItem.id;
            displayPhoneNumber = phoneItem.display_phone_number || null;
            verifiedName = phoneItem.verified_name || null;
            console.log("[whatsapp-connect] Auto-discovered phoneNumberId:", phoneNumberId, "displayPhone:", displayPhoneNumber);
          }
        }
      } catch (phoneListErr) {
        console.warn("[whatsapp-connect] Could not fetch phone numbers for WABA:", phoneListErr);
      }
    }

    // Validate that we resolved both wabaId and phoneNumberId
    if (!wabaId || !phoneNumberId) {
      return NextResponse.json(
        {
          error:
            "Could not automatically detect your WhatsApp Business Account or Phone Number. Please ensure you selected a phone number during signup, or enter the credentials manually below.",
        },
        { status: 400 }
      );
    }

    // 5) Fetch phone details if not already fetched
    if (!displayPhoneNumber || !verifiedName) {
      try {
        const phoneRes = await fetch(
          `https://graph.facebook.com/v22.0/${encodeURIComponent(phoneNumberId)}?fields=id,display_phone_number,verified_name`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );
        if (phoneRes.ok) {
          const phoneData = await phoneRes.json();
          if (!verifiedName) verifiedName = phoneData.verified_name || null;
          if (!displayPhoneNumber) displayPhoneNumber = phoneData.display_phone_number || null;
        }
      } catch (e) {
        console.warn("[whatsapp-connect] Could not fetch phone details:", e);
      }
    }

    // 6) Automatically subscribe our webhook to the business's WABA
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

    let targetRestaurantId =
      auth.session.restaurantId || new URL(req.url).searchParams.get("restaurant_id");

    if (!targetRestaurantId) {
      const { data: firstRest } = await supabaseAdmin
        .from("restaurant_profiles")
        .select("id")
        .limit(1)
        .maybeSingle();
      targetRestaurantId = firstRest?.id;
    }

    if (!targetRestaurantId) {
      return NextResponse.json(
        { error: "No restaurant context found. Please specify a restaurant." },
        { status: 400 },
      );
    }

    // 7) Update restaurant profile to enable Meta Cloud API
    await supabaseAdmin
      .from("restaurant_profiles")
      .update({
        whatsapp_provider: "meta",
        updated_at: new Date().toISOString(),
      })
      .eq("id", targetRestaurantId);

    // 8) Upsert into whatsapp_configs mapping phone_number_id to restaurant
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
