import { supabaseAdmin } from "./supabase-admin";
import type { RestaurantProfile } from "./restaurant-profile-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type WhatsAppConfig = {
  id: string;
  restaurant_id: string;
  waba_id: string;
  phone_number_id: string;
  display_phone_number: string | null;
  verified_name: string | null;
  is_active: boolean;
};

export type RestaurantContext = {
  restaurantId: string;
  profile: RestaurantProfile;
  whatsappConfig: WhatsAppConfig;
};

// ---------------------------------------------------------------------------
// In-memory cache (process-level, short TTL for serverless)
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 15_000; // 15 seconds

type CacheEntry<T> = { data: T; at: number };
const phoneToRestaurantCache = new Map<string, CacheEntry<RestaurantContext | null>>();
const profileCache = new Map<string, CacheEntry<RestaurantProfile>>();

function isFresh<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
  return !!entry && Date.now() - entry.at < CACHE_TTL_MS;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve restaurant context from a Meta WhatsApp phone_number_id.
 * Returns null if the phone number is not registered to any restaurant.
 */
export async function getRestaurantByPhoneNumberId(
  phoneNumberId: string,
): Promise<RestaurantContext | null> {
  const cached = phoneToRestaurantCache.get(phoneNumberId);
  if (isFresh(cached)) return cached.data;

  let { data: config } = await supabaseAdmin
    .from("whatsapp_configs")
    .select("*")
    .eq("phone_number_id", phoneNumberId)
    .eq("is_active", true)
    .maybeSingle();

  // If no DB config found, fallback to single-restaurant architecture:
  // Auto-heal by linking phone_number_id to default restaurant profile and environment access token.
  if (!config) {
    const { data: defaultProfileRow } = await supabaseAdmin
      .from("restaurant_profiles")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (defaultProfileRow) {
      const token = process.env.WHATSAPP_ACCESS_TOKEN || "";
      const { data: upserted } = await supabaseAdmin
        .from("whatsapp_configs")
        .upsert(
          {
            phone_number_id: phoneNumberId,
            restaurant_id: defaultProfileRow.id,
            access_token: token,
            display_phone_number: (defaultProfileRow.support_phone as string) || null,
            verified_name: (defaultProfileRow.name as string) || null,
            is_active: true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "phone_number_id" }
        )
        .select("*")
        .maybeSingle();

      config = upserted || {
        id: "auto-fallback",
        restaurant_id: defaultProfileRow.id,
        phone_number_id: phoneNumberId,
        waba_id: "",
        display_phone_number: defaultProfileRow.support_phone as string,
        verified_name: defaultProfileRow.name as string,
        is_active: true,
      };
    }
  }

  if (!config) {
    phoneToRestaurantCache.set(phoneNumberId, { data: null, at: Date.now() });
    return null;
  }

  const profile = await getRestaurantProfileById(config.restaurant_id);
  if (!profile) {
    phoneToRestaurantCache.set(phoneNumberId, { data: null, at: Date.now() });
    return null;
  }

  const ctx: RestaurantContext = {
    restaurantId: config.restaurant_id,
    profile,
    whatsappConfig: config as WhatsAppConfig,
  };

  phoneToRestaurantCache.set(phoneNumberId, { data: ctx, at: Date.now() });
  return ctx;
}

/**
 * Load a restaurant profile by its UUID.
 */
export async function getRestaurantProfileById(
  restaurantId: string,
): Promise<RestaurantProfile | null> {
  const cached = profileCache.get(restaurantId);
  if (isFresh(cached)) return cached.data;

  const { data: row } = await supabaseAdmin
    .from("restaurant_profiles")
    .select("*")
    .eq("id", restaurantId)
    .maybeSingle();

  if (!row) return null;

  const profile = normalizeProfileRow(row);
  profileCache.set(restaurantId, { data: profile, at: Date.now() });
  return profile;
}

/**
 * Get the WhatsApp config for a restaurant.
 */
export async function getWhatsAppConfigForRestaurant(
  restaurantId: string,
): Promise<WhatsAppConfig | null> {
  const { data } = await supabaseAdmin
    .from("whatsapp_configs")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .eq("is_active", true)
    .maybeSingle();

  return data as WhatsAppConfig | null;
}

/** Invalidate all caches (e.g. after admin saves). */
export function invalidateRestaurantCaches(): void {
  phoneToRestaurantCache.clear();
  profileCache.clear();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function normalizeProfileRow(row: Record<string, unknown>): RestaurantProfile {
  return {
    id: row.id as string,
    app_name: (row.name as string) || "Restaurant",
    dashboard_title: (row.dashboard_title as string) || "Dashboard",
    logo_url: (row.logo_url as string) || null,
    brand_color: (row.brand_color as string) || "#EA580C",
    brand_hover_color: (row.brand_hover_color as string) || "#C2410C",
    city: (row.city as string) || "Islamabad",
    currency: (row.currency as string) || "Rs.",
    timezone: (row.timezone as string) || "Asia/Karachi",
    branch_mode: (row.branch_mode as "single" | "multiple") || "single",
    default_branch_id: (row.default_branch_id as string) || null,
    support_phone: (row.support_phone as string) || "",
    delivery_phone: (row.delivery_phone as string) || "",
    dine_in_phone: (row.dine_in_phone as string) || "",
    ai_personality_default: (row.ai_personality as string) || "Warm & Professional",
    menu_display_mode: (row.menu_display_mode as "interactive_list" | "menu_pictures" | "text_only") || "interactive_list",
    menu_card_images: Array.isArray(row.menu_card_images) ? row.menu_card_images as string[] : [],
    whatsapp_provider: (["meta", "wa_akg", "none"].includes(row.whatsapp_provider as string)
      ? (row.whatsapp_provider as "meta" | "wa_akg" | "none")
      : "meta"),
  };
}
