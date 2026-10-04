import "server-only";

import { ApiRequestError } from "./api-utils";
import { getCached, invalidateCache, setCached } from "./cache";
import type { BranchMode, MenuDisplayMode, RestaurantProfile } from "./restaurant-profile-types";
import { supabaseAdmin } from "./supabase-admin";

const PROFILE_CACHE_KEY = "restaurant_profile:default";
const PROFILE_CACHE_TTL_MS = 10 * 1000; // 10 seconds (absorbs bursts without holding stale settings)
const DEFAULT_PROFILE_ID = "default";

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const BRANCH_MODES = new Set<BranchMode>(["single", "multiple"]);

function envFallback(name: string, fallback: string) {
  return process.env[name]?.trim() || fallback;
}

export function getFallbackRestaurantProfile(): RestaurantProfile {
  const appName = envFallback("NEXT_PUBLIC_APP_NAME", "Restaurant Agent");
  const supportPhone = envFallback("NEXT_PUBLIC_APP_PHONE_DELIVERY", "");

  return {
    id: DEFAULT_PROFILE_ID,
    app_name: appName,
    dashboard_title: `${appName} Dashboard`,
    logo_url: process.env.NEXT_PUBLIC_LOGO_URL?.trim() || null,
    brand_color: envFallback("NEXT_PUBLIC_BRAND_COLOR", "#EA580C"),
    brand_hover_color: envFallback("NEXT_PUBLIC_BRAND_HOVER_COLOR", "#C2410C"),
    city: envFallback("NEXT_PUBLIC_APP_CITY", "City"),
    currency: envFallback("NEXT_PUBLIC_APP_CURRENCY", "Rs."),
    timezone: envFallback("RESTAURANT_TIMEZONE", "Asia/Karachi"),
    branch_mode: (process.env.RESTAURANT_BRANCH_MODE?.trim() === "multiple" ? "multiple" : "single"),
    default_branch_id: null,
    support_phone: supportPhone,
    delivery_phone: supportPhone,
    dine_in_phone: envFallback("NEXT_PUBLIC_APP_PHONE_DINE_IN", supportPhone),
    ai_personality_default: "Warm & Professional",
    menu_display_mode: (process.env.MENU_DISPLAY_MODE as MenuDisplayMode) || "interactive_list",
    menu_card_images: process.env.MENU_CARD_IMAGES ? JSON.parse(process.env.MENU_CARD_IMAGES) : [],
    whatsapp_provider: (process.env.WHATSAPP_PROVIDER as "meta" | "wa_akg" | "none") || "meta",
  };
}

function normalizeProfileRow(row: Partial<RestaurantProfile> | null | undefined): RestaurantProfile {
  const fallback = getFallbackRestaurantProfile();
  if (!row) return fallback;

  const branchMode = BRANCH_MODES.has(row.branch_mode as BranchMode)
    ? (row.branch_mode as BranchMode)
    : fallback.branch_mode;

  return {
    id: row.id || DEFAULT_PROFILE_ID,
    app_name: row.app_name?.trim() || fallback.app_name,
    dashboard_title: row.dashboard_title?.trim() || fallback.dashboard_title,
    logo_url: row.logo_url?.trim() || null,
    brand_color: HEX_COLOR_PATTERN.test(row.brand_color ?? "") ? row.brand_color! : fallback.brand_color,
    brand_hover_color: HEX_COLOR_PATTERN.test(row.brand_hover_color ?? "")
      ? row.brand_hover_color!
      : fallback.brand_hover_color,
    city: row.city?.trim() || fallback.city,
    currency: row.currency?.trim() || fallback.currency,
    timezone: row.timezone?.trim() || fallback.timezone,
    branch_mode: branchMode,
    default_branch_id: row.default_branch_id?.trim() || null,
    support_phone: row.support_phone?.trim() || fallback.support_phone,
    delivery_phone: row.delivery_phone?.trim() || fallback.delivery_phone,
    dine_in_phone: row.dine_in_phone?.trim() || fallback.dine_in_phone,
    ai_personality_default: row.ai_personality_default?.trim() || fallback.ai_personality_default,
    menu_display_mode: (["interactive_list", "menu_pictures", "text_only"].includes(row.menu_display_mode as string) ? row.menu_display_mode : fallback.menu_display_mode) as MenuDisplayMode,
    menu_card_images: Array.isArray(row.menu_card_images) ? row.menu_card_images : fallback.menu_card_images,
    whatsapp_provider: (["meta", "wa_akg", "none"].includes(row.whatsapp_provider as string) ? row.whatsapp_provider : "meta") as "meta" | "wa_akg" | "none",
  };
}

function validateOptionalText(value: unknown, fieldName: string, maxLength: number): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (text.length > maxLength) {
    throw new ApiRequestError(`${fieldName} is too long.`, 400);
  }
  return text || null;
}

function validateRequiredText(value: unknown, fieldName: string, maxLength: number): string {
  const text = validateOptionalText(value, fieldName, maxLength);
  if (!text) {
    throw new ApiRequestError(`${fieldName} is required.`, 400);
  }
  return text;
}

function validateColor(value: unknown, fieldName: string): string {
  const color = validateRequiredText(value, fieldName, 16);
  if (!HEX_COLOR_PATTERN.test(color)) {
    throw new ApiRequestError(`${fieldName} must be a hex color like #EA580C.`, 400);
  }
  return color.toUpperCase();
}

function validateBranchMode(value: unknown): BranchMode {
  const mode = String(value ?? "").trim();
  if (!BRANCH_MODES.has(mode as BranchMode)) {
    throw new ApiRequestError("Branch mode must be single or multiple.", 400);
  }
  return mode as BranchMode;
}

export function validateRestaurantProfileInput(input: Partial<RestaurantProfile>) {
  const VALID_DISPLAY_MODES = new Set(["interactive_list", "menu_pictures", "text_only"]);
  const VALID_WA_PROVIDERS = new Set(["meta", "wa_akg", "none"]);

  const base: Record<string, unknown> = {
    app_name: validateRequiredText(input.app_name, "Restaurant name", 80),
    dashboard_title: validateRequiredText(input.dashboard_title, "Dashboard title", 120),
    logo_url: validateOptionalText(input.logo_url, "Logo URL", 500),
    brand_color: validateColor(input.brand_color, "Brand color"),
    brand_hover_color: validateColor(input.brand_hover_color, "Brand hover color"),
    city: validateRequiredText(input.city, "Default city", 80),
    currency: validateRequiredText(input.currency, "Currency label", 12),
    timezone: validateRequiredText(input.timezone, "Timezone", 80),
    branch_mode: validateBranchMode(input.branch_mode),
    default_branch_id: validateOptionalText(input.default_branch_id, "Primary branch", 80),
    support_phone: validateRequiredText(input.support_phone, "Support phone", 40),
    delivery_phone: validateRequiredText(input.delivery_phone, "Delivery phone", 40),
    dine_in_phone: validateRequiredText(input.dine_in_phone, "Dine-in phone", 40),
    ai_personality_default: validateRequiredText(input.ai_personality_default, "Default AI tone", 240),
  };

  // New white-label fields — only include if provided (partial updates)
  if (input.menu_display_mode !== undefined) {
    const mode = String(input.menu_display_mode).trim();
    if (!VALID_DISPLAY_MODES.has(mode)) {
      throw new ApiRequestError("Menu display mode must be interactive_list, menu_pictures, or text_only.", 400);
    }
    base.menu_display_mode = mode;
  }
  if (input.menu_card_images !== undefined) {
    if (!Array.isArray(input.menu_card_images)) {
      throw new ApiRequestError("Menu card images must be an array of URLs.", 400);
    }
    base.menu_card_images = input.menu_card_images;
  }
  if (input.whatsapp_provider !== undefined) {
    const provider = String(input.whatsapp_provider).trim();
    if (!VALID_WA_PROVIDERS.has(provider)) {
      throw new ApiRequestError("WhatsApp provider must be meta, wa_akg, or none.", 400);
    }
    base.whatsapp_provider = provider;
  }

  return base;
}

export async function getRestaurantProfile(restaurantId?: string): Promise<RestaurantProfile> {
  const profileId = restaurantId || DEFAULT_PROFILE_ID;
  const cacheKey = `restaurant_profile:${profileId}`;
  const cached = getCached<RestaurantProfile>(cacheKey);
  if (cached) return cached;

  try {
    let query = supabaseAdmin.from("restaurant_profiles").select("*");
    
    if (restaurantId) {
      query = query.eq("id", restaurantId);
    } else {
      // Cross-restaurant or no specific restaurant: load first active profile
      query = query.order("created_at", { ascending: true }).limit(1);
    }
    
    const { data, error } = await query.maybeSingle();

    if (error && restaurantId) {
      console.warn(`[restaurant-profile] Failed to load profile ${restaurantId}:`, error.message);
      throw error;
    } else if (error || !data) {
      console.warn("[restaurant-profile] Falling back to env defaults:", error?.message || "No profile found");
      const fallback = getFallbackRestaurantProfile();
      setCached(cacheKey, fallback, PROFILE_CACHE_TTL_MS);
      return fallback;
    }

    const profile = normalizeProfileRow(data);
    setCached(cacheKey, profile, PROFILE_CACHE_TTL_MS);
    return profile;
  } catch (error) {
    console.warn("[restaurant-profile] Falling back to env defaults:", error);
    const fallback = getFallbackRestaurantProfile();
    setCached(cacheKey, fallback, PROFILE_CACHE_TTL_MS);
    return fallback;
  }
}

export async function updateRestaurantProfile(restaurantId: string, input: Partial<RestaurantProfile>) {
  const validated = validateRestaurantProfileInput(input);
  const cacheKey = `restaurant_profile:${restaurantId}`;

  const { data, error } = await supabaseAdmin
    .from("restaurant_profiles")
    .upsert(
      {
        id: restaurantId,
        ...validated,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    )
    .select("*")
    .single();

  if (error || !data) {
    throw error ?? new Error("Failed to update restaurant profile.");
  }

  const profile = normalizeProfileRow(data);
  invalidateCache(cacheKey);
  setCached(cacheKey, profile, PROFILE_CACHE_TTL_MS);
  return profile;
}
