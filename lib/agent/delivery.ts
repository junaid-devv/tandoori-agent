/**
 * lib/agent/delivery.ts
 *
 * Pure delivery-area and ETA helpers — extracted from order-engine.ts (Phase 9).
 * No IO, no side effects. Used by the executor and checked by
 * check-operational-regressions.
 */
import { resolveDeliveryQuote } from "../delivery-pricing.ts";
import { normalizeText } from "../order-text-utils.ts";
import type { RestaurantSettings } from "../settings.ts";
import type { LanguagePreference, OrderType } from "../schema.types.ts";

// ---------------------------------------------------------------------------
// Delivery area matching
// ---------------------------------------------------------------------------

/** An area establishes coverage; a destination also needs a building/street or landmark. */
export function isCompleteDeliveryAddress(address: string | null | undefined): boolean {
  if (!address || address.trim().length < 8) return false;
  return /\b(?:house|h\s*#|flat|apartment|apt|shop|office|building|street|st\.?\s*\d+|gali|makan|makaan|ghar|plot|hostel|room|hotel|hospital|school|gate|near|opposite|samne|qareeb|nazdeek)\b/i.test(address)
    || /(?:گھر|مکان|گلی|فلیٹ|دکان|گیٹ|قریب|سامنے)/u.test(address);
}

export function deliveryAreaNames(settings: RestaurantSettings): string[] {
  return settings.delivery_pricing_mode === "area" ? (settings.delivery_zones ?? []).map(z => z.name) : settings.delivery_areas ?? [];
}

export function hasDeliveryRestrictions(settings: RestaurantSettings): boolean {
  return settings.delivery_pricing_mode === "area" || Boolean(settings.delivery_areas?.length);
}

function buildDeliveryAreasList(settings: RestaurantSettings): string {
  settings = { ...settings, delivery_areas: deliveryAreaNames(settings) };
  if (!Array.isArray(settings.delivery_areas) || settings.delivery_areas.length === 0) return "";
  const visibleAreas = settings.delivery_areas.map((area) => area.trim()).filter(Boolean).slice(0, 10);
  if (visibleAreas.length === 0) return "";
  const suffix = settings.delivery_areas.length > visibleAreas.length ? ", and nearby listed areas" : "";
  return `${visibleAreas.join(", ")}${suffix}`;
}

export function buildDeliveryAreaHint(settings: RestaurantSettings, _langOrRomanUrdu?: boolean | LanguagePreference): string {
  const areas = buildDeliveryAreasList(settings);
  if (!areas) return "";
  return ` Delivery areas: ${areas}.`;
}

export function findMatchingDeliveryArea(address: string, settings: RestaurantSettings): string | null {
  if (settings.delivery_pricing_mode === "area") {
    const quote = resolveDeliveryQuote(address, settings);
    return quote.status === "matched" ? quote.area : null;
  }
  const normalizedAddress = normalizeText(address);
  if (!normalizedAddress) return null;

  for (const area of settings.delivery_areas ?? []) {
    const range = area.match(/^(.*?)(\d+)\s*[-–]\s*(\d+)(.*)$/);
    if (range) {
      const prefix = normalizeText(range[1]);
      const suffix = normalizeText(range[4]);
      const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
      // Bind the number to its named area/phase. A house number must not satisfy the range.
      const pattern = new RegExp(`(?:^|\\s)${escape(prefix)}\\s*(\\d+)(?!\\d)${suffix ? `\\s+${escape(suffix)}` : ""}(?:$|\\s)`);
      const matched = normalizedAddress.match(pattern);
      if (matched && Number(matched[1]) >= Number(range[2]) && Number(matched[1]) <= Number(range[3])) return area;
      continue;
    }
    const tokens = normalizeText(area).split(" ").filter(Boolean);
    if (!tokens.length) continue;
    const phrase = tokens.join(" ");
    if (` ${normalizedAddress} `.includes(` ${phrase} `)) return area;
  }

  return null;
}

// ---------------------------------------------------------------------------
// ETA / time reply
// ---------------------------------------------------------------------------

export function buildEstimatedTimeReply(
  settings: RestaurantSettings,
  orderType: OrderType | null,
  langOrRomanUrdu: boolean | LanguagePreference,
): string {
  const prepMinutes = Math.round(Number(settings.estimated_prep_minutes) || 30);
  const deliveryMinutes = Math.round(Number(settings.estimated_delivery_minutes) || 45);

  const isPa = langOrRomanUrdu === "pashto";
  const isUr = langOrRomanUrdu === "roman_urdu" || langOrRomanUrdu === true;

  if (orderType === "pickup") {
    if (isPa) return `Pickup prep estimate confirmation baad takreeban ${prepMinutes} minutes day.`;
    return isUr
      ? `Pickup prep estimate confirmation ke baad takreeban ${prepMinutes} minutes hai.`
      : `Pickup prep estimate is about ${prepMinutes} minutes after confirmation.`;
  }

  if (orderType === "dine-in") {
    if (isPa) return `Dine-in orders dapara prep estimate takreeban ${prepMinutes} minutes day.`;
    return isUr
      ? `Dine-in orders ke liye prep estimate takreeban ${prepMinutes} minutes hai.`
      : `Dine-in prep estimate is about ${prepMinutes} minutes.`;
  }

  if (isPa) {
    return `Delivery estimate confirmation baad takreeban ${deliveryMinutes} minutes day. Prep time ${prepMinutes} minutes day.`;
  }
  return isUr
    ? `Delivery estimate confirmation ke baad takreeban ${deliveryMinutes} minutes hai. Prep time ${prepMinutes} minutes hai.`
    : `Delivery estimate is about ${deliveryMinutes} minutes after confirmation. Prep time is about ${prepMinutes} minutes.`;
}
