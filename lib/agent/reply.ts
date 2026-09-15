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
const pa = (l: Lang) => l === "pashto";

export const reply = {

  greeting(l: Lang, appName: string, customerName?: string | null, wasSalam?: boolean): string {
    const isBusinessName =
      customerName &&
      /\b(restaurant|cafe|hotel|fast\s*food|point|corner|store|shop|bakers|bakery|traders|enterprises|services|official|ltd|pvt|co|company|mart|supermarket|dhabba|dhaba)\b/i.test(
        customerName,
      );
    const firstName = customerName && !isBusinessName ? customerName.split(" ")[0].trim() : "";
    const name = firstName ? ` ${firstName}` : "";
    if (pa(l)) {
      const sal = wasSalam ? "Walaikum Assalam!" : "Stare mashay!";
      return `${sal}${name} 😊 *${appName}* ta khush raghlay!\nNan tse order kawal ghwaaray?`;
    }
    if (ur(l)) {
      const sal = wasSalam ? "Walaikum Assalam!" : "Assalam o Alaikum!";
      return `${sal}${name} 😊 *${appName}* mein khush aamdeed!\nAaj kya order karein ge?`;
    }
    const sal = wasSalam ? "Walaikum Assalam!" : "Hello!";
    return `${sal}${name} 😊 Welcome to *${appName}*!\nWhat would you like today?`;
  },

  smalltalk(l: Lang, stage?: string): string {
    if (stage === "placed") {
      if (pa(l)) {
        return "Dera manana! ❤️ Staso order ba jald tayar shi. Ka nor tse pakaar wi no zaroor wayast!";
      }
      return ur(l)
        ? "Bohat shukriya! ❤️ Aap ka order jald tayyar ho jayega. Koi aur cheez chahiye ho toh zaroor batayein!"
        : "You're most welcome! ❤️ Your order will be prepared shortly. Let us know if you need anything else!";
    }
    if (pa(l)) {
      return "Ao zaroor! 😊 Mung staso khidmat dapara hazir yu. Tse order kawal ghwaaray?";
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
    if (pa(l)) {
      return `✅ ${list} add sho. Total: ${total}`;
    }
    return ur(l)
      ? `✅ ${list} add ho gaya. Total: ${total}`
      : `✅ Added: ${list}. Total: ${total}`;
  },

  itemInstructionUpdated(l: Lang, itemName: string, note: string): string {
    if (pa(l)) {
      return `✅ *${itemName}* dapara note save sho: "${note}" 👍`;
    }
    return ur(l)
      ? `✅ *${itemName}* ke liye note save ho gaya: "${note}" 👍`
      : `✅ Special instruction saved for *${itemName}*: "${note}" 👍`;
  },

  cartUpdated(l: Lang, cart: CartItem[], currency: string): string {
    const total = `${currency} ${cartSubtotal(cart)}`;
    if (pa(l)) {
      return `✅ Cart update sho. Total: ${total}`;
    }
    return ur(l)
      ? `✅ Cart update ho gaya. Total: ${total}`
      : `✅ Cart updated. Total: ${total}`;
  },

  itemsRemoved(l: Lang, cart: CartItem[], currency: string): string {
    if (cart.length === 0) {
      if (pa(l)) return "Cart khali sho. Tse add kawal ghwaaray?";
      return ur(l) ? "Cart khali ho gaya. Kya add karna chahenge?" : "Cart is now empty. Add something?";
    }
    const total = `${currency} ${cartSubtotal(cart)}`;
    if (pa(l)) return `Kha, remove sho. Total: ${total}`;
    return ur(l) ? `Theek hai, remove ho gaya. Total: ${total}` : `Done. Total: ${total}`;
  },

  notFound(l: Lang, query: string, suggestions: string[], categories?: string[]): string {
    if (suggestions.length > 0) {
      const opts = suggestions.slice(0, 3).join(", ");
      if (pa(l)) return `"${query}" wane-munde sho. Da koshish kra: ${opts}`;
      return ur(l)
        ? `"${query}" nahi mila. Ye try karein: ${opts}`
        : `"${query}" not found. Try: ${opts}`;
    }
    if (categories && categories.length > 0) {
      const catList = categories.slice(0, 5).join(", ");
      if (pa(l)) {
        return `"${query}" zmong menu ke nishta. Zmong sara da ${catList} items shta.\nTse order kawal ghwaaray?`;
      }
      return ur(l)
        ? `"${query}" hamare menu mein available nahi hai. Hamare pas ${catList} items available hain.\nAap kya mangwana chahenge?`
        : `"${query}" is not available on our menu. We specialize in ${catList}.\nWhat would you like to order?`;
    }
    if (pa(l)) return `"${query}" zmong menu ke nishta. Menu leedal ghwaaray?`;
    return ur(l)
      ? `"${query}" hamare menu mein available nahi hai. Aap menu dekhna chahenge?`
      : `"${query}" isn't on our menu. Would you like to view the menu?`;
  },

  itemUnavailable(l: Lang, name: string): string {
    if (pa(l)) return `Bakhana ghwaarom, *${name}* da wakht nishta (out of stock).`;
    return ur(l)
      ? `Maaf kijiyega, *${name}* abhi available nahi hai (out of stock).`
      : `Sorry, *${name}* is currently out of stock.`;
  },

  itemVariants(l: Lang, baseName: string, variants: Array<{ name: string; price: number }>, currency: string): string {
    const list = variants.map((v) => `• ${v.name} — ${currency} ${v.price}`).join("\n");
    if (pa(l)) {
      return `*${baseName}* ke der options shta:\n${list}\nKam size / option ghwaaray?`;
    }
    return ur(l)
      ? `*${baseName}* ke multiple options available hain:\n${list}\nKaunsa size / option chahiye?`
      : `*${baseName}* comes in multiple options:\n${list}\nWhich size / option would you like?`;
  },

  ambiguousMatches(l: Lang, query: string, matches: Array<{ name: string; price: number }>, currency: string): string {
    const list = matches.slice(0, 5).map((m) => `• ${m.name} — ${currency} ${m.price}`).join("\n");
    if (pa(l)) {
      return `"${query}" ke da options shta:\n${list}\nKam yaw order kawal ghwaaray?`;
    }
    return ur(l)
      ? `"${query}" mein ye options available hain:\n${list}\nKaunsi wali mangwana chahenge?`
      : `Here are our "${query}" options:\n${list}\nWhich one would you like to order?`;
  },

  itemList(l: Lang, items: Array<{ name: string; price: number; description?: string | null }>, currency: string, categoryName?: string): string {
    if (items.length === 0) {
      if (pa(l)) return "Menu da wakht nishta.";
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
          const parts = i.description.split(/,\s*|\s*\+\s*/).map((p) => p.trim()).filter(Boolean);
          if (parts.length > 1) {
            breakdown = "\n" + parts.map((p) => `   ▫️ ${p}`).join("\n");
          } else {
            breakdown = `\n   ▫️ ${i.description}`;
          }
        }
        return `🏷️ *${i.name}* — ${currency} ${i.price}${breakdown}`;
      }).join("\n\n");
    } else {
      list = items.slice(0, 10).map((i) => {
        const desc = i.description ? ` (${i.description})` : "";
        return `• ${i.name} — ${currency} ${i.price}${desc}`;
      }).join("\n");
    }

    const header = categoryName
      ? (isDealsCategory ? `🔥 *${categoryName.toUpperCase()}*:` : `*${categoryName.toUpperCase()}* items:`)
      : (pa(l) || ur(l) ? "Menu items:" : "Menu items:");
    const footer = isDealsCategory
      ? (pa(l) ? "Kuma deal order kawal ghwaaray?" : ur(l) ? "Kaunsi deal mangwana chahenge?" : "Which deal would you like to order?")
      : (pa(l) ? "Kam item order kawal ghwaaray?" : ur(l) ? "Kaunsa item mangwana chahenge?" : "Which item would you like to order?");
    return `${header}\n\n${list}\n\n${footer}`;
  },

  categoryList(l: Lang, categories: string[]): string {
    const list = categories.map((c) => `• ${c}`).join("\n");
    if (pa(l)) {
      return `Zmong menu categories:\n${list}\nKuma category leedal ghwaaray?`;
    }
    return ur(l)
      ? `Hamare menu categories:\n${list}\nKaunsi category dekhna chahenge?`
      : `Our menu categories:\n${list}\nWhich category would you like to explore?`;
  },

  info(_l: Lang, lines: string[]): string {
    return lines.join("\n");
  },

  recommendation(l: Lang, items: Array<{ name: string; price: number }>, currency: string): string {
    if (items.length === 0) {
      if (pa(l)) return "Tse khorak de khwakh day? Za darte suggest kawom.";
      return ur(l) ? "Kya pasand hai aap ko? Main suggest karta hoon." : "What are you in the mood for? I'll suggest something.";
    }
    const list = items.slice(0, 4).map((i) => `• ${i.name} — ${currency} ${i.price}`).join("\n");
    return `Popular picks:\n${list}`;
  },

  askOrderType(l: Lang): string {
    if (pa(l)) {
      return "Order tsanga ghwaaray — Delivery, Pickup ya Dine-in?";
    }
    return ur(l)
      ? "Order kaise chahiye — Delivery, Pickup ya Dine-in?"
      : "How would you like your order — Delivery, Pickup, or Dine-in?";
  },

  askAddress(l: Lang): string {
    if (pa(l)) {
      return "📍 Da delivery address rawalegay (kosa, area, city).";
    }
    return ur(l)
      ? "📍 Delivery address bhej dein (gali, area, city)."
      : "📍 Please send your delivery address (street, area, city).";
  },

  askAddressWithSaved(l: Lang, savedLabel: string): string {
    if (pa(l)) {
      return `📍 Ter zaal de *${savedLabel}* istemaal kare wo — hagha pata pakaar da ka naway?`;
    }
    return ur(l)
      ? `📍 Pichli dafa *${savedLabel}* use kiya tha — wahi chahiye ya naya?`
      : `📍 Last time you used *${savedLabel}* — same address or new one?`;
  },

  savedAddressConfirmed(l: Lang, address: string): string {
    if (pa(l)) {
      return `📍 *${address}* ta ba deliver kro.`;
    }
    return ur(l)
      ? `📍 *${address}* pe deliver karein ge.`
      : `📍 Delivering to *${address}*.`;
  },

  askDineIn(l: Lang): string {
    if (pa(l)) {
      return "Tsomra kasan ao pa tsawalo baje? (misaal: 4 kasan, 8pm)";
    }
    return ur(l)
      ? "Kitne log aur kis waqt? (misaal: 4 log, 8pm)"
      : "How many guests and what time? (e.g. 4 people, 8pm)";
  },

  askDineInTime(l: Lang, guests: number): string {
    if (pa(l)) {
      return `Kha, ${guests} kasan. Tsawalo baje ba raazay? (misaal: 8:00 PM)`;
    }
    return ur(l)
      ? `Theek hai, ${guests} log. Kis waqt tashreef layein ge? (misaal: 8:00 PM)`
      : `Got it, ${guests} guests. What time will you arrive? (e.g. 8:00 PM)`;
  },

  askDineInGuests(l: Lang, timeStr: string): string {
    const timeLabel = timeStr ? ` (${timeStr})` : "";
    if (pa(l)) {
      return `Kha${timeLabel}. Tsomra kasan ba yast? (misaal: 4 kasan)`;
    }
    return ur(l)
      ? `Theek hai${timeLabel}. Kitne log honge? (misaal: 4 log)`
      : `Got it${timeLabel}. How many guests will be joining? (e.g. 4 guests)`;
  },

  orderUpdated(l: Lang, orderNumber: number, orderType: OrderType, details?: string): string {
    const detailStr = details ? ` (${details})` : "";
    const typeLabel = orderType === "dine-in" ? "Dine-in" : orderType === "pickup" ? "Pickup" : "Delivery";
    if (pa(l)) {
      return `✅ Order #${orderNumber} update sho: *${typeLabel}*${detailStr}.\nStaff ta khabar warkare sho! 🙏`;
    }
    return ur(l)
      ? `✅ Order #${orderNumber} update ho gaya: *${typeLabel}*${detailStr}.\nHamare staff ko notify kar diya gaya hai! 🙏`
      : `✅ Order #${orderNumber} has been updated to *${typeLabel}*${detailStr}.\nOur kitchen and staff have been notified! 🙏`;
  },

  askPickupTime(l: Lang): string {
    if (pa(l)) return "Pickup ba tsawalo baje kaway?";
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
    const head = pa(l) ? "🛒 Staso order:" : ur(l) ? "🛒 Aap ka order:" : "🛒 Your order:";
    const lines = [head, ...itemLines];

    if (orderType === "delivery") {
      if (address?.trim()) lines.push(`📍 ${address.trim()}`);
      const deliveryFee = settings && settings.delivery_enabled !== false ? Number(settings.delivery_fee) || 0 : 0;
      const total = subtotal + deliveryFee;

      if (deliveryFee > 0) {
        lines.push(`🛵 Delivery Fee: ${currency} ${deliveryFee}`);
      } else {
        lines.push(pa(l) || ur(l) ? "🛵 Delivery: Muft" : "🛵 Delivery: Free");
      }

      lines.push(`💰 Total: ${currency} ${total} (COD)`);

      if (settings?.min_delivery_amount && subtotal < settings.min_delivery_amount) {
        const diff = settings.min_delivery_amount - subtotal;
        lines.push(
          pa(l)
            ? `⚠️ Delivery minimum order ${currency} ${settings.min_delivery_amount} day (${currency} ${diff} nor add kra ya Pickup select kra)`
            : ur(l)
            ? `⚠️ Delivery minimum order ${currency} ${settings.min_delivery_amount} hai (${currency} ${diff} mazeed add karein ya Pickup choose karein)`
            : `⚠️ Minimum delivery order is ${currency} ${settings.min_delivery_amount} (add ${currency} ${diff} more or choose Pickup)`,
        );
      }

      const estDelivery = Math.round(Number(settings?.estimated_delivery_minutes) || 45);
      lines.push(pa(l) || ur(l) ? `⏱ Delivery: ~${estDelivery} min` : `⏱ Delivery: ~${estDelivery} min`);
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
      if (pa(l)) {
        return `✅ Order #${orderNumber} confirm sho!\n💰 Total: ${currency} ${total} (COD)\n🛵 Delivery: takreeban ${estDelivery} min\nManana! 🙏`;
      }
      return ur(l)
        ? `✅ Order #${orderNumber} confirm ho gaya!\n💰 Total: ${currency} ${total} (COD)\n🛵 Delivery: takreeban ${estDelivery} min\nShukriya! 🙏`
        : `✅ Order #${orderNumber} confirmed!\n💰 Total: ${currency} ${total} (Cash on Delivery)\n🛵 Estimated delivery: ~${estDelivery} mins\nThank you! 🙏`;
    }

    if (orderType === "pickup") {
      if (pa(l)) {
        return `✅ Order #${orderNumber} confirm sho!\n💰 Total: ${currency} ${total}\nManana! 🙏`;
      }
      return ur(l)
        ? `✅ Order #${orderNumber} confirm ho gaya!\n💰 Total: ${currency} ${total}\nShukriya! 🙏`
        : `✅ Order #${orderNumber} confirmed!\n💰 Total: ${currency} ${total}\nThank you! 🙏`;
    }

    if (orderType === "dine-in") {
      if (pa(l)) {
        return `✅ Reservation & Order #${orderNumber} confirm sho!\n💰 Total: ${currency} ${total}\nStaso intezaar ba kawo! 🙏`;
      }
      return ur(l)
        ? `✅ Reservation & Order #${orderNumber} confirm ho gaya!\n💰 Total: ${currency} ${total}\nHum aap ka intezar karenge! 🙏`
        : `✅ Reservation & Order #${orderNumber} confirmed!\n💰 Total: ${currency} ${total}\nLooking forward to serving you! 🙏`;
    }

    if (pa(l)) {
      return `✅ Order #${orderNumber} confirm sho!\n💰 Total: ${currency} ${total} (COD)\nJald ba tayar shi 🙏`;
    }
    return ur(l)
      ? `✅ Order #${orderNumber} confirm ho gaya!\n💰 Total: ${currency} ${total} (COD)\nJaldi taiyar ho jayega 🙏`
      : `✅ Order #${orderNumber} confirmed!\n💰 Total: ${currency} ${total} (Cash on Delivery)\nWe'll have it ready soon 🙏`;
  },

  orderCancelled(l: Lang): string {
    if (pa(l)) return "Order cancel sho.";
    return ur(l) ? "Order cancel ho gaya." : "Your order has been cancelled.";
  },

  restarted(l: Lang): string {
    if (pa(l)) return "Kha, naway order shuru kawo. Tse pakaar di?";
    return ur(l) ? "Theek hai, naya order shuru karte hain. Kya chahiye?" : "Fresh start! What would you like?";
  },

  emptyCart(l: Lang): string {
    if (pa(l)) return "Cart da wakht khali day. Awal tse add kra.";
    return ur(l) ? "Cart abhi khali hai. Kuch add karein pehle." : "Your cart is empty. Add something first.";
  },

  clarify(l: Lang, reason: string): string {
    if (reason === "which_option") {
      if (pa(l)) return "Kam yaw pakaar day? Number ya num rawalega.";
      return ur(l) ? "Kaunsa wala chahiye? Number ya naam batayein." : "Which one? Give me the number or name.";
    }
    if (reason === "empty_cart") {
      if (pa(l)) return "Cart khali day — awal tse add kra.";
      return ur(l) ? "Cart khali hai — pehle kuch add karein." : "Nothing in cart yet — add something first.";
    }
    if (reason === "affirm_no_context") {
      if (pa(l)) {
        return "Ao zaroor! 😊 Tse order kawal ghwaaray? Menu goraay ka direct order wayast?";
      }
      return ur(l)
        ? "Jee zaroor! 😊 Kya mangwana chahenge? Menu dekhna chahenge ya direct order batayein?"
        : "Sure! 😊 What would you like to order today?";
    }
    if (pa(l)) return "Poh na shom — thora wazahat sara ba owast?";
    return ur(l)
      ? "Samajh nahi paya — thora aur wazahat se bata dein?"
      : "I didn't quite catch that — could you rephrase?";
  },

  closed(l: Lang, opening: string): string {
    if (pa(l)) {
      return `Mung da wakht band yu. ${opening} ba khalas yu. Menu leedalayshay 😊`;
    }
    return ur(l)
      ? `Hum abhi band hain. ${opening} ko khulein ge. Menu zaroor dekh saktay hain 😊`
      : `We're closed right now — we open at ${opening}. Feel free to browse the menu 😊`;
  },

  escalated(l: Lang): string {
    if (pa(l)) {
      return "Taso da staff sara connect kawom — lagya ba jawab darshi.";
    }
    return ur(l)
      ? "Aap ko hamare staff se connect kar raha hoon — thori der mein jawab milega."
      : "Connecting you with our staff — someone will reply shortly.";
  },

  orderStatus(l: Lang, orderNumber: number, status: string, estimatedDeliveryMinutes?: number | null): string {
    const s = (status || "").toLowerCase();
    const isUr = ur(l);
    const isPa = pa(l);
    const est = Math.round(Number(estimatedDeliveryMinutes) || 45);

    if (s === "pending" || s === "received") {
      if (isPa) {
        return `Staso Order #${orderNumber} receive sho ao kitchen ke tayarigi. Aam taur ~${est} minutes ke deliver kegi! 🍳🛵`;
      }
      return isUr
        ? `Aap ka Order #${orderNumber} receive ho chuka hai aur kitchen mein tayyar ho raha hai. Aam tor par ~${est} minutes mein deliver hota hai! 🍳🛵`
        : `Your Order #${orderNumber} has been received and is being prepared in the kitchen. Usually takes ~${est} mins! 🍳🛵`;
    }
    if (s === "in_prep" || s === "cooking" || s === "confirmed") {
      if (isPa) {
        return `Staso Order #${orderNumber} kitchen ke joorigi. Jald ba deliver shi! 🍳`;
      }
      return isUr
        ? `Aap ka Order #${orderNumber} kitchen mein ban raha hai. Jald deliver hoga! 🍳`
        : `Your Order #${orderNumber} is actively being prepared in the kitchen. Will be dispatched shortly! 🍳`;
    }
    if (s === "dispatched" || s === "out_for_delivery" || s === "on_the_way") {
      if (isPa) {
        return `Staso Order #${orderNumber} rider sara day ao rasta ke day! 🛵`;
      }
      return isUr
        ? `Aap ka Order #${orderNumber} rider ke pas hai aur deliver hone ke liye raste mein hai! 🛵`
        : `Your Order #${orderNumber} is on the way with our rider! 🛵`;
    }
    if (s === "delivered" || s === "completed") {
      if (isPa) {
        return `Staso Order #${orderNumber} deliver sho. Umeed da khana de khwakha shawe wi! Dera manana ❤️`;
      }
      return isUr
        ? `Aap ka Order #${orderNumber} deliver ho chuka hai. Umeed hai aap ko khana pasand aya hoga! Bohat shukriya ❤️`
        : `Your Order #${orderNumber} has been delivered. We hope you enjoy your meal! ❤️`;
    }
    if (s === "cancelled") {
      if (isPa) {
        return `Staso Order #${orderNumber} cancel sho.`;
      }
      return isUr
        ? `Aap ka Order #${orderNumber} cancel ho chuka hai.`
        : `Your Order #${orderNumber} was cancelled.`;
    }
    if (isPa) {
      return `Staso Order #${orderNumber} status: *${status}*. Delivery jald rasegi! 🛵`;
    }
    return isUr
      ? `Aap ke Order #${orderNumber} ka status: *${status}*. Delivery jald pohnch rahi hai! 🛵`
      : `Order #${orderNumber} status: *${status}*. On its way soon! 🛵`;
  },

  noRecentOrder(l: Lang): string {
    if (pa(l)) return "Koom recent order wane-munde sho.";
    return ur(l) ? "Koi recent order nahi mila." : "No recent order found.";
  },

  payment(l: Lang): string {
    if (pa(l)) {
      return "💵 Sirf Cash on Delivery (COD) shta.";
    }
    return ur(l)
      ? "💵 Sirf Cash on Delivery (COD) available hai."
      : "💵 We only accept Cash on Delivery (COD).";
  },

  deliveryDisabled(l: Lang): string {
    if (pa(l)) {
      return "Bakhana ghwaarom, da wakht delivery band da. Taso Pickup ya Dine-in select kawalayshay.";
    }
    return ur(l)
      ? "Maafi chahte hain, is waqt delivery service band hai. Aap Pickup ya Dine-in choose kar saktay hain."
      : "Sorry, delivery is currently unavailable for this branch. Please choose Pickup or Dine-in.";
  },

  minDeliveryNotMet(l: Lang, currentSubtotal: number, minDelivery: number, currency: string): string {
    const diff = minDelivery - currentSubtotal;
    if (pa(l)) {
      return `⚠️ Delivery dapara minimum order ${currency} ${minDelivery} day (Staso cart ${currency} ${currentSubtotal} day).\nMeherbani warka ${currency} ${diff} nor item add kra ya Pickup select kra.`;
    }
    return ur(l)
      ? `⚠️ Delivery ke liye minimum order ${currency} ${minDelivery} hai (Aap ka cart ${currency} ${currentSubtotal} hai).\nBaraye meherbani ${currency} ${diff} ka mazeed item add karein ya Pickup choose karein.`
      : `⚠️ Minimum order for delivery is ${currency} ${minDelivery} (your current cart is ${currency} ${currentSubtotal}).\nPlease add ${currency} ${diff} more to your order or choose Pickup.`;
  },

  deliveryAreaNotCovered(l: Lang, areas: string[]): string {
    const list = areas.length
      ? pa(l)
        ? `\nMung deliver kawo: ${areas.join(", ")}`
        : `\nHum deliver karte hain: ${areas.join(", ")}`
      : "";
    if (pa(l)) {
      return `Bakhana ghwaarom — da address zmong delivery area ke nishta.${list}\nBal address rawalega ya Pickup select kra.`;
    }
    return ur(l)
      ? `Maafi — ye address hamare delivery area mein nahi hai.${list}\nDoosra address bhejein ya Pickup choose karein.`
      : `Sorry — that address isn't in our delivery zone.${list}\nPlease send an address in our delivery area or choose Pickup.`;
  },
};
