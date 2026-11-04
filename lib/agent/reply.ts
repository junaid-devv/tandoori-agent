import { resolveDeliveryQuote } from "../delivery-pricing";
/**
 * lib/agent/reply.ts
 *
 * All customer-facing copy. One clear next step per reply. No double blank lines.
 * Tone: friendly Pakistani restaurant staff — short, warm, never robotic.
 */
import type { CartItem, LanguagePreference, OrderType } from "@/lib/schema.types";
import type { RestaurantSettings } from "@/lib/settings";
import type { OrderRow } from "@/lib/data/order.repo";
import { cartSubtotal } from "./cart";
import { normalizeFoodScript, isPakistaniReply } from "@/lib/pakistani-language";

type Lang = LanguagePreference;
const ur = (l: Lang) => l === "roman_urdu";

export const reply = {

  answerUnavailable(l: Lang): string {
    return ur(l) ? "Is sawal ka jawab abhi verify nahi kar pa raha. Dobara pooch lein ya staff se baat kar lein."
      : "I couldn't verify that answer right now. Please try again or ask to speak with staff.";
  },

  orderTiming(l: Lang, order: Pick<OrderRow, "order_number" | "status" | "type" | "created_at" | "pickup_time" | "reservation_time">, settings: RestaurantSettings): string {
    if (["cancelled", "delivered", "out_for_delivery"].includes(order.status)) {
      return reply.orderStatus(l, order.order_number, order.status);
    }
    const scheduled = order.type === "pickup" ? order.pickup_time : order.type === "dine-in" ? order.reservation_time : null;
    if (scheduled && Number.isFinite(Date.parse(scheduled))) {
      const time = new Intl.DateTimeFormat("en-GB", { timeZone: settings.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(scheduled));
      return `Order #${order.order_number} — ${order.type === "pickup" ? "Pickup" : "Dine-in"}: ${time}`;
    }
    const estimate = order.type === "delivery" ? settings.estimated_delivery_minutes : settings.estimated_prep_minutes;
    if (!Number.isFinite(estimate) || estimate <= 0) return reply.answerUnavailable(l);
    if (Date.now() - Date.parse(order.created_at) > estimate * 60_000) {
      return ur(l) ? `Order #${order.order_number}: pehle diya gaya andazay ka waqt guzar chuka hai. Naya arrival time abhi verify nahi hua.`
        : `Order #${order.order_number}: the original estimated window has passed. A revised arrival time has not been verified.`;
    }
    const service = order.type === "delivery" ? "delivery" : "preparation";
    return ur(l) ? `⏱ Order #${order.order_number}: confirmation se ${service} ka andaza ~${estimate} minutes hai.`
      : `⏱ Order #${order.order_number}: estimated ${service} is ~${estimate} minutes from confirmation.`;
  },

  catalogNotReady(l: Lang): string {
    return ur(l) ? "Menu ki items aur qeematein abhi verify nahi hui hain. Order ki details staff se check karwani hongi."
      : "The menu items and prices have not been verified yet. Staff will need to check the order details.";
  },

  greeting(l: Lang, appName: string, customerName?: string | null, wasSalam?: boolean): string {
    const isBusinessName =
      customerName &&
      /\b(restaurant|cafe|hotel|fast\s*food|point|corner|store|shop|bakers|bakery|traders|enterprises|services|official|ltd|pvt|co|company|mart|supermarket|dhabba|dhaba)\b/i.test(
        customerName,
      );
    const firstName = customerName && !isBusinessName ? customerName.split(" ")[0].trim() : "";
    const name = firstName ? ` ${firstName}` : "";

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

  itemsAdded(l: Lang, added: Array<{ name: string; newCartQty: number; notes?: string | null }>, cart: CartItem[], currency: string): string {
    const total = `${currency} ${cartSubtotal(cart)}`;
    if (added.length === 0) {
      return `🛒 Total: ${total}`;
    }
    const list = added.map((i) => {
      const noteStr = i.notes ? ` (Note: ${i.notes})` : "";
      return `${i.newCartQty}x ${i.name}${noteStr}`;
    }).join(", ");

    return ur(l)
      ? `✅ ${list} add ho gaya. Total: ${total}`
      : `✅ Added: ${list}. Total: ${total}`;
  },

  itemInstructionUpdated(l: Lang, itemName: string, note: string): string {

    return ur(l)
      ? `✅ *${itemName}* ke liye note save ho gaya: "${note}" 👍`
      : `✅ Special instruction saved for *${itemName}*: "${note}" 👍`;
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
    query = normalizeFoodScript(query);
    if (!isPakistaniReply(query)) query = ur(l) ? "Yeh item" : "That item";
    if (suggestions.length > 0) {
      const opts = suggestions.slice(0, 3).join(", ");

      return ur(l)
        ? `"${query}" ka exact match nahi mila. Kya ${opts} mein se koi chahiye?`
        : `I couldn't match "${query}". Would you like ${opts}?`;
    }
    if (categories && categories.length > 0) {

      return ur(l)
        ? `"${query}" ka match nahi mila. Item ka naam dobara bhej dein ya menu dekh lein.`
        : `I couldn't match "${query}". Please check the item name or view the menu.`;
    }

    return ur(l)
      ? `"${query}" ka match nahi mila. Naam dobara bhej dein ya menu dekh lein.`
      : `I couldn't match "${query}". Please check the name or view the menu.`;
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

  itemList(l: Lang, items: Array<{ name: string; price: number; description?: string | null; is_available?: boolean }>, currency: string, categoryName?: string): string {
    if (items.length === 0) {

      return ur(l) ? "Menu abhi available nahi." : "Menu not available right now.";
    }

    const isDealsCategory = categoryName
      ? /deal|box|combo/i.test(categoryName)
      : items.some((i) => /deal|box|combo/i.test(i.name));

    let list = "";
    if (isDealsCategory) {
      list = items.slice(0, 10).map((i) => {
        let breakdown = "";
        if (i.description) {
          const parts = i.description.split(/\s*\+\s*/).map((p) => p.trim()).filter(Boolean);
          if (parts.length > 1) {
            breakdown = "\n" + parts.map((p) => `   ▫️ ${p}`).join("\n");
          } else {
            breakdown = `\n   ▫️ ${i.description}`;
          }
        }
        const status = i.is_available === false ? (ur(l) ? " — Abhi available nahi" : " — Currently unavailable") : "";
        return `🏷️ *${i.name}* — ${currency} ${i.price}${status}${breakdown}`;
      }).join("\n\n");
    } else {
      list = items.slice(0, 10).map((i) => {
        const desc = i.description ? ` (${i.description})` : "";
        const status = i.is_available === false ? (ur(l) ? " — Abhi available nahi" : " — Currently unavailable") : "";
        return `• ${i.name} — ${currency} ${i.price}${desc}${status}`;
      }).join("\n");
    }

    const header = categoryName
      ? (isDealsCategory ? `🔥 *${categoryName.toUpperCase()}*:` : `*${categoryName.toUpperCase()}* items:`)
      : (ur(l) ? "Menu items:" : "Menu items:");
    const footer = isDealsCategory
      ? (ur(l) ? "Kaunsi deal mangwana chahenge?" : "Which deal would you like to order?")
      : (ur(l) ? "Kaunsa item mangwana chahenge?" : "Which item would you like to order?");
    return `${header}\n\n${list}\n\n${footer}`;
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
    return `Popular picks:\n${list}`;
  },

  askOrderType(l: Lang): string {

    return ur(l)
      ? "Order kaise chahiye — Delivery, Pickup ya Dine-in?"
      : "How would you like your order — Delivery, Pickup, or Dine-in?";
  },

  askAddress(l: Lang): string {

    return ur(l)
      ? "📍 Apna delivery address bhej dein."
      : "📍 Please send your delivery address.";
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

  askDineInTime(l: Lang, guests: number): string {

    return ur(l)
      ? `Theek hai, ${guests} log. Kis waqt tashreef layein ge? (misaal: 8:00 PM)`
      : `Got it, ${guests} guests. What time will you arrive? (e.g. 8:00 PM)`;
  },

  askDineInGuests(l: Lang, timeStr: string): string {
    const timeLabel = timeStr ? ` (${timeStr})` : "";

    return ur(l)
      ? `Theek hai${timeLabel}. Kitne log honge? (misaal: 4 log)`
      : `Got it${timeLabel}. How many guests will be joining? (e.g. 4 guests)`;
  },

  orderUpdated(l: Lang, orderNumber: number, orderType: OrderType, details?: string): string {
    const detailStr = details ? ` (${details})` : "";
    const typeLabel = orderType === "dine-in" ? "Dine-in" : orderType === "pickup" ? "Pickup" : "Delivery";

    return ur(l)
      ? `✅ Order #${orderNumber} update ho gaya: *${typeLabel}*${detailStr}.\nHamare staff ko notify kar diya gaya hai! 🙏`
      : `✅ Order #${orderNumber} has been updated to *${typeLabel}*${detailStr}.\nOur kitchen and staff have been notified! 🙏`;
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
    details?: { guests?: number | null; reservation_time?: string | null; pickup_time?: string | null; customer_instructions?: string | null },
  ): string {
    const itemLines = cart.map((i) => {
      const note = [i.notes, ...(i.addons ?? [])].filter(Boolean).join("; ");
      return `• ${i.qty}x ${i.name} — ${currency} ${i.unit_price * i.qty}${note ? ` (${note})` : ""}`;
    });
    const subtotal = cartSubtotal(cart);
    const head = ur(l) ? "🛒 Aap ka order:" : "🛒 Your order:";
    const lines = [head, ...itemLines];

    if (orderType === "delivery") {
      if (address?.trim()) lines.push(`📍 ${address.trim()}`);
      const quote = settings ? resolveDeliveryQuote(address, settings) : null;
      const deliveryFee = settings && settings.delivery_enabled !== false ? quote?.fee ?? null : 0;
      if (deliveryFee === null) {
        lines.push(`🛵 Delivery fee: pending area confirmation`, `Subtotal: ${currency} ${subtotal}`);
        return lines.join("\n");
      }
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

    const time = details?.pickup_time ?? details?.reservation_time;
    if (time) {
      const date = new Date(time);
      if (Number.isFinite(date.getTime())) lines.push(`🕐 ${new Intl.DateTimeFormat("en-PK", { timeZone: settings?.timezone || "Asia/Karachi", dateStyle: "medium", timeStyle: "short" }).format(date)}`);
    }
    if (orderType === "dine-in" && details?.guests) lines.push(`👥 ${details.guests}`);
    if (details?.customer_instructions) lines.push(`📝 ${details.customer_instructions}`);
    return lines.join("\n");
  },

  orderPlaced(
    l: Lang,
    orderNumber: number | string,
    currency: string,
    total: number,
    orderType?: OrderType | null,
    settings?: RestaurantSettings | null,
  ): string {
    const estDelivery = Math.round(Number(settings?.estimated_delivery_minutes) || 45);

    if (orderType === "delivery") {

      return ur(l)
        ? `✅ Order #${orderNumber} confirm ho gaya!\n💰 Total: ${currency} ${total} (COD)\n🛵 Delivery: takreeban ${estDelivery} min\n📍 Rider ki asani ke liye WhatsApp par apni current location ka pin bhej dein.`
        : `✅ Order #${orderNumber} confirmed!\n💰 Total: ${currency} ${total} (Cash on Delivery)\n🛵 Estimated delivery: ~${estDelivery} mins\n📍 Please share your current location pin on WhatsApp to help the rider.`;
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
      ? "Aap kya mangwana chahenge? Item ka naam aur quantity bhej dein, ya menu dekh lein."
      : "What would you like to order? Send the item name and quantity, or view the menu.";
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

  orderStatus(l: Lang, orderNumber: number, status: string, _estimatedDeliveryMinutes?: number | null): string {
    const s = (status || "").toLowerCase();
    const isUr = ur(l);

    if (s === "pending" || s === "received") {

      return isUr
        ? `Order #${orderNumber} confirm hai. Staff ne abhi preparation ya delivery ka naya status nahi diya.`
        : `Order #${orderNumber} is confirmed. Staff have not posted a preparation or delivery update yet.`;
    }
    if (s === "preparing" || s === "in_prep" || s === "cooking" || s === "confirmed") {

      return isUr
        ? `Aap ka Order #${orderNumber} kitchen mein ban raha hai. Jald deliver hoga! 🍳`
        : `Your Order #${orderNumber} is actively being prepared in the kitchen. Will be dispatched shortly! 🍳`;
    }
    if (s === "dispatched" || s === "out_for_delivery" || s === "on_the_way") {

      return isUr
        ? `Aap ka Order #${orderNumber} rider ke pas hai aur deliver hone ke liye raste mein hai! 🛵`
        : `Your Order #${orderNumber} is on the way with our rider! 🛵`;
    }
    if (s === "delivered" || s === "completed") {

      return isUr
        ? `Aap ka Order #${orderNumber} deliver ho chuka hai. Umeed hai aap ko khana pasand aya hoga! Bohat shukriya ❤️`
        : `Your Order #${orderNumber} has been delivered. We hope you enjoy your meal! ❤️`;
    }
    if (s === "cancelled") {

      return isUr
        ? `Aap ka Order #${orderNumber} cancel ho chuka hai.`
        : `Your Order #${orderNumber} was cancelled.`;
    }

    return isUr
      ? `Order #${orderNumber} ka recorded status: *${status}*. Naya update staff se check kar lein.`
      : `Order #${orderNumber} has recorded status: *${status}*. Please check with staff for an update.`;
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
    const list = areas.length
      ? `\nHum deliver karte hain: ${areas.join(", ")}`
      : "";

    return ur(l)
      ? `Maafi — ye address hamare delivery area mein nahi hai.${list}\nDoosra address bhejein ya Pickup choose karein.`
      : `Sorry — that address isn't in our delivery zone.${list}\nPlease send an address in our delivery area or choose Pickup.`;
  },

  menuPictureInvite(l: Lang, appName: string): string {

    if (ur(l))
      return `Yeh raha ${appName} ka menu aur deals! 🍔✨ Tasweer dekh kar batayein kya order karna hai.`;
    return `Here is the ${appName} menu & deals! 🍔✨ Take a look and let us know what you'd like to order.`;
  },

  askAddMore(l: Lang): string {

    if (ur(l)) return "Aur kya add karna hai? Batayein! 😊";
    return "What would you like to add? 😊";
  },
};
