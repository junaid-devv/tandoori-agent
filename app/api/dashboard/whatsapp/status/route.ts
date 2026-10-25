import { getActiveWhatsAppProvider } from "@/lib/whatsapp-context";
import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/branch-request";
import { apiErrorResponse } from "@/lib/api-utils";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getEvolutionFullStatus } from "@/lib/evolution-client";
import { whatsappRestaurantId } from "@/lib/whatsapp-request";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireApiSession();
  if (auth.response) {
    return auth.response;
  }

  try {
    const targetRestaurantId = whatsappRestaurantId(req, auth.session);
    const activeProvider = await getActiveWhatsAppProvider(targetRestaurantId);

    const { data: config, error: configError } = targetRestaurantId
      ? await supabaseAdmin
          .from("whatsapp_configs")
          .select("*")
          .eq("restaurant_id", targetRestaurantId)
          .eq("is_active", true)
          .order("updated_at", { ascending: false }).limit(1)
          .maybeSingle()
      : { data: null, error: null };
    if (configError) throw configError;

    // In a multi-tenant setup, only consider configured if there is an active DB record
    const phoneId = config?.phone_number_id || null;
    const token = config?.access_token || "";
    const wabaId = config?.waba_id || null;
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
    let coexistenceEnabled = false;
    let status: string = isMetaConfigured ? "CONNECTED" : "NOT_CONFIGURED";

    // Optionally probe Meta Graph API to verify live token and phone status
    if (isMetaConfigured && phoneId) {
      try {
        const metaRes = await fetch(
          `https://graph.facebook.com/v22.0/${encodeURIComponent(phoneId)}?fields=verified_name,display_phone_number,quality_rating,platform_type,is_on_biz_app`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
            signal: AbortSignal.timeout(8_000),
          }
        );
        if (metaRes.ok) {
          const metaData = await metaRes.json();
          displayPhoneNumber = metaData.display_phone_number || null;
          verifiedName = metaData.verified_name || null;
          qualityRating = metaData.quality_rating || null;
          status = metaData.platform_type === "CLOUD_API" ? "CONNECTED" : "REGISTRATION_REQUIRED";
          coexistenceEnabled = metaData.is_on_biz_app === true;
        } else {
          status = "AUTH_ERROR";
        }
      } catch {
        status = "UNREACHABLE"; // Cannot confirm token health
      }
    }

    const evolutionStatus = await getEvolutionFullStatus(targetRestaurantId);

    return NextResponse.json({
      activeProvider,
      whatsappEnabled: activeProvider !== "none",
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
        coexistenceEnabled,
      },
      evolution: evolutionStatus,
    });
  } catch (error) {
    return apiErrorResponse(error, {
      fallback: "Failed to retrieve WhatsApp status.",
      context: "GET /api/dashboard/whatsapp/status",
    });
  }
}
