/**
 * lib/agent/reply.ts
 *
 * All customer-facing copy. One clear next step per reply. No double blank lines.
 * Tone: friendly Pakistani restaurant staff — short, warm, never robotic.
 */
import type { CartItem, LanguagePreference, OrderType } from "@/lib/schema.types";
import type { RestaurantSettings } from "@/lib/settings";
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

  smalltalk(l: Lang, stage?: string): string {
    if (stage === "placed") {
      return ur(l)
        ? "Bohat shukriya! ❤️ Aap ka order jald tayyar ho jayega. Koi aur cheez chahiye ho toh zaroor batayein!"
        : "You're most welcome! ❤️ Your order will be prepared shortly. Let us know if you need anything else!";
    }
    return ur(l)
      ? "Jee zaroor! 😊 Hum aap ki khidmat ke liye hazir hain. Kya order karna chahenge?"
      : "Always happy to help! 😊 What would you like to order?";
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

  notFound(l: Lang, query: string, suggestions: string[], categories?: string[]): string {
    if (suggestions.length > 0) {
      const opts = suggestions.slice(0, 3).join(", ");
      return ur(l)
        ? `"${query}" nahi mila. Ye try karein: ${opts}`
        : `"${query}" not found. Try: ${opts}`;
    }
    if (categories && categories.length > 0) {
      const catList = categories.slice(0, 5).join(", ");
      return ur(l)
        ? `"${query}" hamare menu mein available nahi hai. Hamare pas ${catList} items available hain.\nAap kya mangwana chahenge?`
        : `"${query}" is not available on our menu. We specialize in ${catList}.\nWhat would you like to order?`;
    }
    return ur(l)
      ? `"${query}" hamare menu mein available nahi hai. Aap menu dekhna chahenge?`
      : `"${query}" isn't on our menu. Would you like to view the menu?`;
  },

  itemUnavailable(l: Lang, name: string): string {
    return ur(l)
      ? `Maaf kijiyega, *${name}* abhi available nahi hai (out of stock).`
      : `Sorry, *${name}* is currently out of stock.`;
  },

  itemVariants(l: Lang, baseName: string, variants: Array<{ name: string; price: number }>, currency: string): string {
    const list = variants.map((v) => `• ${v.name} — ${currency} ${v.price}`).join("\n");
    return ur(l)
      ? `*${baseName}* ke multiple options available hain:\n${list}\nKaunsa size / option chahiye?`
      : `*${baseName}* comes in multiple options:\n${list}\nWhich size / option would you like?`;
  },

  ambiguousMatches(l: Lang, query: string, matches: Array<{ name: string; price: number }>, currency: string): string {
    const list = matches.slice(0, 5).map((m) => `• ${m.name} — ${currency} ${m.price}`).join("\n");
    return ur(l)
      ? `"${query}" mein ye options available hain:\n${list}\nKaunsi wali mangwana chahenge?`
      : `Here are our "${query}" options:\n${list}\nWhich one would you like to order?`;
  },

  itemList(l: Lang, items: Array<{ name: string; price: number; description?: string | null }>, currency: string, categoryName?: string): string {
    if (items.length === 0) {
      return ur(l) ? "Menu abhi available nahi." : "Menu not available right now.";
    }
    const list = items.slice(0, 10).map((i) => {
      const desc = i.description ? ` (${i.description})` : "";
      return `• ${i.name} — ${currency} ${i.price}${desc}`;
    }).join("\n");
    const header = categoryName
      ? `*${categoryName.toUpperCase()}* items:`
      : (ur(l) ? "Menu items:" : "Menu items:");
    const footer = ur(l) ? "Kaunsa item mangwana chahenge?" : "Which item would you like to order?";
    return `${header}\n${list}\n\n${footer}`;
  },

  categoryList(l: Lang, categories: string[]): string {
    const list = categories.map((c) => `• ${c}`).join("\n");
    return ur(l)
      ? `Hamare menu categories:\n${list}\nKaunsi category dekhna chahenge?`
      : `Our menu categories:\n${list}\nWhich category would you like to explore?`;
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

  summary(
    l: Lang,
    cart: CartItem[],
    orderType: OrderType | null,
    currency: string,
    address?: string | null,
    settings?: RestaurantSettings | null,
  ): string {
    const itemLines = cart.map((i) => {
      const note = i.notes ? ` (${i.notes})` : "";
      return `• ${i.qty}x ${i.name} — ${currency} ${i.unit_price * i.qty}${note}`;
    });
    const subtotal = cartSubtotal(cart);
    const head = ur(l) ? "🛒 Aap ka order:" : "🛒 Your order:";
    const lines = [head, ...itemLines];

    if (orderType === "delivery") {
      if (address?.trim()) lines.push(`📍 ${address.trim()}`);
      const deliveryFee = settings && settings.delivery_enabled !== false ? Number(settings.delivery_fee) || 0 : 0;
      const total = subtotal + deliveryFee;

      if (deliveryFee > 0) {
        lines.push(`🛵 Delivery Fee: ${currency} ${deliveryFee}`);
      } else {
        lines.push(ur(l) ? "🛵 Delivery: Muft" : "🛵 Delivery: Free");
      }

      lines.push(`💰 Total: ${currency} ${total} (COD)`);

      if (settings?.min_delivery_amount && subtotal < settings.min_delivery_amount) {
        const diff = settings.min_delivery_amount - subtotal;
        lines.push(
          ur(l)
            ? `⚠️ Delivery minimum order ${currency} ${settings.min_delivery_amount} hai (${currency} ${diff} mazeed add karein ya Pickup choose karein)`
            : `⚠️ Minimum delivery order is ${currency} ${settings.min_delivery_amount} (add ${currency} ${diff} more or choose Pickup)`,
        );
      }

      const estDelivery = Math.round(Number(settings?.estimated_delivery_minutes) || 45);
      lines.push(ur(l) ? `⏱ Delivery: ~${estDelivery} min` : `⏱ Delivery: ~${estDelivery} min`);
    } else if (orderType === "pickup") {
      lines.push("🏃 Pickup");
      lines.push(`💰 Total: ${currency} ${subtotal} (COD)`);
    } else if (orderType === "dine-in") {
      lines.push("🍽️ Dine-in");
      lines.push(`💰 Total: ${currency} ${subtotal} (COD)`);
    } else {
      lines.push(`💰 Total: ${currency} ${subtotal}`);
    }

    return lines.join("\n");
  },

  orderPlaced(
    l: Lang,
    orderNumber: number,
    currency: string,
    total: number,
    orderType?: OrderType | null,
    settings?: RestaurantSettings | null,
  ): string {
    const estDelivery = Math.round(Number(settings?.estimated_delivery_minutes) || 45);

    if (orderType === "delivery") {
      return ur(l)
        ? `✅ Order #${orderNumber} confirm ho gaya!\n💰 Total: ${currency} ${total} (COD)\n🛵 Delivery: takreeban ${estDelivery} min\nShukriya! 🙏`
        : `✅ Order #${orderNumber} confirmed!\n💰 Total: ${currency} ${total} (Cash on Delivery)\n🛵 Estimated delivery: ~${estDelivery} mins\nThank you! 🙏`;
    }

    if (orderType === "pickup") {
      return ur(l)
        ? `✅ Order #${orderNumber} confirm ho gaya!\n💰 Total: ${currency} ${total}\nShukriya! 🙏`
        : `✅ Order #${orderNumber} confirmed!\n💰 Total: ${currency} ${total}\nThank you! 🙏`;
    }

    if (orderType === "dine-in") {
      return ur(l)
        ? `✅ Reservation & Order #${orderNumber} confirm ho gaya!\n💰 Total: ${currency} ${total}\nHum aap ka intezar karenge! 🙏`
        : `✅ Reservation & Order #${orderNumber} confirmed!\n💰 Total: ${currency} ${total}\nLooking forward to serving you! 🙏`;
    }

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
    if (reason === "affirm_no_context") {
      return ur(l)
        ? "Jee zaroor! 😊 Kya mangwana chahenge? Menu dekhna chahenge ya direct order batayein?"
        : "Sure! 😊 What would you like to order today?";
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

  deliveryDisabled(l: Lang): string {
    return ur(l)
      ? "Maafi chahte hain, is waqt delivery service band hai. Aap Pickup ya Dine-in choose kar saktay hain."
      : "Sorry, delivery is currently unavailable for this branch. Please choose Pickup or Dine-in.";
  },

  minDeliveryNotMet(l: Lang, currentSubtotal: number, minDelivery: number, currency: string): string {
    const diff = minDelivery - currentSubtotal;
    return ur(l)
      ? `⚠️ Delivery ke liye minimum order ${currency} ${minDelivery} hai (Aap ka cart ${currency} ${currentSubtotal} hai).\nBaraye meherbani ${currency} ${diff} ka mazeed item add karein ya Pickup choose karein.`
      : `⚠️ Minimum order for delivery is ${currency} ${minDelivery} (your current cart is ${currency} ${currentSubtotal}).\nPlease add ${currency} ${diff} more to your order or choose Pickup.`;
  },

  deliveryAreaNotCovered(l: Lang, areas: string[]): string {
    const list = areas.length ? `\nHum deliver karte hain: ${areas.join(", ")}` : "";
    return ur(l)
      ? `Maafi — ye address hamare delivery area mein nahi hai.${list}\nDoosra address bhejein ya Pickup choose karein.`
      : `Sorry — that address isn't in our delivery zone.${list}\nPlease send an address in our delivery area or choose Pickup.`;
  },
};
