import type { MenuCatalogItem } from "@/lib/menu";
import { menuNameCoversQuery } from "@/lib/menu/search";
import { normalizeFoodScript } from "@/lib/pakistani-language";

/** Match the food phrase, retaining meaningful constraints and negations. A
 * question about dietary safety must not become a plain availability answer. */
export function catalogQuestionMatches(question: string, menu: MenuCatalogItem[]): MenuCatalogItem[] {
  const lookup = normalizeFoodScript(question).toLowerCase().replace(/[^\p{L}\p{N}.\s-]/gu, " ")
    .replace(/\b(?:what|whats|is|are|the|a|an|of|for|do|does|you|your|have|how|much|please|tell|me|about|price|prices|cost|rate|available|availability|include|includes|contain|contains|contents|ingredients|in|kya|kia|hai|hain|ka|ki|ke|mein|me|kitna|kitne|kitni|batao|batayein|milta|milti)\b/g, " ")
    .replace(/\s+/g, " ").trim();
  if (!lookup) return [];
  const literal = menu.filter((item) => menuNameCoversQuery(lookup, item.name, false, item.category));
  return literal.length ? literal : menu.filter((item) => menuNameCoversQuery(lookup, item.name, true, item.category));
}

/** Only complete, catalog-grounded questions can bypass interpretation. Bare
 * dish names, edits and mixed requests still go through the normal NLU path. */
export function isSimpleCatalogQuestion(question: string, menu: MenuCatalogItem[]): boolean {
  return /\?|\b(?:hai|hain|available|availability|price|cost|rate)\b|^(?:do|does)\s+you\s+have\b/i.test(question)
    && catalogQuestionMatches(question, menu).length > 0;
}

export function deliveryQuestionTopics(question: string) {
  return {
    time: /\b(?:time|eta|minutes?|mins?|waqt|der|dair)\b|\bhow\s+long\b|\bwhen\b.*\b(?:arriv\w*|deliver\w*|ready|reach\w*)|\bk(?:itn[ai]|itnay)\s*(?:d(?:e|a)y?r|time|waqt)|\bkab\s+(?:tak|a(?:ye|jae)ga|pohanch)|دیر|وقت|ٹائم|څومره\s+وخت|کله\s+رسیږي/i.test(question),
    fee: /charge|fee|pesay|paise|paisa|kitnay\s+ka|پیسے|قیمت|چارجز|پیسی|څو/i.test(question),
  };
}
