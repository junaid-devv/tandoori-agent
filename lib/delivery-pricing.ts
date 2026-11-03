/** Shared, deterministic area pricing. Aliases are explicit; uncertain matches never set a fee. */
export interface DeliveryZone {
  name: string;
  fee: number;
  aliases: string[];
}

export interface DeliveryPricing {
  delivery_pricing_mode?: "flat" | "area";
  delivery_zones?: DeliveryZone[];
  delivery_fee: number;
}

export function normalizeArea(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, " ").trim();
}

export function validateDeliveryZones(value: unknown): DeliveryZone[] {
  if (!Array.isArray(value) || value.length > 40) throw new Error("Delivery zones must be a list of at most 40 areas.");
  const seen = new Set<string>();
  return value.map((raw) => {
    if (!raw || typeof raw.name !== "string" || !normalizeArea(raw.name) || raw.name.trim().length > 100) {
      throw new Error("Each delivery area must have a valid name (up to 100 characters).");
    }
    if (typeof raw.fee !== "number" || !Number.isFinite(raw.fee) || raw.fee < 0 || raw.fee > 100000 || Math.abs(Math.round(raw.fee * 100) - raw.fee * 100) > 0.000001) {
      throw new Error("Area delivery fees must be between 0 and 100000 with at most two decimal places.");
    }
    if (!Array.isArray(raw.aliases) || raw.aliases.length > 10 || raw.aliases.some((a: unknown) => typeof a !== "string" || a.length > 100)) {
      throw new Error("Area aliases must be a list of up to 10 valid alternate names.");
    }
    const name = raw.name.trim();
    const aliases = [...new Set<string>(raw.aliases.map((a: string) => a.trim()).filter(Boolean))];
    for (const label of [name, ...aliases]) {
      const key = normalizeArea(label);
      if (!key) throw new Error("Area aliases must contain a valid alternate name.");
      if (seen.has(key)) throw new Error("Delivery area names and aliases must be unique.");
      seen.add(key);
    }
    return { name, fee: Math.round(raw.fee * 100) / 100, aliases };
  });
}

export function areaMatches(address: string, area: string): boolean {
  const destination = normalizeArea(address);
  const region = normalizeArea(area);
  if (!destination || !region) return false;
  const range = area.match(/^(.*?)(\d+)\s*[-–]\s*(\d+)(.*)$/);
  if (!range) return ` ${destination} `.includes(` ${region} `);
  const escape = (s: string) => normalizeArea(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ +/g, " +");
  const suffix = escape(range[4]);
  const matched = destination.match(new RegExp(`(?:^| )${escape(range[1])} *([0-9]+)${suffix ? ` +${suffix}` : ""}(?: |$)`));
  return Boolean(matched && Number(matched[1]) >= Number(range[2]) && Number(matched[1]) <= Number(range[3]));
}

export function resolveDeliveryQuote(address: string | null | undefined, settings: DeliveryPricing):
  { status: "matched"; fee: number; area: string | null } | { status: "missing" | "unserved" | "ambiguous"; fee: null; area: null } {
  if (settings.delivery_pricing_mode !== "area") return { status: "matched", fee: Number(settings.delivery_fee) || 0, area: null };
  if (!address?.trim()) return { status: "missing", fee: null, area: null };
  const zones = (settings.delivery_zones ?? []).filter(z => [z.name, ...z.aliases].some(a => areaMatches(address, a)));
  if (zones.length !== 1) return { status: zones.length ? "ambiguous" : "unserved", fee: null, area: null };
  return { status: "matched", fee: zones[0].fee, area: zones[0].name };
}

export function deliveryFeeInfo(settings: DeliveryPricing, currency: string, address?: string | null): string {
  const quote = resolveDeliveryQuote(address, settings);
  if (quote.status === "matched") return `Delivery Fee: ${currency} ${quote.fee}${quote.area ? ` (${quote.area})` : ""}`;
  return `Delivery charges by area: ${(settings.delivery_zones ?? []).map(z => `${z.name}: ${currency} ${z.fee}`).join("; ")}. Please confirm your delivery area so we can quote the exact fee.`;
}
