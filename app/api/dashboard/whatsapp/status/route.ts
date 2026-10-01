import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/branch-request";
import { apiErrorResponse } from "@/lib/api-utils";
import { getRestaurantProfile } from "@/lib/restaurant-profile";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireApiSession();
  if (auth.response) {
    return auth.response;
  }

  try {
    const profile = await getRestaurantProfile(auth.session.restaurantId ?? undefined);
    
    const targetRestaurantId =
      auth.session.restaurantId || new URL(req.url).searchParams.get("restaurant_id");

    const { data: config } = targetRestaurantId
      ? await supabaseAdmin
          .from("whatsapp_configs")
          .select("*")
          .eq("restaurant_id", targetRestaurantId)
          .maybeSingle()
      : { data: null };

    const phoneId = config?.phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID || null;
    const token = process.env.WHATSAPP_ACCESS_TOKEN || "";
    const wabaId = config?.waba_id || process.env.WHATSAPP_WABA_ID || null;
    const appId = process.env.NEXT_PUBLIC_META_APP_ID || process.env.META_APP_ID || null;
    const configId = process.env.NEXT_PUBLIC_WHATSAPP_CONFIG_ID || process.env.WHATSAPP_CONFIG_ID || null;

    const isMetaConfigured = Boolean(
      phoneId &&
      token &&
      token.length > 20
    );

    let displayPhoneNumber: string | null = null;
    let verifiedName: string | null = null;
    let qualityRating: string | null = null;
    let status: string = isMetaConfigured ? "CONNECTED" : "NOT_CONFIGURED";

    // Optionally probe Meta Graph API to verify live token and phone status
    if (isMetaConfigured && phoneId) {
      try {
        const metaRes = await fetch(
          `https://graph.facebook.com/v22.0/${encodeURIComponent(phoneId)}?fields=verified_name,display_phone_number,quality_rating,code_verification_status`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          }
        );
        if (metaRes.ok) {
          const metaData = await metaRes.json();
          displayPhoneNumber = metaData.display_phone_number || null;
          verifiedName = metaData.verified_name || null;
          qualityRating = metaData.quality_rating || null;
          status = "CONNECTED";
        } else {
          status = "AUTH_ERROR";
        }
      } catch {
        // Network timeout / offline
      }
    }

    return NextResponse.json({
      activeProvider: "meta",
      whatsappEnabled: profile.whatsapp_provider !== "none",
      metaConfig: {
        configured: isMetaConfigured,
        status,
        phoneNumberId: phoneId,
        wabaId,
        appId,
        configId,
        displayPhoneNumber: displayPhoneNumber || config?.display_phone_number || null,
        verifiedName: verifiedName || config?.verified_name || null,
        qualityRating,
        verifyTokenSet: Boolean(process.env.WHATSAPP_VERIFY_TOKEN),
        coexistenceEnabled: true,
      },
    });
  } catch (error) {
    return apiErrorResponse(error, {
      fallback: "Failed to retrieve WhatsApp status.",
      context: "GET /api/dashboard/whatsapp/status",
    });
  }
}
