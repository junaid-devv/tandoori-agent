import { verifyProviderReady } from "@/lib/whatsapp-connections";
import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/branch-request";
import { apiErrorResponse, readLimitedJsonBody, ApiRequestError } from "@/lib/api-utils";
import { whatsappRestaurantId } from "@/lib/whatsapp-request";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { performEvolutionAction, type EvolutionAction } from "@/lib/evolution-client";
import { getRestaurantProfile } from "@/lib/restaurant-profile";
import { invalidateRestaurantCaches } from "@/lib/restaurant-resolver";
import { invalidateCache } from "@/lib/cache";
import { getTenantWhatsAppTransport, withWhatsAppTransport } from "@/lib/whatsapp-context";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireApiSession();
  if (auth.response) return auth.response;
  try {
    const restaurantId = whatsappRestaurantId(req, auth.session, true);
    const { action, provider, recipientPhone, phoneNumber, interactiveMode } = await readLimitedJsonBody<{
      action: string; provider?: string; recipientPhone?: string; phoneNumber?: string; interactiveMode?: string;
    }>(req, 32 * 1024);
    const setProvider = async (next: string) => {
      await verifyProviderReady(restaurantId, next);
      const { error } = await supabaseAdmin.rpc("switch_whatsapp_provider", { p_restaurant_id: restaurantId, p_provider: next });
      if (error) throw error;
      invalidateCache("restaurant_profile:" + restaurantId);
      invalidateRestaurantCaches();
    };
    if (action === "switch_provider") {
      if (!provider || !["meta", "evolution", "none"].includes(provider)) throw new ApiRequestError("Provider must be meta, evolution, or none", 400);
      await setProvider(provider);
      return NextResponse.json({ success: true, message: "Active provider set to " + provider, provider });
    }
    if (action === "interactive_mode") {
      if (!["compatible", "native"].includes(interactiveMode || "")) throw new ApiRequestError("Invalid interactive mode", 400);
      const { data, error } = await supabaseAdmin.from("evolution_configs").update({ interactive_mode: interactiveMode, updated_at: new Date().toISOString() }).eq("restaurant_id", restaurantId).select("restaurant_id").single();
      if (error || !data) throw error || new Error("Connect Evolution first");
      return NextResponse.json({ success: true, message: interactiveMode === "native" ? "Native buttons enabled. Test recipient visibility before using with customers." : "Compatible text options enabled." });
    }
    const evolutionActions: EvolutionAction[] = ["start", "stop", "restart", "logout", "pair", "create_session", "auto_webhook"];
    if (evolutionActions.includes(action as EvolutionAction)) {
      return NextResponse.json(await performEvolutionAction(action as EvolutionAction, restaurantId, phoneNumber));
    }
    if (action === "test_message") {
      const phone = String(recipientPhone || "").replace(/[^0-9]/g, "");
      if (!/^\d{7,15}$/.test(phone)) throw new ApiRequestError("Enter a phone number with country code", 400);
      const profile = await getRestaurantProfile(restaurantId);
      const transport = await getTenantWhatsAppTransport(restaurantId);
      const result = await withWhatsAppTransport(transport, () => sendWhatsAppMessage(phone, "Hello from " + profile.app_name + "! Your " + transport.provider + " connection is working."));
      return NextResponse.json({ success: true, message: "Test message sent to +" + phone, messageId: result.messageId });
    }
    if (action === "disconnect") {
      const { error } = await supabaseAdmin.rpc("disconnect_whatsapp_provider", { p_restaurant_id: restaurantId, p_provider: "meta" });
      if (error) throw error;
      invalidateCache("restaurant_profile:" + restaurantId);
      invalidateRestaurantCaches();
      return NextResponse.json({ success: true, message: "Meta disconnected" });
    }
    if (action === "reconnect") throw new ApiRequestError("Reconnect using Connect with Facebook to verify your account", 409);
    throw new ApiRequestError("Unsupported WhatsApp action", 400);
  } catch (error) {
    return apiErrorResponse(error, { fallback: "Failed to execute WhatsApp action", context: "POST /api/dashboard/whatsapp/action" });
  }
}
