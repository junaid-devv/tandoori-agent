/**
 * lib/agent/delivery.ts
 *
 * Pure delivery-area and ETA helpers — extracted from order-engine.ts (Phase 9).
 * No IO, no side effects. Used by the executor and checked by
 * check-operational-regressions.
 */
import { normalizeText } from "../order-text-utils.ts";
import type { RestaurantSettings } from "../settings.ts";
import type { OrderType } from "../schema.types.ts";

// ---------------------------------------------------------------------------
// Delivery area matching
// ---------------------------------------------------------------------------

function buildDeliveryAreasList(settings: RestaurantSettings): string {
  if (!Array.isArray(settings.delivery_areas) || settings.delivery_areas.length === 0) return "";
  const visibleAreas = settings.delivery_areas.map((area) => area.trim()).filter(Boolean).slice(0, 10);
  if (visibleAreas.length === 0) return "";
  const suffix = settings.delivery_areas.length > visibleAreas.length ? ", and nearby listed areas" : "";
  return `${visibleAreas.join(", ")}${suffix}`;
}

export function buildDeliveryAreaHint(settings: RestaurantSettings, romanUrdu: boolean): string {
  const areas = buildDeliveryAreasList(settings);
  if (!areas) return "";
  return romanUrdu ? ` Delivery areas: ${areas}.` : ` Delivery areas: ${areas}.`;
}

export function findMatchingDeliveryArea(address: string, settings: RestaurantSettings): string | null {
  const normalizedAddress = normalizeText(address);
  if (!normalizedAddress) return null;

  for (const area of settings.delivery_areas ?? []) {
    const normalizedArea = normalizeText(area);
    if (!normalizedArea) continue;
    if (normalizedAddress === normalizedArea || normalizedAddress.includes(normalizedArea)) {
      return area;
    }

    // Extract numeric ranges from the ORIGINAL area string (before normalization splits "1-6" into "1 6")
    const rangesInArea: Array<[number, number]> = [];
    for (const m of area.matchAll(/(\d+)\s*[-–]\s*(\d+)/g)) {
      rangesInArea.push([Number(m[1]), Number(m[2])]);
    }

    const areaTokens = normalizedArea.split(" ").filter((token) => {
      // Skip non-numeric tokens shorter than 3 chars (prepositions)
      if (/^\d+$/.test(token)) return false; // handled separately via range check
      return token.length >= 3;
    });

    // Check non-numeric tokens (e.g. "dha", "phase", "model", "town")
    const nonNumericMatch = areaTokens.length === 0 || areaTokens.every((token) => normalizedAddress.includes(token));
    
    if (nonNumericMatch && rangesInArea.length > 0) {
      // For areas with ranges (e.g. "DHA Phase 1-6"), check if any number in the address falls within any range
      const addrNumbers = (normalizedAddress.match(/\d+/g) ?? []).map(Number);
      const rangeMatch = rangesInArea.some(([lo, hi]) => addrNumbers.some((n) => n >= lo && n <= hi));
      if (rangeMatch) return area;
    } else if (nonNumericMatch && areaTokens.length > 0) {
      // For areas without ranges and with named tokens, it's a match
      return area;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// ETA / time reply
// ---------------------------------------------------------------------------

export function buildEstimatedTimeReply(
  settings: RestaurantSettings,
  orderType: OrderType | null,
  romanUrdu: boolean,
): string {
  const prepMinutes = Math.round(Number(settings.estimated_prep_minutes) || 30);
  const deliveryMinutes = Math.round(Number(settings.estimated_delivery_minutes) || 45);

  if (orderType === "pickup") {
    return romanUrdu
      ? `Pickup prep estimate confirmation ke baad takreeban ${prepMinutes} minutes hai.`
      : `Pickup prep estimate is about ${prepMinutes} minutes after confirmation.`;
  }

  if (orderType === "dine-in") {
    return romanUrdu
      ? `Dine-in orders ke liye prep estimate takreeban ${prepMinutes} minutes hai.`
      : `Dine-in prep estimate is about ${prepMinutes} minutes.`;
  }

  return romanUrdu
    ? `Delivery estimate confirmation ke baad takreeban ${deliveryMinutes} minutes hai. Prep time ${prepMinutes} minutes hai.`
    : `Delivery estimate is about ${deliveryMinutes} minutes after confirmation. Prep time is about ${prepMinutes} minutes.`;
}
