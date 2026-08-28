/**
 * lib/agent/reply.ts — Phase 7
 *
 * Renders localized WhatsApp replies (English / Roman Urdu) from action results.
 * Tone: friendly Pakistani restaurant staff — short, natural, one clear next step.
 * All customer-facing copy lives here (was scattered across order-engine).
 */
import type { CartItem, LanguagePreference, OrderType } from "@/lib/schema.types";
import { cartSubtotal } from "./cart";

type Lang = LanguagePreference;
const ur = (l: Lang) => l === "roman_urdu";

export const reply = {
  greeting(l: Lang, appName: string): string {
    return ur(l)
      ? `Assalam o Alaikum! ${appName} me khush aamdeed 😊 Kya order karna pasand karenge? *menu* likh kar items dekh sakte hain.`
      : `Hello! Welcome to ${appName} 😊 What would you like to order? Type *menu* to see our items.`;
  },

  itemsAdded(l: Lang, added: Array<{ name: string; qty: number }>, cart: CartItem[], currency: string): string {
    const list = added.map((i) => `${i.qty}x ${i.name}`).join(", ");
    const total = `${currency} ${cartSubtotal(cart)}`;
    return ur(l)
      ? `Add kar diya: ${list}. Ab tak total ${total}. Aur kuch? Warna checkout ke liye *done* likh dein.`
      : `Added: ${list}. Running total ${total}. Anything else? Or type *done* to check out.`;
  },

  itemsRemoved(l: Lang, cart: CartItem[], currency: string): string {
    if (cart.length === 0) {
      return ur(l) ? "Cart khali ho gaya. Kya add karna chahenge?" : "Your cart is empty now. What would you like to add?";
    }
    const total = `${currency} ${cartSubtotal(cart)}`;
    return ur(l) ? `Theek hai, update kar diya. Naya total ${total}.` : `Done, updated. New total ${total}.`;
  },

  notFound(l: Lang, query: string, suggestions: string[]): string {
    if (suggestions.length > 0) {
      const opts = suggestions.slice(0, 3).join(", ");
      return ur(l)
        ? `"${query}" to nahi mila. Ye milte-julte hain: ${opts}. Kaunsa chahiye?`
        : `Couldn't find "${query}". Did you mean: ${opts}? Which one?`;
    }
    return ur(l)
      ? `"${query}" menu me nahi hai. *menu* likh kar dekh lein ya koi aur item batayein.`
      : `"${query}" isn't on the menu. Type *menu* to browse, or tell me another item.`;
  },

  info(l: Lang, lines: string[]): string {
    return lines.join("\n");
  },

  recommendation(l: Lang, items: Array<{ name: string; price: number }>, currency: string): string {
    if (items.length === 0) {
      return ur(l) ? "Aap ko kis tarah ka khana pasand hai? Main suggest karta hoon." : "What kind of food do you feel like? I'll suggest something.";
    }
    const list = items.slice(0, 4).map((i) => `• ${i.name} — ${currency} ${i.price}`).join("\n");
    return ur(l) ? `Ye kaafi popular hain:\n${list}\n\nKoi try karna chahenge?` : `These are popular picks:\n${list}\n\nWant to try any?`;
  },

  askOrderType(l: Lang): string {
    return ur(l)
      ? "Order kaise chahiye — *delivery*, *pickup* ya *dine-in*?"
      : "How would you like your order — *delivery*, *pickup*, or *dine-in*?";
  },

  askAddress(l: Lang): string {
    return ur(l) ? "Delivery ke liye apna poora address bhej dein." : "Please share your full delivery address.";
  },

  askDineIn(l: Lang): string {
    return ur(l)
      ? "Kitne log aa rahe hain aur kis waqt? (e.g. 4 log, 8pm)"
      : "How many guests, and at what time? (e.g. 4 people, 8pm)";
  },

  askPickupTime(l: Lang): string {
    return ur(l) ? "Pickup kis waqt karenge?" : "What time will you pick up?";
  },

  summary(l: Lang, cart: CartItem[], orderType: OrderType | null, currency: string): string {
    const lines = cart.map((i) => `${i.qty}x ${i.name} — ${currency} ${i.unit_price * i.qty}`);
    const total = `${currency} ${cartSubtotal(cart)}`;
    const head = ur(l) ? "Aap ka order:" : "Your order:";
    const typeLine = orderType ? (ur(l) ? `Type: ${orderType}` : `Type: ${orderType}`) : "";
    const confirm = ur(l) ? "Confirm karne ke liye *haan* likh dein." : "Type *yes* to confirm.";
    return [head, ...lines, typeLine, `Total: ${total}`, "", confirm].filter(Boolean).join("\n");
  },

  orderPlaced(l: Lang, orderNumber: number, currency: string, total: number): string {
    return ur(l)
      ? `Shukriya! Aap ka order #${orderNumber} confirm ho gaya hai. Total ${currency} ${total} (COD). Jaldi taiyar ho jayega 🙏`
      : `Thank you! Order #${orderNumber} is confirmed. Total ${currency} ${total} (Cash on Delivery). It'll be ready soon 🙏`;
  },

  orderCancelled(l: Lang): string {
    return ur(l) ? "Aap ka order cancel kar diya gaya hai." : "Your order has been cancelled.";
  },

  restarted(l: Lang): string {
    return ur(l) ? "Theek hai, naya order shuru karte hain. Kya chahiye?" : "Okay, let's start a fresh order. What would you like?";
  },

  emptyCart(l: Lang): string {
    return ur(l) ? "Aap ka cart abhi khali hai. Pehle kuch add kar lein." : "Your cart is empty. Add something first.";
  },

  clarify(l: Lang, reason: string): string {
    if (reason === "which_option") {
      return ur(l) ? "Kaunsa wala? Number ya naam bata dein." : "Which one? Tell me the number or name.";
    }
    return ur(l)
      ? "Maazrat, samajh nahi paya. Thora wazahat se bata dein?"
      : "Sorry, I didn't quite get that. Could you say it a bit more clearly?";
  },

  payment(l: Lang): string {
    return ur(l)
      ? "Filhaal Cash on Delivery (COD) available hai. Online payment nahi lete."
      : "We currently accept Cash on Delivery (COD). No online payment needed.";
  },

  closed(l: Lang, opening: string): string {
    return ur(l)
      ? `Hum abhi band hain. ${opening} se orders shuru karte hain. *menu* dekh sakte hain.`
      : `We're closed right now. We start taking orders at ${opening}. You can still browse the *menu*.`;
  },

  escalated(l: Lang): string {
    return ur(l) ? "Main aap ko hamare staff se connect kar raha hoon, thori der me reply aayega." : "I'm connecting you with our staff — you'll hear back shortly.";
  },

  orderStatus(l: Lang, orderNumber: number, status: string): string {
    return ur(l) ? `Order #${orderNumber} ka status: ${status}.` : `Order #${orderNumber} status: ${status}.`;
  },

  noRecentOrder(l: Lang): string {
    return ur(l) ? "Koi recent order nahi mila." : "I couldn't find a recent order.";
  },
};
