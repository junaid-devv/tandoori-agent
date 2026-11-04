import type { MenuCatalogItem } from "@/lib/menu";
import type { CartItem, LanguagePreference } from "@/lib/schema.types";

const counts: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 };

/** Accept only listed flavours and common answer wording. Questions, negations
 * and unknown flavours must still be clarified, never partially accepted. */
function selectedFlavors(text: string, options: string[], romanUrdu = false): string[] {
  if (/[?؟]|\b(?:no|not|nahi|nahin|without|instead|rate|price|ya)\b/i.test(text)) return [];
  if (!romanUrdu && /\bor\b/i.test(text)) return [];
  let rest = text.toLowerCase();
  const selected = options.filter((option) => {
    const escaped = option.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`\\b${escaped}\\b`, "gi");
    const present = pattern.test(rest);
    rest = rest.replace(pattern, " ");
    return present;
  });
  rest = rest.replace(/\b(?:flavou?rs?|choose|with|aur|or|and|wala|wali|walay|rakhna|rakh|rakho|dein|den|dena|do|kar|kr|kardo|krdo|please|pls|ji|bas|hain|hai)\b/g, " ");
  return /[\p{L}\p{N}]/u.test(rest) ? [] : selected;
}

/** Only collect choices explicitly required by the restaurant's description. */
export function dealFlavorRequirement(item: MenuCatalogItem, notes?: string | null) {
  const description = item.description ?? "";
  const count = description.match(/\bwith\s+(one|two|three|four|[1-4])\s+flavou?rs?\b/i)?.[1];
  const choices = description.match(/\bchoose\s+(?:(?:one|two|three|four|[1-4])\s+from\s+)?(.+?)(?:\.(?:\s|$)|$)/i)?.[1];
  if (!count || !choices) return null;
  const options = choices.split(/\s*,\s*|\s+or\s+|\s+and\s+/i).map((choice) => choice.trim()).filter(Boolean);
  const required = counts[count.toLowerCase()] ?? Number(count);
  if (options.length < required || options.some((choice) => choice.length > 40)) return null;
  const saved = notes?.match(/\bflavou?rs?\s*:?\s*([^;]+)/i)?.[1] ?? notes ?? "";
  const choicesInNotes = selectedFlavors(saved, options);
  const selected = choicesInNotes.length <= required ? choicesInNotes : [];
  return { options, required, selected };
}

export function pendingDealFlavor(cart: CartItem[], menu: MenuCatalogItem[]) {
  for (const line of cart) {
    const item = menu.find((food) => food.id === line.menu_item_id);
    const requirement = item && dealFlavorRequirement(item, line.notes);
    if (requirement && requirement.selected.length < requirement.required) return { line, ...requirement };
  }
  return null;
}

/** A standalone flavor answer updates the deal already in the cart. */
export function dealFlavorAnswer(text: string, cart: CartItem[], menu: MenuCatalogItem[], optionIds: string[], language?: LanguagePreference) {
  const pending = pendingDealFlavor(cart, menu);
  if (!pending) return null;
  const raw = text.trim();
  const tapped = raw.startsWith("flavor:") && optionIds.includes(raw)
    ? raw.slice(`flavor:${pending.line.menu_item_id}:`.length) : null;
  if (raw.startsWith("flavor:") && (!tapped || !raw.startsWith(`flavor:${pending.line.menu_item_id}:`))) return null;
  const choices = selectedFlavors(tapped ?? raw, pending.options, language === "roman_urdu");
  if (!choices.length) return null;
  const selected = [...new Set([...pending.selected, ...choices])];
  if (selected.length > pending.required) return null;
  const previous = pending.line.notes?.replace(/\bflavou?rs?:\s*[^;]+;?\s*/i, "").trim();
  return { query: pending.line.name, qty: null, size: null, addons: pending.line.addons,
    notes: [previous, `Flavours: ${selected.join(", ")}`].filter(Boolean).join("; ") };
}
