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

    const areaTokens = normalizedArea.split(" ").filter((token) => token.length >= 3);
    if (areaTokens.length > 0 && areaTokens.every((token) => normalizedAddress.includes(token))) {
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
