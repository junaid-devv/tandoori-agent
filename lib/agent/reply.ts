/**
 * lib/agent/reply.ts
 *
 * All customer-facing copy. One clear next step per reply. No double blank lines.
 * Tone: friendly Pakistani restaurant staff — short, warm, never robotic.
 */
import type { CartItem, LanguagePreference, OrderType } from "@/lib/schema.types";
import { cartSubtotal } from "./cart";

type Lang = LanguagePreference;
const ur = (l: Lang) => l === "roman_urdu";

export const reply = {

  greeting(l: Lang, appName: string, customerName?: string | null, wasSalam?: boolean): string {
    const name = customerName ? ` ${customerName.split(" ")[0]}` : "";
    if (ur(l)) {
      const sal = wasSalam ? "Walaikum Assalam!" : "Assalam o Alaikum!";
      return `${sal}${name} 😊 *${appName}* mein khush aamdeed!\nAaj kya order karein ge?`;
    }
    const sal = wasSalam ? "Walaikum Assalam!" : "Hello!";
    return `${sal}${name} 😊 Welcome to *${appName}*!\nWhat would you like today?`;
  },

  itemsAdded(l: Lang, added: Array<{ name: string; newCartQty: number }>, cart: CartItem[], currency: string): string {
    const total = `${currency} ${cartSubtotal(cart)}`;
    if (added.length === 0) {
      return ur(l) ? `🛒 Total: ${total}` : `🛒 Total: ${total}`;
    }
    const list = added.map((i) => `${i.newCartQty}x ${i.name}`).join(", ");
    return ur(l)
      ? `✅ ${list} add ho gaya. Total: ${total}`
      : `✅ Added: ${list}. Total: ${total}`;
  },

  cartUpdated(l: Lang, cart: CartItem[], currency: string): string {
    const total = `${currency} ${cartSubtotal(cart)}`;
    return ur(l)
      ? `✅ Cart update ho gaya. Total: ${total}`
      : `✅ Cart updated. Total: ${total}`;
  },

  itemsRemoved(l: Lang, cart: CartItem[], currency: string): string {
    if (cart.length === 0) {
      return ur(l) ? "Cart khali ho gaya. Kya add karna chahenge?" : "Cart is now empty. Add something?";
    }
    const total = `${currency} ${cartSubtotal(cart)}`;
    return ur(l) ? `Theek hai, remove ho gaya. Total: ${total}` : `Done. Total: ${total}`;
  },

  notFound(l: Lang, query: string, suggestions: string[]): string {
    if (suggestions.length > 0) {
      const opts = suggestions.slice(0, 3).join(", ");
      return ur(l)
        ? `"${query}" nahi mila. Ye try karein: ${opts}`
        : `"${query}" not found. Try: ${opts}`;
    }
    return ur(l)
      ? `"${query}" available nahi. Koi aur item batayein.`
      : `"${query}" isn't available. Try another item.`;
  },

  itemList(l: Lang, items: Array<{ name: string; price: number }>, currency: string): string {
    if (items.length === 0) {
      return ur(l) ? "Menu abhi available nahi." : "Menu not available right now.";
    }
    return items.slice(0, 6).map((i) => `• ${i.name} — ${currency} ${i.price}`).join("\n");
  },

  info(_l: Lang, lines: string[]): string {
    return lines.join("\n");
  },

  recommendation(l: Lang, items: Array<{ name: string; price: number }>, currency: string): string {
    if (items.length === 0) {
      return ur(l) ? "Kya pasand hai aap ko? Main suggest karta hoon." : "What are you in the mood for? I'll suggest something.";
    }
    const list = items.slice(0, 4).map((i) => `• ${i.name} — ${currency} ${i.price}`).join("\n");
    return ur(l) ? `Popular picks:\n${list}` : `Popular picks:\n${list}`;
  },

  askOrderType(l: Lang): string {
    return ur(l)
      ? "Order kaise chahiye — Delivery, Pickup ya Dine-in?"
      : "How would you like your order — Delivery, Pickup, or Dine-in?";
  },

  askAddress(l: Lang): string {
    return ur(l)
      ? "📍 Delivery address bhej dein (gali, area, city)."
      : "📍 Please send your delivery address (street, area, city).";
  },

  askAddressWithSaved(l: Lang, savedLabel: string): string {
    return ur(l)
      ? `📍 Pichli dafa *${savedLabel}* use kiya tha — wahi chahiye ya naya?`
      : `📍 Last time you used *${savedLabel}* — same address or new one?`;
  },

  savedAddressConfirmed(l: Lang, address: string): string {
    return ur(l)
      ? `📍 *${address}* pe deliver karein ge.`
      : `📍 Delivering to *${address}*.`;
  },

  askDineIn(l: Lang): string {
    return ur(l)
      ? "Kitne log aur kis waqt? (misaal: 4 log, 8pm)"
      : "How many guests and what time? (e.g. 4 people, 8pm)";
  },

  askPickupTime(l: Lang): string {
    return ur(l) ? "Pickup kis waqt karenge?" : "What time will you pick up?";
  },

  summary(l: Lang, cart: CartItem[], orderType: OrderType | null, currency: string, address?: string | null): string {
    const itemLines = cart.map((i) => {
      const note = i.notes ? ` (${i.notes})` : "";
      return `• ${i.qty}x ${i.name} — ${currency} ${i.unit_price * i.qty}${note}`;
    });
    const total = `${currency} ${cartSubtotal(cart)}`;
    const typeLabel = orderType
      ? (orderType === "delivery" ? "🚚 Delivery" : orderType === "pickup" ? "🏃 Pickup" : "🍽️ Dine-in")
      : "";
    const head = ur(l) ? "🛒 Aap ka order:" : "🛒 Your order:";
    const lines = [head, ...itemLines];
    if (typeLabel) lines.push(typeLabel);
    if (address?.trim()) lines.push(`📍 ${address.trim()}`);
    lines.push(`💰 Total: ${total}`);
    return lines.join("\n");
  },

  orderPlaced(l: Lang, orderNumber: number, currency: string, total: number): string {
    return ur(l)
      ? `✅ Order #${orderNumber} confirm ho gaya!\n💰 Total: ${currency} ${total} (COD)\nJaldi taiyar ho jayega 🙏`
      : `✅ Order #${orderNumber} confirmed!\n💰 Total: ${currency} ${total} (Cash on Delivery)\nWe'll have it ready soon 🙏`;
  },

  orderCancelled(l: Lang): string {
    return ur(l) ? "Order cancel ho gaya." : "Your order has been cancelled.";
  },

  restarted(l: Lang): string {
    return ur(l) ? "Theek hai, naya order shuru karte hain. Kya chahiye?" : "Fresh start! What would you like?";
  },

  emptyCart(l: Lang): string {
    return ur(l) ? "Cart abhi khali hai. Kuch add karein pehle." : "Your cart is empty. Add something first.";
  },

  clarify(l: Lang, reason: string): string {
    if (reason === "which_option") {
      return ur(l) ? "Kaunsa wala chahiye? Number ya naam batayein." : "Which one? Give me the number or name.";
    }
    if (reason === "empty_cart") {
      return ur(l) ? "Cart khali hai — pehle kuch add karein." : "Nothing in cart yet — add something first.";
    }
    return ur(l)
      ? "Samajh nahi paya — thora aur wazahat se bata dein?"
      : "I didn't quite catch that — could you rephrase?";
  },

  closed(l: Lang, opening: string): string {
    return ur(l)
      ? `Hum abhi band hain. ${opening} ko khulein ge. Menu zaroor dekh saktay hain 😊`
      : `We're closed right now — we open at ${opening}. Feel free to browse the menu 😊`;
  },

  escalated(l: Lang): string {
    return ur(l)
      ? "Aap ko hamare staff se connect kar raha hoon — thori der mein jawab milega."
      : "Connecting you with our staff — someone will reply shortly.";
  },

  orderStatus(l: Lang, orderNumber: number, status: string): string {
    return ur(l)
      ? `Order #${orderNumber}: ${status}`
      : `Order #${orderNumber}: ${status}`;
  },

  noRecentOrder(l: Lang): string {
    return ur(l) ? "Koi recent order nahi mila." : "No recent order found.";
  },

  payment(l: Lang): string {
    return ur(l)
      ? "💵 Sirf Cash on Delivery (COD) available hai."
      : "💵 We only accept Cash on Delivery (COD).";
  },
};
