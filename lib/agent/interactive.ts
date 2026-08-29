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
import type {
  WhatsAppInteractiveListPayload,
  WhatsAppReplyButtonPayload,
} from "@/lib/whatsapp";

export type InteractivePayload =
  | { kind: "buttons"; payload: WhatsAppReplyButtonPayload }
  | { kind: "list"; payload: WhatsAppInteractiveListPayload };

const ur = (l: LanguagePreference) => l === "roman_urdu";

/** Order type as 3 quick-reply buttons. */
export function orderTypeButtons(l: LanguagePreference): InteractivePayload {
  return {
    kind: "buttons",
    payload: {
      body: ur(l)
        ? "Order kaise chahiye?"
        : "How would you like your order?",
      buttons: [
        { id: "ordertype:delivery", title: ur(l) ? "Delivery" : "Delivery" },
        { id: "ordertype:pickup", title: ur(l) ? "Pickup" : "Pickup" },
        { id: "ordertype:dine-in", title: ur(l) ? "Dine-in" : "Dine-in" },
      ],
    },
  };
}

/** Confirm / cancel / add-more as reply buttons (3 max). */
export function confirmButtons(l: LanguagePreference): InteractivePayload {
  return {
    kind: "buttons",
    payload: {
      body: ur(l) ? "Order confirm karein?" : "Confirm your order?",
      buttons: [
        { id: "confirm:yes", title: "Confirm ✓" },
        { id: "confirm:no", title: ur(l) ? "Wapas Jao" : "Go Back" },
        { id: "action:add_more", title: ur(l) ? "Aur Dalein" : "Add More" },
      ],
    },
  };
}

/** Cart action buttons shown after adding an item or viewing cart.
 *  hideViewCart: true → omit the "View Cart" button (used when cart is already displayed). */
export function cartActionButtons(l: LanguagePreference, opts?: { hideViewCart?: boolean }): InteractivePayload {
  const buttons: Array<{ id: string; title: string }> = [
    { id: "action:add_more", title: ur(l) ? "Aur Add Karein" : "Add More" },
    { id: "action:checkout", title: "Checkout" },
  ];
  if (!opts?.hideViewCart) {
    // Insert View Cart between Add More and Checkout (WhatsApp max 3 buttons)
    buttons.splice(1, 0, { id: "action:view_cart", title: ur(l) ? "Cart Dekhein" : "View Cart" });
  }
  return {
    kind: "buttons",
    payload: {
      body: ur(l) ? "Kya karna hai?" : "What would you like to do?",
      buttons,
    },
  };
}

/** A pick-list of concrete menu items (for disambiguation / recommendations). */
export function itemPickList(
  l: LanguagePreference,
  items: Array<{ id: string; name: string; price: number; category?: string | null }>,
  currency: string,
  bodyText?: string,
): InteractivePayload | null {
  const rows = items.slice(0, 10).map((it) => ({
    id: `item:${it.id}`,
    title: it.name.slice(0, 24),
    description: `${currency} ${it.price}${it.category ? ` · ${it.category}` : ""}`.slice(0, 72),
  }));
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
): InteractivePayload | null {
  const rows = categories.slice(0, 10).map((c) => ({
    id: `category:${c}`,
    title: c.slice(0, 24),
  }));
  if (rows.length === 0) return null;
  return {
    kind: "list",
    payload: {
      body: bodyText || (ur(l) ? "Kaunsi cheez chahiye?" : "What would you like?"),
      buttonText: ur(l) ? "Menu Dekhein" : "View Menu",
      sectionTitle: ur(l) ? "Menu" : "Menu",
      rows,
    },
  };
}
