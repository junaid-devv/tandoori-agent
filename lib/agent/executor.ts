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
import { searchMenu, resolveItem, resolveItemDetailed } from "@/lib/menu/search";
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

export interface ExecutionResult {
  replyText: string;
  statePatch: Partial<ConversationStateRow>;
  placeOrder: boolean;
  escalate: boolean;
  usedSemanticSearch: boolean;
  interactive?: InteractivePayload | null;
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
}

export async function executeTurn(input: ExecInput): Promise<ExecutionResult> {
  const { transition, understanding: u, ctx, branchId } = input;
  const lang: LanguagePreference = u.language || ctx.state.preferred_language;
  const cur = input.currency;

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

  // ── Helpers ──────────────────────────────────────────────────────────────

  const setInteractive = (p: InteractivePayload | null) => { if (!interactive && p) interactive = p; };

  /** Deterministic hours/location answer — never calls LLM. */
  const hoursAnswer = (): string => {
    const s = ctx.settings;
    const status = ctx.isOpenNow
      ? (lang === "roman_urdu" ? "✅ Restaurant abhi KHULA hai" : "✅ We are currently OPEN")
      : (lang === "roman_urdu" ? "🔴 Restaurant abhi BAND hai" : "🔴 We are currently CLOSED");
    if (lang === "roman_urdu") {
      return `${status}\n🕐 Timings: ${s.opening_time} – ${s.closing_time}${s.city ? `\n📍 Location: ${s.city}` : ""}`;
    }
    return `${status}\n🕐 Hours: ${s.opening_time} – ${s.closing_time}${s.city ? `\n📍 Location: ${s.city}` : ""}`;
  };

  /** Deterministic payment answer — never calls LLM. */
  const paymentAnswer = (): string => {
    return lang === "roman_urdu"
      ? "💵 Filhaal sirf *Cash on Delivery (COD)* available hai."
      : "💵 We only accept *Cash on Delivery (COD)* at this time.";
  };

  /** Deterministic delivery info answer — never calls LLM. */
  const deliveryInfoAnswer = (): string => {
    const s = ctx.settings;
    if (!s.delivery_enabled) {
      return lang === "roman_urdu"
        ? `Maafi chahte hain, is waqt delivery service band hai — sirf Pickup ya Dine-in available hai.\n🕐 Restaurant Timings: ${s.opening_time} – ${s.closing_time}`
        : `Sorry, delivery service is currently closed — Pickup or Dine-in only.\n🕐 Restaurant Hours: ${s.opening_time} – ${s.closing_time}`;
    }
    const parts: string[] = [];
    if (lang === "roman_urdu") {
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

  const grounded = async (question: string): Promise<string | null> =>
    groundedAnswer({ question, language: lang, appName: input.appName, currency: cur, settings: ctx.settings, menu: ctx.menu, isOpenNow: ctx.isOpenNow });

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

  // ── Action dispatch ───────────────────────────────────────────────────────
  for (const action of transition.actions) {
    switch (action.kind) {

      // ── Greet ────────────────────────────────────────────────────────────
      case "greet": {
        const wasSalam = /^(aoa|a\.?o\.?a|assalam|salam)\b/i.test(input.messageTextForFallback?.trim() ?? "");
        replies.push(reply.greeting(lang, input.appName, input.customerName ?? null, wasSalam));
        const cats = [...new Set(ctx.menu.map((m) => m.category).filter(Boolean))] as string[];
        if (cats.length > 0) {
          setInteractive(categoryList(lang, cats, lang === "roman_urdu" ? "Kya mangwana hai?" : "What would you like?"));
        }
        break;
      }

      // ── Add items ────────────────────────────────────────────────────────
      case "add_items": {
        if (action.payload?.fromUpsell) break; // upsell not implemented — skip silently

        const mentions = (action.payload?.items as TurnUnderstanding["items"]) ?? u.items;
        const isDelta = u.notes === "add_delta";
        const added: Array<{ name: string; newCartQty: number }> = [];
        const cats = [...new Set(ctx.menu.map((m) => m.category).filter(Boolean))] as string[];

        for (const m of mentions) {
          let query = m.query || "";
          if (isDelta && query === "__last_item__" && cart.length > 0) {
            query = cart[cart.length - 1].name;
          }
          if (!query.trim()) continue;

          const res = await resolveItemDetailed(branchId, query, m.size, ctx.menu);
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
            added.push({ name: resolved.name, newCartQty: cartItem?.qty ?? (m.qty ?? 1) });
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
                setInteractive(categoryList(lang, cats, lang === "roman_urdu" ? "Menu dekhna chahenge?" : "What would you like?"));
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
          const resolved = await resolveItem(branchId, m.query, ctx.menu);
          cart = updateQuantity(cart, { menu_item_id: resolved?.id, name: resolved?.name ?? m.query, qty: m.qty ?? 1 });
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

      case "answer_delivery_info":
        replies.push(deliveryInfoAnswer());
        break;

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
        // Menu item / general question:
        const ans = await grounded(q || "what are your popular items?");
        if (ans) {
          replies.push(ans);
        } else {
          // Fallback to searching the menu
          const searchRes = await resolveItemDetailed(branchId, q, undefined, ctx.menu);
          if (searchRes.kind === "exact") {
            const { matches } = await searchMenu(branchId, q, 3, ctx.menu);
            if (matches.length) {
              replies.push(reply.itemList(lang, matches, cur));
              setInteractive(itemPickList(lang, matches, cur));
            } else {
              replies.push(hoursAnswer());
            }
          } else if (searchRes.kind === "variants") {
            replies.push(reply.itemVariants(lang, searchRes.baseName, searchRes.variants, cur));
            setInteractive(itemPickList(lang, searchRes.variants, cur));
          } else if (searchRes.kind === "ambiguous") {
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
        const cats = [...new Set(ctx.menu.map((m) => m.category).filter(Boolean))] as string[];
        const categoryQuery =
          (action.payload?.category as string | undefined) ??
          (u.info_query as string | undefined);

        if (categoryQuery) {
          const normQuery = categoryQuery.toLowerCase().trim();
          const categoryItems = ctx.menu.filter((m) =>
            m.category && (
              m.category.toLowerCase().includes(normQuery) ||
              normQuery.includes(m.category.toLowerCase())
            )
          );
          if (categoryItems.length > 0) {
            patch.last_shown_options = categoryItems.map((m) => ({ id: m.id, name: m.name, price: m.price }));
            patch.last_shown_options_at = new Date().toISOString();
            patch.last_shown_category = categoryQuery;
            replies.push(reply.itemList(lang, categoryItems, cur, categoryQuery));
            setInteractive(itemPickList(lang, categoryItems, cur));
            break;
          }
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
          }
        } else {
          const saved = ctx.savedAddress;
          if (saved) {
            replies.push(reply.askAddressWithSaved(lang, saved.label));
            setInteractive({
              kind: "buttons",
              payload: {
                body: lang === "roman_urdu" ? "Delivery address?" : "Delivery address?",
                buttons: [
                  { id: `addr:saved:${saved.id}`, title: lang === "roman_urdu" ? "Pichla Address" : "Use Saved" },
                  { id: "addr:new", title: lang === "roman_urdu" ? "Naya Address" : "New Address" },
                ],
              },
            });
          } else {
            const areaHint = buildDeliveryAreaHint(ctx.settings, lang === "roman_urdu");
            replies.push(`${reply.askAddress(lang)}${areaHint}`);
          }
        }
        break;
      }

      // ── Collect dine-in details ──────────────────────────────────────────
      case "collect_dinein_details": {
        const guests = action.payload?.guests as number | null | undefined;
        const rtime = action.payload?.reservation_time as string | null | undefined;
        if (guests) patch.guests = guests;
        if (rtime) patch.reservation_time = parseCustomerTimeToIso(rtime, ctx.settings.timezone);
        if (!guests && !rtime) replies.push(reply.askDineIn(lang));
        break;
      }

      // ── Collect pickup time ──────────────────────────────────────────────
      case "collect_pickup_time": {
        const ptime = action.payload?.pickup_time as string | undefined;
        if (ptime) {
          patch.pickup_time = parseCustomerTimeToIso(ptime, ctx.settings.timezone);
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
        const addr = patch.address ?? ctx.state.address;
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
          const msg = err instanceof Error ? err.message : "order failed";
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
              lang === "roman_urdu"
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
        if (recent) await orderRepo.requestCancellation(recent.id);
        replies.push(reply.orderCancelled(lang));
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
          if (recent) replies.push(reply.orderStatus(lang, recent.order_number, recent.status));
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
      if (r.includes("Delivery address bhej") || r.includes("Please send your delivery address")) return false;
      if (r.includes("Pickup kis waqt") || r.includes("What time will you pick up")) return false;
      if (r.includes("Kitne log") || r.includes("How many guests")) return false;
      return true;
    });
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
  };
}
