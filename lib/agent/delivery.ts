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
import { sharedLocationPin } from "../location-pin.ts";
import { normalizePakistaniDigits } from "../pakistani-language.ts";

/** Numbered address pieces can arrive before the customer types their area. */
export function isDeliveryAddressFragment(address: string): boolean {
  return /^\d{1,4}\s+[a-z]\s*[-/]?\s*\d{1,5}$/i.test(normalizePakistaniDigits(address).trim())
    || /^(?:(?:house|h|flat|apartment|apt|shop|office|building|street|st|gali|makan|makaan|ghar|plot|room|block|sector)\s*(?:(?:no\.?|number)\s*)?#?\s*(?:\d+[a-z]?(?:[/-][a-z0-9]+)*|[a-z])\s*[,\s]*)+$/i
    .test(normalizePakistaniDigits(address).trim());
}

/** Common Pakistani block/house shorthand; it still needs an area or pin. */
export function isCompactDeliveryAddress(address: string): boolean {
  return /^\d{1,4}\s+[a-z]\s*[-/]?\s*\d{1,5}(?:$|[,\s])/i.test(normalizePakistaniDigits(address).trim());
}

/** Keep explicitly supplied pieces of the active draft, including its pin.
 * A full replacement replaces text; a new-address action clears it upstream. */
export function mergeDeliveryAddress(previous: string | null | undefined, incoming: string, replace = false): string {
  const next = incoming.trim();
  if (replace || !previous?.trim()) return next;
  const old = previous.trim();
  if (old.toLowerCase().includes(next.toLowerCase())) return old;
  const oldPin = sharedLocationPin(old);
  const nextPin = sharedLocationPin(next);
  const oldText = normalizePakistaniDigits(oldPin ? old.replace(oldPin, "").trim() : old);
  const nextText = normalizePakistaniDigits(nextPin ? next.replace(nextPin, "").trim() : next);
  if (nextText && isDeliveryAddressFragment(nextText) && !isCompactDeliveryAddress(nextText)) {
    let updated = oldText;
    let remaining = nextText;
    let changedDestination = false;
    for (const aliases of ["house|h|makan|makaan|ghar", "street|st\\.?|gali", "flat|apartment|apt", "shop", "office", "building", "plot", "room", "block", "sector"]) {
      const pattern = new RegExp(`\\b(?:${aliases})\\s*(?:(?:no\\.?|number)\\s*)?#?\\s*(\\d+[a-z]?(?:[/-][a-z0-9]+)*|[a-z])(?=$|[\\s,])`, "i");
      const part = remaining.match(pattern);
      const existing = updated.match(pattern);
      if (part && existing) {
        changedDestination ||= existing[1].toLowerCase() !== part[1].toLowerCase();
        updated = updated.replace(pattern, part[0]);
        remaining = remaining.replace(pattern, "").replace(/^[,\s]+|[,\s]+$/g, "");
      }
    }
    const text = [updated, remaining].filter(Boolean).join(", ");
    return [text, nextPin || (!changedDestination ? oldPin : null)].filter(Boolean).join("\n");
  }
  const text = !nextText ? oldText : !oldText || isCompleteDeliveryAddress(nextText) && !isDeliveryAddressFragment(nextText) ? nextText
    : isCompactDeliveryAddress(nextText) ? `${nextText}, ${oldText}` : `${oldText}, ${nextText}`;
  return [text, nextPin || oldPin].filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------
// Delivery area matching
// ---------------------------------------------------------------------------

/** An area establishes coverage; a destination also needs a building/street or landmark. */
export function isCompleteDeliveryAddress(address: string | null | undefined): boolean {
  if (!address || address.trim().length < 8) return false;
  if (sharedLocationPin(address)) return true;
  const text = normalizePakistaniDigits(address);
  if (isCompactDeliveryAddress(text) && /^\d{1,4}\s+[a-z]\s*[-/]?\s*\d{1,5}[,\s]+[a-z\u0600-\u06ff]/i.test(text.trim())) return true;
  if (/\b(?:house|h|flat|apartment|apt|shop|office|building|street|st|gali|makan|makaan|ghar|plot|room|gate)\s*(?:(?:no\.?|number)\s*)?#?\s*\d+[a-z]?(?:\b|[/-])/i.test(text)
    || /(?:گھر|مکان|گلی|فلیٹ|دکان|گیٹ)\s*(?:نمبر\s*)?[#:]?\s*\d+/u.test(text)) return true;
  // A landmark must have an actual name. "My house" or "near me" cannot
  // establish a rider's destination merely by containing an address keyword.
  const landmark = text.match(/\b(?:near|opposite|samne|qareeb|nazdeek|hostel|hotel|hospital|school|building|office|shop)\s+(.+)/i)?.[1]
    ?? text.match(/(?:قریب|سامنے)\s+(.+)/u)?.[1];
  const generic = /^(?:my|me|mera|mere|meri|apna|apni|ghar|house|home|office|shop|school|hospital|hotel|hostel|number|no|pe|par|hai|hain|ao|mein|main|wala|wali)$/i;
  if (landmark?.split(/[^\p{L}\p{N}]+/u).some((word) => word.length >= 3 && !generic.test(word))) return true;
  return /\b[\p{L}]{3,}\s+(?:hospital|school|hostel|hotel)\b/iu.test(text)
    && !/\b(?:my|mera|meri|mere|near|opposite)\s+(?:hospital|school|hostel|hotel)\b/i.test(text);
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

  const isUr = langOrRomanUrdu === "roman_urdu" || langOrRomanUrdu === true;

  if (orderType === "pickup") {

    return isUr
      ? `Pickup prep estimate confirmation ke baad takreeban ${prepMinutes} minutes hai.`
      : `Pickup prep estimate is about ${prepMinutes} minutes after confirmation.`;
  }

  if (orderType === "dine-in") {

    return isUr
      ? `Dine-in orders ke liye prep estimate takreeban ${prepMinutes} minutes hai.`
      : `Dine-in prep estimate is about ${prepMinutes} minutes.`;
  }

  return isUr
    ? `Delivery estimate confirmation ke baad takreeban ${deliveryMinutes} minutes hai. Prep time ${prepMinutes} minutes hai.`
    : `Delivery estimate is about ${deliveryMinutes} minutes after confirmation. Prep time is about ${prepMinutes} minutes.`;
}
