export function locationPinUrl(latitude: unknown, longitude: unknown): string | null {
  if (typeof latitude !== "number" || typeof longitude !== "number"
    || !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return `https://maps.google.com/?q=${latitude},${longitude}`;
}

/** Only a stand-alone shared pin (optionally with a name/address) is accepted.
 * Text asking to change an order or destination must still go through review. */
export function sharedLocationPin(text: string): string | null {
  if (/\b(?:change|instead|new address|deliver to|badal|tabdeel)\b/i.test(text)) return null;
  const match = text.trim().match(/(?:^|\n)(https:\/\/(?:maps\.google\.com\/\?q=|www\.google\.com\/maps\?q=)(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?))$/);
  return match ? locationPinUrl(Number(match[2]), Number(match[3])) : null;
}
