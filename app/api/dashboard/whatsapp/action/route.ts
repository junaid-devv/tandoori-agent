import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/branch-request";
import { apiErrorResponse, readLimitedJsonBody, ApiRequestError } from "@/lib/api-utils";
import { whatsappRestaurantId } from "@/lib/whatsapp-request";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { performEvolutionAction, getEvolutionConfig, type EvolutionAction } from "@/lib/evolution-client";
import { getRestaurantProfile } from "@/lib/restaurant-profile";
import { invalidateRestaurantCaches } from "@/lib/restaurant-resolver";
import { invalidateCache } from "@/lib/cache";
import { withWhatsAppTransport, type WhatsAppTransport } from "@/lib/whatsapp-context";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireApiSession();
  if (auth.response) return auth.response;
  try {
    const restaurantId = whatsappRestaurantId(req, auth.session, true);
    const { action, provider, recipientPhone, phoneNumber } = await readLimitedJsonBody<{
      action: string; provider?: string; recipientPhone?: string; phoneNumber?: string;
    }>(req, 32 * 1024);
    const setProvider = async (next: string) => {
      const { data, error } = await supabaseAdmin.from("restaurant_profiles")
        .update({ whatsapp_provider: next, updated_at: new Date().toISOString() }).eq("id", restaurantId).select("id").single();
      if (error || !data) throw error || new Error("Restaurant not found");
      invalidateCache("restaurant_profile:" + restaurantId);
      invalidateRestaurantCaches();
    };
    if (action === "switch_provider") {
      if (!provider || !["meta", "evolution", "none"].includes(provider)) throw new ApiRequestError("Provider must be meta, evolution, or none", 400);
      await setProvider(provider);
      return NextResponse.json({ success: true, message: "Active provider set to " + provider, provider });
    }
    const evolutionActions: EvolutionAction[] = ["start", "stop", "restart", "logout", "pair", "create_session", "auto_webhook"];
    if (evolutionActions.includes(action as EvolutionAction)) {
      return NextResponse.json(await performEvolutionAction(action as EvolutionAction, restaurantId, phoneNumber));
    }
    if (action === "test_message") {
      const phone = String(recipientPhone || "").replace(/[^0-9]/g, "");
      if (!/^\d{7,15}$/.test(phone)) throw new ApiRequestError("Enter a phone number with country code", 400);
      const profile = await getRestaurantProfile(restaurantId);
      let transport: WhatsAppTransport;
      if (profile.whatsapp_provider === "evolution") {
        const config = await getEvolutionConfig(restaurantId);
        if (!config?.is_active) throw new ApiRequestError("Connect this restaurant to Evolution first", 400);
        transport = { provider: "evolution", restaurantId, instanceName: config.instance_name };
      } else if (profile.whatsapp_provider === "meta") {
        const { data: config, error } = await supabaseAdmin.from("whatsapp_configs").select("phone_number_id")
          .eq("restaurant_id", restaurantId).eq("is_active", true).order("updated_at", { ascending: false }).limit(1).single();
        if (error || !config) throw new ApiRequestError("Connect this restaurant to Meta first", 400);
        transport = { provider: "meta", restaurantId, phoneNumberId: config.phone_number_id };
      } else throw new ApiRequestError("Enable a WhatsApp provider first", 400);
      const result = await withWhatsAppTransport(transport, () => sendWhatsAppMessage(phone, "Hello from " + profile.app_name + "! Your " + transport.provider + " connection is working."));
      return NextResponse.json({ success: true, message: "Test message sent to +" + phone, messageId: result.messageId });
    }
    if (action === "disconnect" || action === "reconnect") {
      const { error } = await supabaseAdmin.from("whatsapp_configs")
        .update({ is_active: action === "reconnect", updated_at: new Date().toISOString() }).eq("restaurant_id", restaurantId);
      if (error) throw error;
      await setProvider(action === "reconnect" ? "meta" : "none");
      return NextResponse.json({ success: true, message: action === "reconnect" ? "Meta Cloud API enabled" : "WhatsApp disabled" });
    }
    throw new ApiRequestError("Unsupported WhatsApp action", 400);
  } catch (error) {
    return apiErrorResponse(error, { fallback: "Failed to execute WhatsApp action", context: "POST /api/dashboard/whatsapp/action" });
  }
}
