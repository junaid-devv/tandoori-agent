import type { MenuCatalogItem } from "@/lib/menu";
import { menuNameCoversQuery } from "@/lib/menu/search";
import { normalizeFoodScript } from "@/lib/pakistani-language";
import type { TurnUnderstanding } from "./nlu";

/** Keep NLU context bounded to relevant names instead of sending the entire
 * catalog on every address, greeting or order turn. */
export function catalogSpellingHints(text: string, menu: MenuCatalogItem[]): string[] {
  const words = [...new Set(normalizeFoodScript(text).toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4))];
  return menu.map((item) => ({ item, score: words.filter((word) => menuNameCoversQuery(word, item.name, true, item.category)).length }))
    .filter(({ score }) => score > 0).sort((a, b) => b.score - a.score).slice(0, 32)
    .map(({ item }) => `${item.name} [${item.category ?? "Menu"}]`);
}

/** Only a complete simple food request can bypass NLU. Any leftover word,
 * question, negation, preparation or second item keeps the normal NLU path. */
export function simpleCatalogOrder(text: string, menu: MenuCatalogItem[]): TurnUnderstanding["items"] | null {
  let query = normalizeFoodScript(text).toLowerCase().replace(/^\s*\[voice note\]\s*/i, "").trim();
  if (/[\u0600-\u06ff\u0900-\u097f]/u.test(query)) return null;
  if (/[?؟]|\b(?:no|not|nahi|nahin|remove|cancel|without|less|extra|aur|and|or|bhi|rate|price|hai|hain)\b/.test(query)) return null;
  query = query.replace(/^(?:(?:main|mein|mujhe|i would like|i want|please|pls|add)\s+)+/, "")
    .replace(/\s+(?:order\s+(?:krna|karna)\s+(?:chahon|chahoon|chahun|chahta|chahti)\s*(?:ga|gi|hoon)?|chahiye|chahye|please|order karna hai)[.!]*$/, "")
    .replace(/[.!]+$/, "").trim();
  const quantity = query.match(/^(\d{1,2}|ek|aik|one|do|two|teen|three)\s+(.+)$/);
  let qty = 1;
  if (quantity) {
    // Dish identifiers and sizes are not portion quantities.
    if (/^(?:deal|combo)\b/.test(quantity[2]) || /\b(?:ml|litre|liter|kg|inch|piece|pcs)\b/.test(query)) return null;
    qty = ({ ek: 1, aik: 1, one: 1, do: 2, two: 2, teen: 3, three: 3 } as Record<string, number>)[quantity[1]] ?? Number(quantity[1]);
    query = quantity[2];
  }
  if (!query || qty < 1 || qty > 50 || !menu.some((item) => item.is_available && menuNameCoversQuery(query, item.name, true, item.category))) return null;
  return [{ query, qty, size: null, addons: [], notes: null }];
}
