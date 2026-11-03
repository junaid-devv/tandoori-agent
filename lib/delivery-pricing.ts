/** Shared, deterministic area pricing. Uncertain matches never set a fee. */
export interface DeliveryZone {
  name: string;
  fee: number;
  aliases: string[];
}

export interface DeliveryPricing {
  delivery_pricing_mode?: "flat" | "area";
  delivery_zones?: DeliveryZone[];
  delivery_outside_area_per_km?: number;
  delivery_fee: number;
}

export function outsideAreaDeliveryRate(settings: DeliveryPricing): number {
  const rate = Number(settings.delivery_outside_area_per_km);
  return settings.delivery_pricing_mode === "area" && Number.isFinite(rate) && rate > 0 ? rate : 0;
}

export function outsideAreaDeliveryInfo(settings: DeliveryPricing, currency: string, language = "english"): string {
  const rate = outsideAreaDeliveryRate(settings);
  if (!rate) return "";
  if (language === "roman_urdu") return `Listed fixed-price areas ke ilawa bhi delivery available hai: ${currency} ${rate} per km (kilometre). Apna mukammal address ya WhatsApp location pin bhejein; hamari team distance aur final delivery charges confirm karegi. Order final charges par aap ki tasdeeq ke baad place hoga.`;
  if (language === "pashto") return `Da fixed-price areas na bahar hum delivery shta: ${currency} ${rate} per km (kilometre). Khpal poora address ya WhatsApp location pin rawalega; zmong team ba distance aw final delivery fee confirm kri. Order ba staso da final charges tasdeeq na pas place shi.`;
  return `Delivery outside the fixed-price areas is also available at ${currency} ${rate} per km (kilometre). Please share your full address or WhatsApp location pin; our team will confirm the distance and final delivery charge. Your order will be placed after you approve the final charges.`;
}

export function normalizeArea(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, " ").trim();
}

// Keep this normalization and typo matching in sync with the database migration.
function normalizeAreaForMatching(value: string): string {
  return normalizeArea(value
    .replace(/[۰-۹]/g, digit => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[يى]/g, "ی").replace(/ك/g, "ک")
    .replace(/[\u064b-\u065f\u0670\u0640]/g, ""));
}

function withinAreaTypoLimit(left: string, right: string, limit: number): boolean {
  if (Math.abs(left.length - right.length) > limit) return false;
  const editCost = (char: string) => /[0-9]/.test(char) ? 10000 : 1;
  let previous = [0];
  for (const char of right) previous.push(previous[previous.length - 1] + editCost(char));
  let beforePrevious = previous;
  for (let i = 1; i <= left.length; i++) {
    const row = [previous[0] + editCost(left[i - 1])];
    for (let j = 1; j <= right.length; j++) {
      row[j] = Math.min(row[j - 1] + editCost(right[j - 1]), previous[j] + editCost(left[i - 1]),
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : Math.max(editCost(left[i - 1]), editCost(right[j - 1]))));
      if (i > 1 && j > 1 && editCost(left[i - 1]) === 1 && editCost(left[i - 2]) === 1
        && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) {
        row[j] = Math.min(row[j], beforePrevious[j - 2] + 1);
      }
    }
    beforePrevious = previous;
    previous = row;
  }
  return previous[right.length] <= limit;
}

function spellingMatches(address: string, area: string, allowTypos: boolean): boolean {
  const words = normalizeAreaForMatching(address).slice(0, 2000).split(" ");
  const region = normalizeAreaForMatching(area);
  // Ranges retain their existing, number-bound matching behavior.
  if (!region || /\d+\s*[-–]\s*\d+/.test(area)) return false;
  const target = region.replace(/ /g, "");
  const targetNumbers = (target.match(/\d+/g) ?? []).join(",");
  const limit = allowTypos && /^[a-z0-9]+$/.test(target) && target.length >= 5
    ? (target.length >= 10 ? 2 : 1) : 0;
  const maxWords = region.split(" ").length + 1;
  for (let start = 0; start < words.length; start++) {
    // In "House 18 Area 17", 18 is a house number, not the area "18 Area".
    if (/^[0-9]/.test(target) && start > 0
      && /^(house|h|flat|apartment|apt|plot|street|st|gali|makan|makaan|ghar|shop|room|gate|گھر|مکان|گلی|دکان)$/.test(words[start - 1])) continue;
    let candidate = "";
    for (let count = 1; count <= maxWords && start + count <= words.length; count++) {
      candidate += words[start + count - 1];
      // Never correct an area, barrier or phase number to another number.
      if ((candidate.match(/\d+/g) ?? []).join(",") !== targetNumbers) continue;
      if (candidate === target || limit > 0 && withinAreaTypoLimit(candidate, target, limit)) return true;
    }
  }
  return false;
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
  const destination = normalizeAreaForMatching(address);
  const region = normalizeAreaForMatching(area);
  if (!destination || !region) return false;
  const range = area.match(/^(.*?)(\d+)\s*[-–]\s*(\d+)(.*)$/);
  if (!range) return (!/^[0-9]/.test(region) && ` ${destination} `.includes(` ${region} `)) || spellingMatches(address, area, false);
  const escape = (s: string) => normalizeArea(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ +/g, " +");
  const suffix = escape(range[4]);
  const matched = destination.match(new RegExp(`(?:^| )${escape(range[1])} *([0-9]+)${suffix ? ` +${suffix}` : ""}(?: |$)`));
  return Boolean(matched && Number(matched[1]) >= Number(range[2]) && Number(matched[1]) <= Number(range[3]));
}

export function resolveDeliveryQuote(address: string | null | undefined, settings: DeliveryPricing):
  { status: "matched"; fee: number; area: string | null } | { status: "missing" | "unserved" | "ambiguous"; fee: null; area: null } {
  if (settings.delivery_pricing_mode !== "area") return { status: "matched", fee: Number(settings.delivery_fee) || 0, area: null };
  if (!address?.trim()) return { status: "missing", fee: null, area: null };
  const configured = settings.delivery_zones ?? [];
  // Exact names/aliases take priority. Multiple plausible zones require clarification.
  const exact = configured.filter(z => [z.name, ...z.aliases].some(a => areaMatches(address, a)));
  const zones = exact.length ? exact
    : configured.filter(z => [z.name, ...z.aliases].some(a => spellingMatches(address, a, true)));
  if (zones.length !== 1) return { status: zones.length ? "ambiguous" : "unserved", fee: null, area: null };
  return { status: "matched", fee: zones[0].fee, area: zones[0].name };
}

export function deliveryFeeInfo(settings: DeliveryPricing, currency: string, address?: string | null): string {
  const quote = resolveDeliveryQuote(address, settings);
  const policy = outsideAreaDeliveryInfo(settings, currency);
  if (quote.status === "matched") return `Delivery Fee: ${currency} ${quote.fee}${quote.area ? ` (${quote.area})` : ""}${policy ? `\n${policy}` : ""}`;
  return `Delivery charges by area: ${(settings.delivery_zones ?? []).map(z => `${z.name}: ${currency} ${z.fee}`).join("; ")}. Please confirm your delivery area so we can quote the exact fee.${policy ? `\n${policy}` : ""}`;
}
