/**
 * lib/agent/executor.ts
 *
 * Executes AgentAction[] for one turn. Produces replyText + statePatch.
 *
 * Key principles:
 * - Factual questions (hours, payment, delivery info) are answered deterministically
 *   from settings — zero LLM calls, zero timeouts.
 * - Menu/item questions use one groundedAnswer call with relevantItems to keep
 *   the text and tap-list in sync.
 * - Replies are built as a flat string[] and joined with a single newline.
 *   No \n\n inside individual reply strings.
 * - All interactive payloads are attached once (first writer wins).
 */
import type { AgentAction, Transition } from "./state-machine";
import type { TurnUnderstanding } from "./nlu";
import { reply } from "./reply";
import { addToCart, removeFromCart, updateQuantity, cartSubtotal } from "./cart";
import { searchMenu, resolveItem, resolveItemDetailed, extractBaseItemName } from "@/lib/menu/search";
import { orderRepo } from "@/lib/data/order.repo";
import { groundedAnswer } from "./answer";
import {
  orderTypeButtons,
  confirmButtons,
  itemPickList,
  categoryList,
  cartActionButtons,
  variantButtons,
  type InteractivePayload,
} from "./interactive";
import type { TurnContext } from "./context";
import type { CartItem, ConversationStateRow, LanguagePreference, OrderType } from "@/lib/schema.types";
import { findMatchingDeliveryArea, buildDeliveryAreaHint } from "./delivery";
import { parseCustomerTimeToIso } from "@/lib/restaurant-time";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createStaffAlert } from "@/lib/staff-alerts";
import { isValidDeliveryAddress } from "@/lib/customer-crm";


export interface ExecutionResult {
  replyText: string;
  statePatch: Partial<ConversationStateRow>;
  placeOrder: boolean;
  escalate: boolean;
  usedSemanticSearch: boolean;
  interactive?: InteractivePayload | null;
  mediaUrls?: string[];
}

interface ExecInput {
  transition: Transition;
  understanding: TurnUnderstanding;
  ctx: TurnContext;
  branchId: string;
  conversationId: string;
  sourceUserMessageId: string;
  appName: string;
  currency: string;
  customerName?: string | null;
  messageTextForFallback?: string;
  menuDisplayMode?: string;
  menuCardImages?: string[];
}

export async function executeTurn(input: ExecInput): Promise<ExecutionResult> {
  const { transition, understanding: u, ctx, branchId } = input;
  const lang: LanguagePreference = u.language || ctx.state.preferred_language;
  const cur = input.currency || (ctx.settings as unknown as { currency?: string })?.currency || "Rs.";

  let cart: CartItem[] = ctx.state.cart.map((i) => ({ ...i }));
  const patch: Partial<ConversationStateRow> = {
    stage: transition.nextStage,
    preferred_language: lang,
    last_intent: u.primary_intent,
  };

  // Persist rider/kitchen notes from NLU (exclude internal markers)
  const INTERNAL_NOTES = new Set(["add_delta", "coercion_failed", "nlu_error"]);
  if (u.notes && !u.notes.startsWith("fast_path") && !u.notes.startsWith("use_saved_address") && !INTERNAL_NOTES.has(u.notes) && u.notes.length > 5) {
    patch.customer_instructions = u.notes;
  }

  const replies: string[] = [];
  let placeOrder = false;
  let usedSemantic = false;
  let hasDisambiguation = false;
  let interactive: InteractivePayload | null = null;
  let mediaUrls: string[] | undefined = undefined;


  // ── Helpers ──────────────────────────────────────────────────────────────

  const setInteractive = (p: InteractivePayload | null) => { if (!interactive && p) interactive = p; };

  /** Deterministic hours/location answer — never calls LLM. */
  const hoursAnswer = (): string => {
    const s = ctx.settings;
    const status = ctx.isOpenNow
      ? (lang === "pashto" ? "✅ Restaurant da wakht KHALAS day" : lang === "roman_urdu" ? "✅ Restaurant abhi KHULA hai" : "✅ We are currently OPEN")
      : (lang === "pashto" ? "🔴 Restaurant da wakht BAND day" : lang === "roman_urdu" ? "🔴 Restaurant abhi BAND hai" : "🔴 We are currently CLOSED");
    if (lang === "pashto") {
      return `${status}\n🕐 Wakht: ${s.opening_time} – ${s.closing_time}${s.city ? `\n📍 Location: ${s.city}` : ""}`;
    }
    if (lang === "roman_urdu") {
      return `${status}\n🕐 Timings: ${s.opening_time} – ${s.closing_time}${s.city ? `\n📍 Location: ${s.city}` : ""}`;
    }
    return `${status}\n🕐 Hours: ${s.opening_time} – ${s.closing_time}${s.city ? `\n📍 Location: ${s.city}` : ""}`;
  };

  /** Deterministic payment answer — never calls LLM. */
  const paymentAnswer = (): string => {
    if (lang === "pashto") return "💵 Sirf *Cash on Delivery (COD)* shta.";
    return lang === "roman_urdu"
      ? "💵 Filhaal sirf *Cash on Delivery (COD)* available hai."
      : "💵 We only accept *Cash on Delivery (COD)* at this time.";
  };

  /** Deterministic delivery info answer — never calls LLM. */
  const deliveryInfoAnswer = (): string => {
    const s = ctx.settings;
    if (!s.delivery_enabled) {
      if (lang === "pashto") {
        return `Bakhana ghwaro, da wakht delivery service band day — sirf Pickup ya Dine-in shta.\n🕐 Restaurant Timings: ${s.opening_time} – ${s.closing_time}`;
      }
      return lang === "roman_urdu"
        ? `Maafi chahte hain, is waqt delivery service band hai — sirf Pickup ya Dine-in available hai.\n🕐 Restaurant Timings: ${s.opening_time} – ${s.closing_time}`
        : `Sorry, delivery service is currently closed — Pickup or Dine-in only.\n🕐 Restaurant Hours: ${s.opening_time} – ${s.closing_time}`;
    }
    const parts: string[] = [];
    if (lang === "pashto") {
      parts.push("✅ Delivery shta");
      parts.push(`🕐 Delivery Wakht: ${s.opening_time} – ${s.closing_time}`);
      if (s.delivery_areas.length) parts.push(`📍 Ilaqay: ${s.delivery_areas.join(", ")}`);
      parts.push(s.delivery_fee === 0 ? "💰 Delivery Fee: FREE (Muft)" : `💰 Fee: ${cur} ${s.delivery_fee}`);
      if (s.min_delivery_amount) parts.push(`🛒 Kam az kam order: ${cur} ${s.min_delivery_amount}`);
      if (s.estimated_delivery_minutes) parts.push(`⏱ Delivery Wakht: ~${s.estimated_delivery_minutes} min`);
    } else if (lang === "roman_urdu") {
      parts.push("✅ Delivery available hai");
      parts.push(`🕐 Delivery Timings: ${s.opening_time} – ${s.closing_time}`);
      if (s.delivery_areas.length) parts.push(`📍 Areas: ${s.delivery_areas.join(", ")}`);
      parts.push(s.delivery_fee === 0 ? "💰 Delivery Fee: FREE" : `💰 Fee: ${cur} ${s.delivery_fee}`);
      if (s.min_delivery_amount) parts.push(`🛒 Min order: ${cur} ${s.min_delivery_amount}`);
      if (s.estimated_delivery_minutes) parts.push(`⏱ Delivery Time: ~${s.estimated_delivery_minutes} min`);
    } else {
      parts.push("✅ Delivery is available");
      parts.push(`🕐 Delivery Hours: ${s.opening_time} – ${s.closing_time}`);
      if (s.delivery_areas.length) parts.push(`📍 Areas: ${s.delivery_areas.join(", ")}`);
      parts.push(s.delivery_fee === 0 ? "💰 Delivery Fee: FREE" : `💰 Fee: ${cur} ${s.delivery_fee}`);
      if (s.min_delivery_amount) parts.push(`🛒 Min order: ${cur} ${s.min_delivery_amount}`);
      if (s.estimated_delivery_minutes) parts.push(`⏱ ETA: ~${s.estimated_delivery_minutes} min`);
    }
    return parts.join("\n");
  };

  const grounded = async (question: string): Promise<string | null> => {
    const relevantItems = ctx.state.last_shown_options?.length
      ? ctx.state.last_shown_options.map((o) => ({ name: o.name, price: o.price, category: ctx.state.last_shown_category || null }))
      : undefined;

    return groundedAnswer({
      question,
      language: lang,
      appName: input.appName,
      currency: cur,
      settings: ctx.settings,
      menu: ctx.menu,
      relevantItems,
      isOpenNow: ctx.isOpenNow,
    });
  };

  // ── Escalation ────────────────────────────────────────────────────────────
  if (transition.escalate) {
    return {
      replyText: reply.escalated(lang),
      statePatch: {
        ...patch,
        stage: "human",
        is_bot_active: false,
        escalation_reason: String(transition.actions[0]?.payload?.reason ?? "requested"),
        escalated_at: new Date().toISOString(),
      },
      placeOrder: false,
      escalate: true,
      usedSemanticSearch: false,
    };
  }

  // Closed-guard: only block ordering actions
  if (!ctx.isOpenNow) {
    const blockedActions = new Set(["place_order", "ask_order_type", "collect_delivery_address"]);
    if (transition.actions.some((a) => blockedActions.has(a.kind))) {
      replies.push(reply.closed(lang, ctx.settings.opening_time));
    }
  }

  if (u.guests && !patch.guests) patch.guests = u.guests;
  if (u.reservation_time && !patch.reservation_time) {
    patch.reservation_time = parseCustomerTimeToIso(u.reservation_time, ctx.settings.timezone);
  }
  if (u.pickup_time && !patch.pickup_time) {
    patch.pickup_time = parseCustomerTimeToIso(u.pickup_time, ctx.settings.timezone);
  }
  if (u.address && !patch.address) {
    patch.address = u.address;
  }
  if (u.order_type && !patch.order_type) {
    patch.order_type = u.order_type;
  }

  // ── Action dispatch ───────────────────────────────────────────────────────
  for (const action of transition.actions) {
    switch (action.kind) {

      // ── Greet ────────────────────────────────────────────────────────────
      case "greet": {
        const wasSalam = /^(aoa|a\.?o\.?a|assalam|salam|سلام|ستړې|ستړی)\b/i.test(input.messageTextForFallback?.trim() ?? "");
        replies.push(reply.greeting(lang, input.appName, input.customerName ?? null, wasSalam));
        if (input.menuDisplayMode === "menu_pictures") {
          setInteractive({
            kind: "buttons",
            payload: {
              body: lang === "pashto" ? "Menu katlo lapara button khekhey krai:" : lang === "roman_urdu" ? "Menu dekhne ke liye button dabayein:" : "Tap below to view our menu:",
              buttons: [
                { id: "action:view_menu", title: "📜 View Menu" },
              ],
            },
          });
        } else {
          const cats = [...new Set(ctx.menu.map((m) => m.category).filter(Boolean))] as string[];
          if (cats.length > 0) {
            setInteractive(categoryList(lang, cats, lang === "pashto" ? "Taso sa ghwaray?" : lang === "roman_urdu" ? "Kya mangwana hai?" : "What would you like?"));
          }
        }
        break;
      }

      // ── Add items ────────────────────────────────────────────────────────
      case "add_items": {
        if (action.payload?.fromUpsell) break; // upsell not implemented — skip silently

        const mentions = (action.payload?.items as TurnUnderstanding["items"]) ?? u.items;
        const isDelta = u.notes === "add_delta";
        const added: Array<{ name: string; newCartQty: number; notes?: string | null }> = [];
        const cats = [...new Set(ctx.menu.map((m) => m.category).filter(Boolean))] as string[];

        const INSTRUCTION_PATTERNS = /\b(non\s*spicy|spicy|teekha|kam\s*teekha|mirch|masala|kali\s*mirch|safed\s*mirch|oil|tail|ghee|cheese|sauce|ketchup|mayo|mayonnaise|raita|chutney|chatni|salad|onion|pyaaz|pyaz|pyas|crispy|chilled|thandi|garam|bina|without|extra|less|kam|zyada|ziyada|hona\s*chaye|hona\s*chahiye|rakhna|rakhein|karna|krna|dalna|daalna|bhejna)\b/i;
        const EXPLICIT_ADD_QTY = /\b(\d+|ek|do|teen|char|one|two|three)\s*(?:aur|more|add|extra\s+piece)\b/i;

        for (const m of mentions) {
          let query = m.query || "";
          if (isDelta && query === "__last_item__" && cart.length > 0) {
            query = cart[cart.length - 1].name;
          }
          if (!query.trim()) continue;

          // Check if this mention is an instruction/cooking note update for an item ALREADY in the cart
          // E.g. Customer says "Pizza non spicy hona chaye" or "kali mirch istemal krna"
          const rawMsg = input.messageTextForFallback || "";
          const hasInstruction = Boolean(m.notes || INSTRUCTION_PATTERNS.test(rawMsg) || INSTRUCTION_PATTERNS.test(query));
          const hasExplicitNewQty = EXPLICIT_ADD_QTY.test(rawMsg) || (typeof m.qty === "number" && m.qty > 1);

          if (cart.length > 0 && hasInstruction && !hasExplicitNewQty) {
            const qClean = query.replace(INSTRUCTION_PATTERNS, "").trim();
            const qLower = (qClean || query).toLowerCase().replace(/[^a-z0-9]/g, "");
            // Guard: if the query is JUST a common food item name, it's a new order, not a note
            const FOOD_NAMES = /^(raita|salad|naan|nan|roti|rice|chawal|chutney|chatni|fries|sauce|ketchup|mayo|cheese|cold\s*drink|drink|pepsi|coke|dew|7up|sprite|water|pani|lassi|dahi)$/i;
            const isJustFoodName = FOOD_NAMES.test(query.trim());
            if (!isJustFoodName) {
              const existingItem = cart.find((ci) => {
                const ciLower = ci.name.toLowerCase().replace(/[^a-z0-9]/g, "");
                return (
                  (qLower.length >= 3 && ciLower.includes(qLower)) ||
                  (qLower.length >= 3 && qLower.includes(ciLower)) ||
                  (qLower.length >= 4 && ciLower.includes(qLower.slice(0, 4)))
                );
              });
              // Only match when query actually references an existing cart item — no blind single-item fallback
              if (existingItem) {
                const noteText = m.notes || rawMsg.replace(/^(?:can\s+you\s+|please\s+)?(?:make\s+)?(?:the\s+)?(?:pizza|burger|karahi|deal\s*\d+|it)\s*/i, "").trim();
                existingItem.notes = noteText;
                replies.push(reply.itemInstructionUpdated(lang, existingItem.name, noteText));
                continue;
              }
            }
          }

          const res = await resolveItemDetailed(branchId, query, m.size, ctx.menu, ctx.state.last_shown_category ?? null);
          if (res.kind === "exact") {
            const resolved = res.item;
            if (resolved.method === "vector") usedSemantic = true;
            if (resolved.is_available === false) {
              replies.push(reply.itemUnavailable(lang, resolved.name));
              continue;
            }
            cart = addToCart(cart, {
              menu_item_id: resolved.id,
              name: resolved.name,
              unit_price: resolved.price,
              qty: m.qty ?? 1,
              size: m.size ?? null,
              addons: m.addons ?? [],
              notes: m.notes ?? null,
            });
            const cartItem = cart.find((ci) => ci.menu_item_id === resolved.id);
            added.push({ name: resolved.name, newCartQty: cartItem?.qty ?? (m.qty ?? 1), notes: m.notes ?? null });
          } else if (res.kind === "variants") {
            // Item has multiple sizes (e.g. Half / Full) and user did not specify size
            hasDisambiguation = true;
            patch.last_shown_options = res.variants.map((v) => ({ id: v.id, name: v.name, price: v.price }));
            patch.last_shown_options_at = new Date().toISOString();
            replies.push(reply.itemVariants(lang, res.baseName, res.variants, cur));
            const vb = variantButtons(lang, res.variants, cur);
            if (vb) {
              setInteractive(vb);
            } else {
              setInteractive(itemPickList(lang, res.variants.map((v) => ({ id: v.id, name: v.name, price: v.price, category: v.category })), cur));
            }
          } else if (res.kind === "ambiguous") {
            // Broad query matches multiple distinct items (e.g. "Karahi" -> Chicken Karahi, Mutton Karahi, etc.)
            hasDisambiguation = true;
            patch.last_shown_options = res.matches.map((m) => ({ id: m.id, name: m.name, price: m.price }));
            patch.last_shown_options_at = new Date().toISOString();
            replies.push(reply.ambiguousMatches(lang, res.query, res.matches, cur));
            setInteractive(itemPickList(lang, res.matches.map((m) => ({ id: m.id, name: m.name, price: m.price, category: m.category })), cur));
          } else {
            // not_found (e.g. "Pizza", "Milkshake")
            if (res.suggestions.length > 0) {
              patch.last_shown_options = res.suggestions.map((x) => ({ id: x.id, name: x.name, price: x.price }));
              patch.last_shown_options_at = new Date().toISOString();
              replies.push(reply.notFound(lang, query, res.suggestions.map((x) => x.name), cats));
              setInteractive(itemPickList(lang, res.suggestions.map((x) => ({ id: x.id, name: x.name, price: x.price, category: x.category })), cur));
            } else {
              const ans = await grounded(`customer wants "${query}" which is not on the menu. State that it is not available and suggest our actual menu categories.`);
              replies.push(ans ?? reply.notFound(lang, query, [], cats));
              if (cats.length > 0) {
                setInteractive(categoryList(lang, cats, lang === "pashto" ? "Menu katal ghwaray?" : lang === "roman_urdu" ? "Menu dekhna chahenge?" : "What would you like?"));
              }
            }
          }
        }

        if (added.length) {
          const willShowSummary = transition.actions.some((a) => a.kind === "show_summary");
          if (!willShowSummary) {
            replies.push(reply.itemsAdded(lang, added, cart, cur));
            setInteractive(cartActionButtons(lang));
          }
        } else if (replies.length > 0 && cart.length > 0 && !hasDisambiguation) {
          setInteractive(cartActionButtons(lang));
        }
        break;
      }

      case "remove_items": {
        const removals = (action.payload?.removals as TurnUnderstanding["removals"]) ?? u.removals;
        for (const r of removals) {
          const resolved = await resolveItem(branchId, r.query, ctx.menu);
          cart = removeFromCart(cart, { menu_item_id: resolved?.id, name: resolved?.name ?? r.query, qty: r.qty });
        }
        const hasAddItems = transition.actions.some((a) => a.kind === "add_items");
        if (!hasAddItems) {
          replies.push(reply.itemsRemoved(lang, cart, cur));
          if (cart.length > 0) setInteractive(cartActionButtons(lang));
        }
        break;
      }

      case "update_quantity": {
        const items = (action.payload?.items as TurnUnderstanding["items"]) ?? u.items;
        for (const m of items) {
          let query = m.query || "";
          if ((!query || query === "current_item" || query === "__last_item__" || query === "item" || query === "cart") && cart.length > 0) {
            query = cart[cart.length - 1].name;
          }
          if (m.size && cart.length > 0) {
            const sizeRes = await resolveItemDetailed(branchId, query, m.size, ctx.menu);
            if (sizeRes.kind === "exact") {
              const oldItem = cart.find(ci => ci.name.toLowerCase().includes(query.toLowerCase()) || query.toLowerCase().includes(ci.name.toLowerCase())) || cart[cart.length - 1];
              if (oldItem) {
                oldItem.menu_item_id = sizeRes.item.id;
                oldItem.name = sizeRes.item.name;
                oldItem.unit_price = sizeRes.item.price;
                oldItem.size = m.size;
                if (m.qty) oldItem.qty = m.qty;
                continue;
              }
            }
          }
          const resolved = await resolveItem(branchId, query, ctx.menu);
          cart = updateQuantity(cart, { menu_item_id: resolved?.id, name: resolved?.name ?? query, qty: m.qty ?? 1 });
        }
        replies.push(reply.cartUpdated(lang, cart, cur));
        if (cart.length > 0) setInteractive(cartActionButtons(lang));
        break;
      }

      case "offer_upsell": {
        patch.upsell_offered = true;
        break;
      }

      // ── Information ───────────────────────────────────────────────────────
      case "answer_hours_location":
        replies.push(hoursAnswer());
        break;

      case "answer_payment":
        replies.push(paymentAnswer());
        break;

      case "answer_delivery_info": {
        const queryStr = String(action.payload?.query ?? u.info_query ?? input.messageTextForFallback ?? "").toLowerCase();
        if (/kitna\s+time|time\s+kitna|how\s+much\s+time|delivery\s+time|kab\s+tak\s+pohanch|kitni\s+der|der\s+lag|دیر|وقت|ٹائم|څومره\s+وخت|کله\s+رسیږي/i.test(queryStr)) {
          const estDelivery = Math.round(Number(ctx.settings?.estimated_delivery_minutes) || 45);
          replies.push(
            lang === "pashto"
              ? `⏱ Delivery ke takreeban ~${estDelivery} minute lagygi.`
              : lang === "roman_urdu"
              ? `⏱ Delivery mein takreeban ~${estDelivery} minutes lagte hain.`
              : `⏱ Estimated delivery time is ~${estDelivery} mins.`
          );
        } else if (/charge|fee|pesay|paise|paisa|kitnay\s+ka|پیسے|قیمت|چارجز|پیسی|څو/i.test(queryStr)) {
          replies.push(
            lang === "pashto"
              ? (ctx.settings.delivery_fee === 0 ? "💰 Delivery bilkul muft (free) da!" : `💰 Delivery Fee: ${cur} ${ctx.settings.delivery_fee}`)
              : lang === "roman_urdu"
              ? (ctx.settings.delivery_fee === 0 ? "💰 Delivery bilkul free hai!" : `💰 Delivery Fee: ${cur} ${ctx.settings.delivery_fee}`)
              : (ctx.settings.delivery_fee === 0 ? "💰 Delivery is FREE!" : `💰 Delivery Fee: ${cur} ${ctx.settings.delivery_fee}`)
          );
        } else {
          replies.push(deliveryInfoAnswer());
        }
        break;
      }

      case "answer_grounded": {
        const question = (action.payload?.query as string) ?? u.info_query ?? input.messageTextForFallback ?? "";
        if (question) {
          const ans = await grounded(question);
          if (ans) replies.push(ans);
          else replies.push(hoursAnswer());
        }
        break;
      }

      case "answer_info": {
        const q = String(action.payload?.info_query ?? u.info_query ?? "").trim();
        if (/delivery|deliver|ghar/i.test(q) && !/karahi|burger|biryani|tikka|kabab/i.test(q)) {
          replies.push(deliveryInfoAnswer());
          break;
        }
        if (/hours|timing|open|close|kahan|location|address/i.test(q)) {
          replies.push(hoursAnswer());
          break;
        }
        if (/payment|cod|cash|card|online/i.test(q)) {
          replies.push(paymentAnswer());
          break;
        }

        // H4 fix: if the queried item is already in the cart, acknowledge it upfront
        // so the bot doesn't sound confused ("Is it available?" when it's already added)
        const qClean = q.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
        const cartMatch = cart.find((ci) => {
          const ciFull = ci.name.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
          const ciBase = extractBaseItemName(ci.name).baseName.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
          return (
            qClean.includes(ciBase) ||
            qClean.includes(ciFull) ||
            ciFull.includes(qClean) ||
            ciBase.includes(qClean) ||
            ciBase.split(" ").every((w) => w.length >= 3 && qClean.includes(w))
          );
        });
        if (cartMatch) {
          const alreadyInCart = lang === "pashto"
            ? `✅ *${cartMatch.name}* mukhey na staso cart ke shta (${cartMatch.qty}x).`
            : lang === "roman_urdu"
            ? `✅ *${cartMatch.name}* already aapke cart mein hai (${cartMatch.qty}x).`
            : `✅ *${cartMatch.name}* is already in your cart (${cartMatch.qty}x).`;
          replies.push(alreadyInCart);
          // Also show cart action buttons to guide next step
          setInteractive(cartActionButtons(lang));
          break;
        }

        // Menu item / general question:
        const ans = await grounded(q || "what are your popular items?");
        if (ans) {
          replies.push(ans);

          // Find items from menu mentioned in the grounded answer or relevant to query
          const lowerAns = ans.toLowerCase();
          const mentionedMap = new Map<string, { id: string; name: string; price: number; category?: string | null }>();

          for (const item of ctx.menu) {
            const { baseName } = extractBaseItemName(item.name);
            const lowerBase = baseName.toLowerCase();
            const lowerFull = item.name.toLowerCase();

            if (lowerAns.includes(lowerFull) || (lowerBase.length >= 4 && lowerAns.includes(lowerBase))) {
              if (!mentionedMap.has(item.id)) {
                mentionedMap.set(item.id, { id: item.id, name: item.name, price: item.price, category: item.category });
              }
            }
          }

          const matchedItems = Array.from(mentionedMap.values());
          if (matchedItems.length > 0) {
            patch.last_shown_options = matchedItems.slice(0, 10);
            patch.last_shown_options_at = new Date().toISOString();

            const distinctBases = Array.from(
              new Set(matchedItems.map((m) => extractBaseItemName(m.name).baseName))
            );

            if (distinctBases.length === 1 && matchedItems.length > 1) {
              // Single item with multiple sizes (e.g. Chicken Supreme -> Reg, Med, Large, XL)
              const vb = variantButtons(
                lang,
                matchedItems,
                cur,
                lang === "pashto"
                  ? "Kum size ghwaray?"
                  : lang === "roman_urdu"
                  ? "Kaunsa size mangwana chahenge?"
                  : "Which size would you like?"
              );
              if (vb) setInteractive(vb);
            } else if (distinctBases.length >= 2 && distinctBases.length <= 3) {
              setInteractive({
                kind: "buttons",
                payload: {
                  body:
                    lang === "pashto"
                      ? "Le de na sa ghwaray?"
                      : lang === "roman_urdu"
                      ? "In mein se kya mangwayein?"
                      : "Which one would you like to try?",
                  buttons: distinctBases.slice(0, 3).map((base) => {
                    const sample = matchedItems.find((m) => extractBaseItemName(m.name).baseName === base);
                    return {
                      id: sample ? `item:${sample.id}` : `action:search_${base.slice(0, 10)}`,
                      title: base.slice(0, 20),
                    };
                  }),
                },
              });
            } else {
              setInteractive(
                itemPickList(
                  lang,
                  matchedItems.slice(0, 10),
                  cur,
                  lang === "pashto"
                    ? "Muntakhab options:"
                    : lang === "roman_urdu"
                    ? "Recommended options:"
                    : "Recommended options:"
                )
              );
            }
          }
        } else {
          // Fallback to searching the menu (pass category context for better results)
          const searchRes = await resolveItemDetailed(branchId, q, undefined, ctx.menu, ctx.state.last_shown_category ?? null);
          if (searchRes.kind === "exact") {
            const { matches } = await searchMenu(branchId, q, 3, ctx.menu);
            if (matches.length) {
              patch.last_shown_options = matches.map((m) => ({ id: m.id, name: m.name, price: m.price }));
              patch.last_shown_options_at = new Date().toISOString();
              replies.push(reply.itemList(lang, matches, cur));
              setInteractive(itemPickList(lang, matches, cur));
            } else {
              replies.push(hoursAnswer());
            }
          } else if (searchRes.kind === "variants") {
            patch.last_shown_options = searchRes.variants.map((v) => ({ id: v.id, name: v.name, price: v.price }));
            patch.last_shown_options_at = new Date().toISOString();
            replies.push(reply.itemVariants(lang, searchRes.baseName, searchRes.variants, cur));
            const vb = variantButtons(lang, searchRes.variants, cur);
            if (vb) setInteractive(vb);
          } else if (searchRes.kind === "ambiguous") {
            patch.last_shown_options = searchRes.matches.map((m) => ({ id: m.id, name: m.name, price: m.price }));
            patch.last_shown_options_at = new Date().toISOString();
            replies.push(reply.ambiguousMatches(lang, searchRes.query, searchRes.matches, cur));
            setInteractive(itemPickList(lang, searchRes.matches, cur));
          } else {
            const cats = [...new Set(ctx.menu.map((m) => m.category).filter(Boolean))] as string[];
            replies.push(reply.notFound(lang, q, [], cats));
            if (cats.length > 0) {
              setInteractive(categoryList(lang, cats));
            }
          }
        }
        break;
      }

      case "show_menu": {
        const categoryQuery =
          (action.payload?.category as string | undefined) ??
          (u.info_query as string | undefined);
        const isAddMore = Boolean(
          action.payload?.isAddMore ||
          u.notes === "fast_path_add_more" ||
          (categoryQuery && /^(add_more|aur\s*add|add\s*more)$/i.test(categoryQuery.trim()))
        );

        // When customer clicks "Add More" or asks to add more in menu_pictures mode,
        // ask what they want to add instead of re-sending picture cards
        if (isAddMore && input.menuDisplayMode === "menu_pictures") {
          replies.push(reply.askAddMore(lang));
          break;
        }

        // Menu pictures mode: send menu card images directly
        if (input.menuDisplayMode === "menu_pictures" && input.menuCardImages?.length && (!categoryQuery || /^(menu|view_menu|all|deals?)$/i.test(categoryQuery.trim()))) {
          mediaUrls = [...input.menuCardImages];
          replies.push(reply.menuPictureInvite(lang, input.appName));
          break;
        }

        const cats = [...new Set(ctx.menu.map((m) => m.category).filter(Boolean))] as string[];

        if (categoryQuery) {
          const normQuery = categoryQuery.toLowerCase().trim();
          // First attempt exact category match
          let categoryItems = ctx.menu.filter(
            (m) => m.category && m.category.toLowerCase() === normQuery
          );
          // If query mentions "deal", strictly match categories that include "deal" (prevents Chicken Burger leaking into Chicken Burger Deals)
          if (categoryItems.length === 0 && normQuery.includes("deal")) {
            categoryItems = ctx.menu.filter(
              (m) => m.category && m.category.toLowerCase().includes("deal")
            );
          }
          // Fallback: category name contains query
          if (categoryItems.length === 0) {
            categoryItems = ctx.menu.filter(
              (m) => m.category && m.category.toLowerCase().includes(normQuery)
            );
          }

          if (categoryItems.length > 0) {
            // Natural numeric sort (e.g. DEAL 4 before DEAL 10)
            const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
            categoryItems.sort((a, b) => collator.compare(a.name, b.name));

            patch.last_shown_options = categoryItems.map((m) => ({ id: m.id, name: m.name, price: m.price }));
            patch.last_shown_options_at = new Date().toISOString();
            patch.last_shown_category = categoryQuery;
            replies.push(reply.itemList(lang, categoryItems, cur, categoryQuery));
            setInteractive(itemPickList(lang, categoryItems, cur));
            break;
          }
        }

        // Fallback to menu pictures if configured
        if (input.menuDisplayMode === "menu_pictures" && input.menuCardImages?.length) {
          mediaUrls = [...input.menuCardImages];
          replies.push(reply.menuPictureInvite(lang, input.appName));
          break;
        }

        // Generic category list
        if (cats.length > 0) {
          replies.push(reply.categoryList(lang, cats));
          setInteractive(categoryList(lang, cats));
        } else {
          replies.push(hoursAnswer());
        }
        break;
      }

      // ── Order type ───────────────────────────────────────────────────────
      case "ask_order_type": {
        const chosen = action.payload?.chosen as OrderType | undefined;
        if (chosen) {
          if (chosen === "delivery" && ctx.settings.delivery_enabled === false) {
            if (!hasDisambiguation) {
              replies.push(reply.deliveryDisabled(lang));
              setInteractive(orderTypeButtons(lang, ctx.settings));
            }
            patch.order_type = null;
            patch.stage = "choosing_order_type";
          } else {
            patch.order_type = chosen;
          }
        } else {
          if (!hasDisambiguation) {
            replies.push(reply.askOrderType(lang));
            setInteractive(orderTypeButtons(lang, ctx.settings));
          }
        }
        break;
      }

      // ── Collect delivery address ─────────────────────────────────────────
      case "collect_delivery_address": {
        if (hasDisambiguation) break;
        // Clear stale/invalid addresses that leaked from button payloads or previous bugs
        const currentAddr = patch.address ?? ctx.state.address;
        if (currentAddr && /^(addr:(new|saved:.*)|new|naya|naya\s+address|new\s+address)$/i.test(currentAddr.trim())) {
          patch.address = null;
        }
        if (ctx.settings.delivery_enabled === false) {
          if (!replies.some((r) => r.includes("delivery") || r.includes("Delivery"))) {
            replies.push(reply.deliveryDisabled(lang));
          }
          patch.order_type = null;
          patch.stage = "choosing_order_type";
          setInteractive(orderTypeButtons(lang, ctx.settings));
          break;
        }
        const address = action.payload?.address as string | undefined;
        const savedAddrNote = u.notes?.match(/^use_saved_address:(.+)$/);
        if (savedAddrNote) {
          const { data: savedRow } = await supabaseAdmin
            .from("customer_addresses")
            .select("address")
            .eq("id", savedAddrNote[1])
            .maybeSingle();
          if (savedRow?.address) {
            if (ctx.settings.delivery_areas?.length > 0 && !findMatchingDeliveryArea(savedRow.address, ctx.settings)) {
              replies.push(reply.deliveryAreaNotCovered(lang, ctx.settings.delivery_areas));
              patch.stage = "collecting_delivery";
              patch.address = null;
            } else {
              patch.address = savedRow.address;
              patch.order_type = patch.order_type ?? "delivery";
              replies.push(reply.savedAddressConfirmed(lang, savedRow.address));

              if (cart.length > 0 && !hasDisambiguation) {
                patch.stage = "confirming";
                replies.push(reply.summary(lang, cart, patch.order_type, cur, savedRow.address, ctx.settings));
                setInteractive(confirmButtons(lang));
              }
            }
          } else {
            replies.push(reply.askAddress(lang));
          }
        } else if (address) {
          if (ctx.settings.delivery_areas?.length > 0 && !findMatchingDeliveryArea(address, ctx.settings)) {
            replies.push(reply.deliveryAreaNotCovered(lang, ctx.settings.delivery_areas));
            patch.stage = "collecting_delivery";
            patch.address = null;
          } else {
            patch.address = address;
            patch.order_type = patch.order_type ?? "delivery";

            // Check if modifying a recently placed order (within 45 min and cart is empty)
            const recentPlacedOrder = (ctx.state.stage === "placed" || cart.length === 0)
              ? await orderRepo.getLatestForConversation(input.conversationId)
              : null;
            const isRecent = recentPlacedOrder &&
              (Date.now() - new Date(recentPlacedOrder.created_at).getTime() < 45 * 60 * 1000);

            if (isRecent && recentPlacedOrder.status === "out_for_delivery") {
              replies.push(
                lang === "pashto"
                  ? `Staso order #${recentPlacedOrder.order_number} delivery dapara rawana shaway day. Da address badlawalo dapara delivery rider ya support sara rabita wokray.`
                  : lang === "roman_urdu"
                  ? `Aap ka order #${recentPlacedOrder.order_number} already delivery ke liye nikal chuka hai. Address tabdeeli ke liye hamare delivery rider ya support se rabta karein.`
                  : `Your order #${recentPlacedOrder.order_number} is already out for delivery. Please contact our support team to adjust the address.`,
              );
              break;
            } else if (isRecent && (recentPlacedOrder.status === "received" || recentPlacedOrder.status === "preparing")) {
              await orderRepo.updateFulfillment(recentPlacedOrder.id, {
                type: "delivery",
                address,
                guests: null,
                reservation_time: null,
              });
              patch.stage = "placed";
              replies.push(
                lang === "pashto"
                  ? `✅ Da order #${recentPlacedOrder.order_number} delivery address update sho:\n📍 *${address}*\nZamung rider ta halat walegala sho! 🙏`
                  : lang === "roman_urdu"
                  ? `✅ Order #${recentPlacedOrder.order_number} ka delivery address update ho gaya:\n📍 *${address}*\nHamare rider ko notify kar diya gaya hai! 🙏`
                  : `✅ Delivery address for order #${recentPlacedOrder.order_number} updated to:\n📍 *${address}*\nOur dispatch team has been notified! 🙏`,
              );
              break;
            }

            if (cart.length > 0 && !hasDisambiguation) {
              patch.stage = "confirming";
              replies.push(reply.summary(lang, cart, patch.order_type, cur, address, ctx.settings));
              setInteractive(confirmButtons(lang));
            }
          }
        } else {
          const isNewAddressRequest = Boolean(
            action.payload?.isNewAddressRequest ||
            u.notes === "prompt_new_address" ||
            u.notes === "fast_path_new_address_request"
          );
          const saved = !isNewAddressRequest && ctx.savedAddress && isValidDeliveryAddress(ctx.savedAddress.address) && isValidDeliveryAddress(ctx.savedAddress.label) ? ctx.savedAddress : null;
          if (saved) {
            replies.push(reply.askAddressWithSaved(lang, saved.label));
            setInteractive({
              kind: "buttons",
              payload: {
                body: lang === "pashto" ? "Da delivery pata (address)?" : "Delivery address?",
                buttons: [
                  { id: `addr:saved:${saved.id}`, title: lang === "pashto" ? "Pakhwanay Address" : lang === "roman_urdu" ? "Pichla Address" : "Use Saved" },
                  { id: "addr:new", title: lang === "pashto" ? "Naway Address" : lang === "roman_urdu" ? "Naya Address" : "New Address" },
                ],
              },
            });
          } else {
            const areaHint = buildDeliveryAreaHint(ctx.settings, lang);
            replies.push(`${reply.askAddress(lang)}${areaHint}`);
          }
        }
        break;
      }

      // ── Collect dine-in details ──────────────────────────────────────────
      case "collect_dinein_details": {
        if (hasDisambiguation) break;
        const guests = (action.payload?.guests as number | null | undefined) ?? u.guests ?? patch.guests;
        const rtime = (action.payload?.reservation_time as string | null | undefined) ?? u.reservation_time ?? patch.reservation_time;
        if (guests) patch.guests = guests;
        if (rtime) patch.reservation_time = parseCustomerTimeToIso(rtime, ctx.settings.timezone);

        const currentGuests = patch.guests ?? ctx.state.guests;
        const currentRtime = patch.reservation_time ?? ctx.state.reservation_time;

        // Check if modifying a recently placed order (within 45 minutes and cart is empty)
        const recentPlacedOrder = (ctx.state.stage === "placed" || cart.length === 0)
          ? await orderRepo.getLatestForConversation(input.conversationId)
          : null;
        const isRecent = recentPlacedOrder &&
          (Date.now() - new Date(recentPlacedOrder.created_at).getTime() < 45 * 60 * 1000);

        if (isRecent && recentPlacedOrder.status === "out_for_delivery") {
          replies.push(
            lang === "pashto"
              ? `Staso order #${recentPlacedOrder.order_number} delivery dapara rawana shaway day ao Dine-in ta na badleegi. Meharbani wokray support sara rabita wokray.`
              : lang === "roman_urdu"
              ? `Aap ka order #${recentPlacedOrder.order_number} already delivery ke liye nikal chuka hai aur Dine-in mein switch nahi ho sakta. Baraye meherbani support se rabta karein.`
              : `Your order #${recentPlacedOrder.order_number} is already out for delivery and cannot be changed to Dine-in. Please contact support.`,
          );
          break;
        }

        if (isRecent && (recentPlacedOrder.status === "received" || recentPlacedOrder.status === "preparing")) {
          if (currentGuests && currentRtime) {
            await orderRepo.updateFulfillment(recentPlacedOrder.id, {
              type: "dine-in",
              guests: currentGuests,
              reservation_time: currentRtime,
              address: null,
            });
            patch.order_type = "dine-in";
            patch.stage = "placed";
            replies.push(reply.orderUpdated(lang, recentPlacedOrder.order_number, "dine-in", `${currentGuests} guests, ${u.reservation_time || rtime || "reserved time"}`));
            break;
          } else if (currentGuests && !currentRtime) {
            replies.push(reply.askDineInTime(lang, currentGuests));
            break;
          } else if (!currentGuests && currentRtime) {
            replies.push(reply.askDineInGuests(lang, u.reservation_time || rtime || ""));
            break;
          }
        }

        if (!currentGuests && !currentRtime) {
          replies.push(reply.askDineIn(lang));
        } else if (currentGuests && !currentRtime) {
          replies.push(reply.askDineInTime(lang, currentGuests));
        } else if (!currentGuests && currentRtime) {
          replies.push(reply.askDineInGuests(lang, u.reservation_time || rtime || ""));
        } else if (cart.length === 0) {
          replies.push(
            lang === "pashto"
              ? `Kha theek da, ${currentGuests} kasan, ${u.reservation_time || rtime || ""}. Menu na sa order kawal ghwaray?`
              : lang === "roman_urdu"
              ? `Theek hai, ${currentGuests} log, ${u.reservation_time || rtime || ""}. Menu se kya order karein ge?`
              : `Got it, ${currentGuests} guests at ${u.reservation_time || rtime || ""}. What would you like to order from our menu?`,
          );
        }
        break;
      }

      // ── Collect pickup time ──────────────────────────────────────────────
      case "collect_pickup_time": {
        if (hasDisambiguation) break;
        const ptime = (action.payload?.pickup_time as string | undefined) ?? u.pickup_time;
        if (ptime) {
          patch.pickup_time = parseCustomerTimeToIso(ptime, ctx.settings.timezone);

          // Check if modifying a recently placed order (within 45 minutes and cart is empty)
          const recentPlacedOrder = (ctx.state.stage === "placed" || cart.length === 0)
            ? await orderRepo.getLatestForConversation(input.conversationId)
            : null;
          const isRecent = recentPlacedOrder &&
            (Date.now() - new Date(recentPlacedOrder.created_at).getTime() < 45 * 60 * 1000);

          if (isRecent && recentPlacedOrder.status === "out_for_delivery") {
            replies.push(
              lang === "pashto"
                ? `Staso order #${recentPlacedOrder.order_number} delivery dapara rawana shaway day ao Pickup ta na badleegi. Support sara rabita wokray.`
                : lang === "roman_urdu"
                ? `Aap ka order #${recentPlacedOrder.order_number} already delivery ke liye nikal chuka hai aur Pickup mein switch nahi ho sakta. Support se rabta karein.`
                : `Your order #${recentPlacedOrder.order_number} is already on its way for delivery. Please contact support.`,
            );
            break;
          }

          if (isRecent && (recentPlacedOrder.status === "received" || recentPlacedOrder.status === "preparing")) {
            await orderRepo.updateFulfillment(recentPlacedOrder.id, {
              type: "pickup",
              pickup_time: patch.pickup_time,
              address: null,
            });
            patch.order_type = "pickup";
            patch.stage = "placed";
            replies.push(reply.orderUpdated(lang, recentPlacedOrder.order_number, "pickup", ptime));
            break;
          }

          if (cart.length === 0) {
            replies.push(
              lang === "pashto"
                ? `Kha theek da, pickup wakht: ${ptime}. Menu na sa order kawal ghwaray?`
                : lang === "roman_urdu"
                ? `Theek hai, pickup time: ${ptime}. Menu se kya order karein ge?`
                : `Got it, pickup time: ${ptime}. What would you like to order from our menu?`,
            );
          }
        } else {
          replies.push(reply.askPickupTime(lang));
        }
        break;
      }

      // ── Cart / summary ───────────────────────────────────────────────────
      case "show_cart": {
        const addr = patch.address ?? ctx.state.address;
        if (cart.length === 0) {
          replies.push(reply.emptyCart(lang));
        } else {
          replies.push(reply.summary(lang, cart, patch.order_type ?? ctx.state.order_type, cur, addr ?? null, ctx.settings));
          setInteractive(cartActionButtons(lang, { hideViewCart: true }));
        }
        break;
      }

      case "show_summary": {
        if (hasDisambiguation) break;
        const alreadyHasSummary = replies.some((r) => r.includes("Total:") || r.includes("Aap ka order") || r.includes("Your order"));
        if (alreadyHasSummary) {
          setInteractive(confirmButtons(lang));
          break;
        }
        let addr = patch.address ?? ctx.state.address;
        // Clean stale/invalid address values before displaying
        if (addr && /^(addr:(new|saved:.*)|new|naya|naya\s+address|new\s+address)$/i.test(addr.trim())) {
          addr = null;
          patch.address = null;
        }
        if (cart.length === 0) {
          replies.push(reply.emptyCart(lang));
        } else {
          replies.push(reply.summary(lang, cart, patch.order_type ?? ctx.state.order_type, cur, addr ?? null, ctx.settings));
          setInteractive(confirmButtons(lang));
        }
        break;
      }

      // ── Place order ──────────────────────────────────────────────────────
      case "place_order": {
        if (!ctx.isOpenNow) {
          replies.push(reply.closed(lang, ctx.settings.opening_time));
          break;
        }
        if (cart.length === 0) { replies.push(reply.emptyCart(lang)); break; }
        const orderType = (patch.order_type ?? ctx.state.order_type) as OrderType | null;
        if (!orderType) {
          replies.push(reply.askOrderType(lang));
          patch.stage = "choosing_order_type";
          setInteractive(orderTypeButtons(lang, ctx.settings));
          break;
        }
        const deliveryAddr = patch.address ?? ctx.state.address;
        // Client-side guards:
        if (orderType === "delivery") {
          if (ctx.settings.delivery_enabled === false) {
            replies.push(reply.deliveryDisabled(lang));
            patch.stage = "choosing_order_type";
            patch.order_type = null;
            setInteractive(orderTypeButtons(lang, ctx.settings));
            break;
          }
          if (!deliveryAddr?.trim()) {
            replies.push(reply.askAddress(lang));
            patch.stage = "collecting_delivery";
            break;
          }
          if (ctx.settings.delivery_areas?.length > 0 && !findMatchingDeliveryArea(deliveryAddr, ctx.settings)) {
            replies.push(reply.deliveryAreaNotCovered(lang, ctx.settings.delivery_areas));
            patch.stage = "collecting_delivery";
            patch.address = null;
            break;
          }
          const subtotal = cartSubtotal(cart);
          if (ctx.settings.min_delivery_amount > 0 && subtotal < ctx.settings.min_delivery_amount) {
            replies.push(reply.minDeliveryNotMet(lang, subtotal, ctx.settings.min_delivery_amount, cur));
            patch.stage = "confirming";
            replies.push(reply.summary(lang, cart, orderType, cur, deliveryAddr ?? null, ctx.settings));
            setInteractive(cartActionButtons(lang));
            break;
          }
        }
        try {
          const deliveryFee =
            orderType === "delivery" && ctx.settings.delivery_enabled !== false
              ? Number(ctx.settings.delivery_fee) || 0
              : 0;

          const pTime = patch.pickup_time ?? ctx.state.pickup_time;
          const finalPickupTime = pTime ? parseCustomerTimeToIso(pTime, ctx.settings.timezone) : null;
          const rTime = patch.reservation_time ?? ctx.state.reservation_time;
          const finalReservationTime = rTime ? parseCustomerTimeToIso(rTime, ctx.settings.timezone) : null;

          const orderId = await orderRepo.place({
            conversationId: input.conversationId,
            branchId,
            sourceUserMessageId: input.sourceUserMessageId,
            type: orderType,
            items: cart.map((i) => ({
              menu_item_id: i.menu_item_id,
              name: i.name,
              qty: i.qty,
              unit_price: i.unit_price,
              size: i.size,
              addons: i.addons,
              item_instructions: i.notes,
            })),
            customerInstructions: ctx.state.customer_instructions,
            address: deliveryAddr,
            guests: patch.guests ?? ctx.state.guests,
            reservationTime: finalReservationTime,
            pickupTime: finalPickupTime,
            deliveryFee,
          });
          const placed = await orderRepo.getById(orderId);
          replies.push(
            reply.orderPlaced(
              lang,
              placed?.order_number ?? 0,
              cur,
              placed?.total ?? (cartSubtotal(cart) + deliveryFee),
              orderType,
              ctx.settings,
            ),
          );
          placeOrder = true;
          patch.stage = "placed";
          cart = [];
        } catch (err) {
          const msg =
            (err && typeof err === "object" && "message" in err ? String(err.message) : String(err)) ||
            "order failed";
          console.error("[executor] place_order failed:", msg);
          if (/min.*delivery|minimum.*delivery/i.test(msg)) {
            const sub = cartSubtotal(cart);
            replies.push(reply.minDeliveryNotMet(lang, sub, ctx.settings.min_delivery_amount, cur));
            patch.stage = "confirming";
            replies.push(reply.summary(lang, cart, orderType, cur, deliveryAddr ?? null, ctx.settings));
            setInteractive(cartActionButtons(lang));
          } else if (/delivery.*area|outside.*area|area.*outside/i.test(msg)) {
            replies.push(reply.deliveryAreaNotCovered(lang, ctx.settings.delivery_areas));
            patch.stage = "collecting_delivery";
            patch.address = null;
          } else if (/delivery.*not available|not.*available.*delivery/i.test(msg)) {
            replies.push(reply.deliveryDisabled(lang));
            patch.stage = "choosing_order_type";
            patch.order_type = null;
            setInteractive(orderTypeButtons(lang, ctx.settings));
          } else if (/address.*required|required.*address/i.test(msg)) {
            replies.push(reply.askAddress(lang));
            patch.stage = "collecting_delivery";
          } else if (/pickup.*time.*required|required.*pickup.*time/i.test(msg)) {
            replies.push(reply.askPickupTime(lang));
            patch.stage = "collecting_pickup";
          } else if (/guest.*required|reservation.*required/i.test(msg)) {
            replies.push(reply.askDineIn(lang));
            patch.stage = "collecting_dinein";
          } else {
            replies.push(
              lang === "pashto"
                ? "Order place nasho. Laga shiba pas bia koshish wokray."
                : lang === "roman_urdu"
                ? "Order place nahi ho saka. Thori der baad try karein."
                : "Couldn't place the order. Please try again shortly.",
            );
            patch.stage = "confirming";
            replies.push(reply.summary(lang, cart, orderType, cur, deliveryAddr ?? null, ctx.settings));
            setInteractive(confirmButtons(lang));
          }
          patch.last_error = msg;
        }
        break;
      }

      // ── Cancel / restart ─────────────────────────────────────────────────
      case "cancel_order": {
        const recent = await orderRepo.getLatestForConversation(input.conversationId);
        if (recent) {
          const createdAtMs = new Date(recent.created_at).getTime();
          const withinWindow = Number.isFinite(createdAtMs) && Date.now() - createdAtMs <= 10 * 60 * 1000;

          if (recent.status === "cancelled") {
            replies.push(
              lang === "pashto"
                ? `Order #${recent.order_number} mukhey na cancel shaway day.`
                : lang === "roman_urdu"
                ? `Order #${recent.order_number} pehle hi cancel ho chuka hai.`
                : `Order #${recent.order_number} has already been cancelled.`,
            );
          } else if (recent.status === "out_for_delivery" || recent.status === "delivered") {
            replies.push(
              lang === "pashto"
                ? `Bakhana ghwaro, Order #${recent.order_number} delivery dapara rawana shaway day ya rasayedalay day ao os cancel keday nashi. Madad dapara amla sara rabita wokray.`
                : lang === "roman_urdu"
                ? `Maaf kijiyega, Order #${recent.order_number} deliver hone ke liye nikal chuka hai aur ab cancel nahi ho sakta. Madad ke liye hamare staff se rabta karein.`
                : `Sorry, Order #${recent.order_number} is already on its way or delivered and cannot be cancelled. Please contact our support for help.`,
            );
          } else if (recent.status === "received" || withinWindow) {
            await orderRepo.cancelOrder(recent.id);
            await createStaffAlert({
              conversationId: input.conversationId,
              branchId: recent.branch_id || branchId,
              kind: "customer_cancellation",
              severity: "high",
              message: `Order #${recent.order_number} (Rs. ${recent.subtotal}) was cancelled by customer. Do not prepare or dispatch.`,
            }).catch((alertErr) => console.error("Failed to create cancellation staff alert:", alertErr));
            replies.push(reply.orderCancelled(lang));
          } else {
            await orderRepo.requestCancellation(recent.id);
            await createStaffAlert({
              conversationId: input.conversationId,
              branchId: recent.branch_id || branchId,
              kind: "customer_cancellation",
              severity: "high",
              message: `Cancellation requested for Order #${recent.order_number} after prep window. Staff review required.`,
            }).catch((alertErr) => console.error("Failed to create cancellation staff alert:", alertErr));
            replies.push(
              lang === "pashto"
                ? `Staso da Order #${recent.order_number} cancellation darghwast branch staff ta walegala sho.`
                : lang === "roman_urdu"
                ? `Aap ke Order #${recent.order_number} ki cancellation request branch staff ko bhej di gayi hai.`
                : `Cancellation request for Order #${recent.order_number} has been sent to our restaurant staff.`,
            );
          }
        } else {
          replies.push(reply.orderCancelled(lang));
        }
        cart = [];
        break;
      }

      case "restart_order":
        cart = [];
        patch.order_type = null;
        patch.address = null;
        patch.guests = null;
        patch.reservation_time = null;
        patch.pickup_time = null;
        patch.upsell_offered = false;
        replies.push(reply.restarted(lang));
        break;

      // ── Status ───────────────────────────────────────────────────────────
      case "report_order_status": {
        try {
          const recent = await orderRepo.getLatestForConversation(input.conversationId);
          if (recent) replies.push(reply.orderStatus(lang, recent.order_number, recent.status, ctx.settings?.estimated_delivery_minutes));
          else replies.push(reply.noRecentOrder(lang));
        } catch {
          replies.push(reply.noRecentOrder(lang));
        }
        break;
      }

      // ── Escalate ──────────────────────────────────────────────────────────
      case "escalate_human":
        patch.is_bot_active = false;
        patch.escalation_reason = "customer_requested";
        patch.escalated_at = new Date().toISOString();
        replies.push(reply.escalated(lang));
        return {
          replyText: replies.filter(Boolean).join("\n").trim() || reply.escalated(lang),
          statePatch: patch,
          placeOrder: false,
          escalate: true,
          usedSemanticSearch: usedSemantic,
        };

      // ── Smalltalk ────────────────────────────────────────────────────────
      case "smalltalk":
        if (replies.length === 0) replies.push(reply.smalltalk(lang, ctx.state.stage));
        break;

      // ── Clarification ────────────────────────────────────────────────────
      case "ask_clarification":
        replies.push(reply.clarify(lang, String(action.payload?.reason ?? "")));
        break;

      // ── Fallback ─────────────────────────────────────────────────────────
      case "fallback":
      default:
        if (replies.length === 0) {
          if (cart.length > 0) {
            const addr = patch.address ?? ctx.state.address;
            replies.push(reply.summary(lang, cart, patch.order_type ?? ctx.state.order_type, cur, addr ?? null, ctx.settings));
            setInteractive(cartActionButtons(lang, { hideViewCart: true }));
          } else {
            const cats = [...new Set(ctx.menu.map((m) => m.category).filter(Boolean))] as string[];
            replies.push(reply.clarify(lang, "fallback"));
            if (cats.length) setInteractive(categoryList(lang, cats));
          }
        }
        break;
    }
  }

  patch.cart = cart;

  // Filter replies: If size disambiguation is active (variantButtons), do not ask for delivery address or pickup time in the same message
  let finalReplies = replies.filter(Boolean);
  if (hasDisambiguation) {
    finalReplies = finalReplies.filter((r) => {
      if (r.includes("Delivery address bhej") || r.includes("Please send your delivery address") || r.includes("Pichli dafa") || r.includes("Last time you used")) return false;
      if (r.includes("Pickup kis waqt") || r.includes("What time will you pick up")) return false;
      if (r.includes("Kitne log") || r.includes("How many guests")) return false;
      return true;
    });
    // Override stage to building_cart so next turn's fast-paths (numeric selection, name matching) work
    patch.stage = "building_cart";
  }

  // De-duplicate identical consecutive lines
  finalReplies = finalReplies.filter((line, idx, arr) => idx === 0 || line !== arr[idx - 1]);

  return {
    replyText: finalReplies.join("\n").trim() || reply.clarify(lang, "fallback"),
    statePatch: patch,
    placeOrder,
    escalate: false,
    usedSemanticSearch: usedSemantic,
    interactive,
    mediaUrls,
  };
}
