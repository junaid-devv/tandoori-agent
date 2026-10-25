import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/branch-request";
import { ApiRequestError, apiErrorResponse, readLimitedJsonBody } from "@/lib/api-utils";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { invalidateRestaurantCaches } from "@/lib/restaurant-resolver";
import { whatsappRestaurantId } from "@/lib/whatsapp-request";
import { invalidateCache } from "@/lib/cache";

export const dynamic = "force-dynamic";

type ConnectBody = { code?: string; pin?: string; wabaId?: string; phoneNumberId?: string; waba_id?: string; phone_number_id?: string };
type Phone = { id: string; display_phone_number?: string; verified_name?: string };

export async function POST(req: NextRequest) {
  const auth = await requireApiSession();
  if (auth.response) return auth.response;
  try {
    const restaurantId = whatsappRestaurantId(req, auth.session, true);
    const body = await readLimitedJsonBody<ConnectBody>(req, 32 * 1024);
    const wabaId = body.wabaId || body.waba_id;
    const phoneNumberId = body.phoneNumberId || body.phone_number_id;
    if (typeof body.code !== "string" || !body.code.trim() || !/^\d+$/.test(wabaId || "") || !/^\d+$/.test(phoneNumberId || "")) {
      throw new ApiRequestError("Complete Facebook signup and select your WhatsApp business account and phone number", 400);
    }
    const appId = process.env.NEXT_PUBLIC_META_APP_ID || process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET || process.env.WHATSAPP_APP_SECRET;
    if (!appId || !appSecret || appSecret.includes(",")) throw new ApiRequestError("The platform administrator must configure Meta Embedded Signup", 503);
    const tokenUrl = new URL("https://graph.facebook.com/v22.0/oauth/access_token");
    tokenUrl.searchParams.set("client_id", appId);
    tokenUrl.searchParams.set("client_secret", appSecret);
    tokenUrl.searchParams.set("code", body.code);
    const tokenRes = await fetch(tokenUrl, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
    const tokenData = await tokenRes.json();
    // An invalid code must never fall back to a shared platform token.
    if (!tokenRes.ok || typeof tokenData.access_token !== "string") throw new ApiRequestError("Facebook authorization failed. Start Connect with Facebook again", 403);
    const token: string = tokenData.access_token;
    const graph = async (path: string, method = "GET", payload?: unknown) => {
      const response = await fetch("https://graph.facebook.com/v22.0/" + path, {
        method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        ...(payload ? { body: JSON.stringify(payload) } : {}), cache: "no-store", signal: AbortSignal.timeout(12_000),
      });
      const data = await response.json();
      if (!response.ok) throw new ApiRequestError("Meta could not verify or subscribe this account. Check your account permissions and complete signup again", 403);
      return data;
    };
    // Validate membership, not just independent access to any two Meta assets.
    const phones = await graph(encodeURIComponent(wabaId!) + "/phone_numbers?fields=id,display_phone_number,verified_name&limit=100");
    const phone = (phones.data as Phone[] | undefined)?.find(item => item.id === phoneNumberId);
    if (!phone) throw new ApiRequestError("The selected phone does not belong to this WhatsApp Business Account", 403);
    const { data: existing, error } = await supabaseAdmin.from("whatsapp_configs").select("restaurant_id").eq("phone_number_id", phoneNumberId!).maybeSingle();
    if (error) throw error;
    if (existing && existing.restaurant_id !== restaurantId) throw new ApiRequestError("This phone is already assigned to another restaurant", 409);
    const subscription = await graph(encodeURIComponent(wabaId!) + "/subscribed_apps", "POST");
    if (subscription.success !== true) throw new ApiRequestError("Meta webhook subscription was not confirmed. Please reconnect", 409);
    const registration = await graph(encodeURIComponent(phoneNumberId!) + "?fields=platform_type,is_on_biz_app");
    if (registration.platform_type !== "CLOUD_API") {
      if (registration.is_on_biz_app === true) throw new ApiRequestError("Complete WhatsApp Business App coexistence onboarding in Facebook before connecting", 409);
      if (typeof body.pin !== "string" || !/^\d{6}$/.test(body.pin)) throw new ApiRequestError("This new number needs a 6-digit two-step verification PIN. Enter it below and repeat Facebook signup", 400);
      const registered = await graph(encodeURIComponent(phoneNumberId!) + "/register", "POST", { messaging_product: "whatsapp", pin: body.pin });
      if (registered.success !== true && registered.success !== "true") throw new ApiRequestError("Meta did not confirm phone registration. Please reconnect", 409);
    }
    const saved = await supabaseAdmin.rpc("connect_meta_whatsapp", {
      p_restaurant_id: restaurantId, p_phone_id: phoneNumberId, p_waba_id: wabaId,
      p_token: token, p_phone: phone.display_phone_number || null, p_name: phone.verified_name || null,
    });
    if (saved.error?.code === "23505") throw new ApiRequestError("This phone is already assigned to another restaurant", 409);
    if (saved.error) throw saved.error;
    invalidateCache("restaurant_profile:" + restaurantId);
    invalidateRestaurantCaches();
    return NextResponse.json({ success: true, message: "WhatsApp Business Account connected and webhook subscribed", data: {
      wabaId, phoneNumberId, displayPhoneNumber: phone.display_phone_number || null,
      verifiedName: phone.verified_name || null, webhookSubscribed: true, coexistenceEnabled: registration.is_on_biz_app === true,
    } });
  } catch (error) {
    return apiErrorResponse(error, { fallback: "Failed to connect WhatsApp account", context: "POST /api/dashboard/whatsapp/connect" });
  }
}
