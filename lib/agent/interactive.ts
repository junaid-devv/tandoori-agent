/**
 * lib/agent/interactive.ts — Interactive reply builders for the pipeline
 *
 * Produces WhatsApp reply-button / list payloads for the moments where a tap is
 * faster than typing: order type, category browse, item disambiguation, confirm.
 * The dispatcher (assistant-dispatcher) already knows how to send these and
 * auto-falls-back to numbered text if interactive send fails, so callers just
 * attach a payload and don't worry about transport.
 *
 * IDs are namespaced so the pipeline's deterministic fast-path (and the webhook
 * interactive handler) can recognize taps unambiguously.
 */
import type { LanguagePreference } from "@/lib/schema.types";
import type { RestaurantSettings } from "@/lib/settings";
import { extractBaseItemName } from "@/lib/menu/search";
import type {
  WhatsAppInteractiveListPayload,
  WhatsAppReplyButtonPayload,
} from "@/lib/whatsapp";

export type InteractivePayload =
  | { kind: "buttons"; payload: WhatsAppReplyButtonPayload }
  | { kind: "list"; payload: WhatsAppInteractiveListPayload };

const ur = (l: LanguagePreference) => l === "roman_urdu";

/** Quick-reply buttons for 2-3 item variants (e.g. Half / Full). */
/** Quick-reply buttons / pick-list for item variants (e.g. Half / Full / Reg / Med / Large / XL). */
export function variantButtons(
  l: LanguagePreference,
  variants: Array<{ id: string; name: string; price: number; category?: string | null }>,
  currency: string,
  bodyText?: string,
): InteractivePayload | null {
  if (variants.length === 0) return null;
  if (variants.length <= 3) {
    const buttons = variants.map((v) => {
      const { variant } = extractBaseItemName(v.name);
      const label = variant ? `${variant.toUpperCase()} (${currency} ${v.price})` : v.name;
      return {
        id: `item:${v.id}`,
        title: label.slice(0, 20),
      };
    });
    return {
      kind: "buttons",
      payload: {
        body: bodyText || (ur(l) ? "Kaunsa size chahiye?" : "Which size would you like?"),
        buttons,
      },
    };
  }
  return itemPickList(
    l,
    variants,
    currency,
    bodyText || (ur(l) ? "Kaunsa size chahiye?" : "Which size would you like?"),
  );
}

/** Order type quick-reply buttons (hides Delivery button if delivery_enabled is false). */
export function orderTypeButtons(l: LanguagePreference, settings?: RestaurantSettings | null): InteractivePayload {
  const buttons: Array<{ id: string; title: string }> = [];
  if (settings?.delivery_enabled !== false) {
    buttons.push({ id: "ordertype:delivery", title: "Delivery" });
  }
  buttons.push({ id: "ordertype:pickup", title: "Pickup" });
  buttons.push({ id: "ordertype:dine-in", title: "Dine-in" });

  return {
    kind: "buttons",
    payload: {
      body: ur(l)
        ? "Order kaise chahiye?"
        : "How would you like your order?",
      buttons,
    },
  };
}

/** Confirm / add-more as reply buttons. */
export function confirmButtons(l: LanguagePreference): InteractivePayload {
  return {
    kind: "buttons",
    payload: {
      body: ur(l) ? "Order confirm karein?" : "Confirm your order?",
      buttons: [
        { id: "confirm:yes", title: "Confirm ✓" },
        { id: "action:add_more", title: "Add More" },
      ],
    },
  };
}

/** Cart action buttons shown after adding an item or viewing cart. */
export function cartActionButtons(l: LanguagePreference, _opts?: { hideViewCart?: boolean }): InteractivePayload {
  return {
    kind: "buttons",
    payload: {
      body: ur(l) ? "Kya karna hai?" : "What would you like to do?",
      buttons: [
        { id: "action:add_more", title: "Add More" },
        { id: "action:checkout", title: "Checkout" },
      ],
    },
  };
}

/** A pick-list of concrete menu items (for disambiguation / recommendations). */
export function itemPickList(
  l: LanguagePreference,
  items: Array<{ id: string; name: string; price: number; category?: string | null }>,
  currency: string,
  bodyText?: string,
  browse?: { category: string; page: number },
): InteractivePayload | null {
  const pageSize = browse && items.length > 10 ? 8 : 10;
  const page = browse ? Math.max(0, Math.min(browse.page, Math.ceil(items.length / pageSize) - 1)) : 0;
  const rows = items.slice(page * pageSize, (page + 1) * pageSize).map((it) => ({
    id: `item:${it.id}`,
    title: it.name.slice(0, 24),
    description: `${currency} ${it.price}${it.category ? ` · ${it.category}` : ""}`.slice(0, 72),
  }));
  if (browse) {
    const id = `category:__items:${encodeURIComponent(browse.category)}:`;
    if (page > 0) rows.push({ id: `${id}${page - 1}`, title: ur(l) ? "Pichlay items" : "Previous items", description: "" });
    if ((page + 1) * pageSize < items.length) rows.push({ id: `${id}${page + 1}`, title: ur(l) ? "Mazeed items" : "More items", description: "" });
  }
  if (rows.length === 0) return null;
  return {
    kind: "list",
    payload: {
      body: bodyText || (ur(l) ? "In me se select karein:" : "Pick one:"),
      buttonText: ur(l) ? "Dekhein" : "View",
      sectionTitle: ur(l) ? "Items" : "Items",
      rows,
    },
  };
}

/** A list of menu categories to browse. */
export function categoryList(
  l: LanguagePreference,
  categories: string[],
  bodyText?: string,
  page = 0,
): InteractivePayload | null {
  const pageSize = categories.length > 10 ? 8 : 10;
  const current = Math.max(0, Math.min(page, Math.ceil(categories.length / pageSize) - 1));
  const rows = categories.slice(current * pageSize, (current + 1) * pageSize).map((c) => ({
    id: `category:${c}`,
    title: c.slice(0, 24),
  }));
  if (current > 0) rows.push({ id: `category:__page:${current - 1}`, title: ur(l) ? "Pichli categories" : "Previous categories" });
  if ((current + 1) * pageSize < categories.length) rows.push({ id: `category:__page:${current + 1}`, title: ur(l) ? "Mazeed categories" : "More categories" });
  if (rows.length === 0) return null;
  return {
    kind: "list",
    payload: {
      body: bodyText || (ur(l) ? "Kaunsi cheez chahiye?" : "What would you like?"),
      buttonText: ur(l) ? "Menu Dekhein" : "View Menu",
      sectionTitle: "Menu",
      rows,
    },
  };
}
