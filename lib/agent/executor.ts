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
import { searchMenu, resolveItem } from "@/lib/menu/search";
import { orderRepo } from "@/lib/data/order.repo";
import { groundedAnswer } from "./answer";
import {
  orderTypeButtons,
  confirmButtons,
  itemPickList,
  categoryList,
  cartActionButtons,
  type InteractivePayload,
} from "./interactive";
import type { TurnContext } from "./context";
import type { CartItem, ConversationStateRow, LanguagePreference, OrderType } from "@/lib/schema.types";
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
  let interactive: InteractivePayload | null = null;

  // ── Helpers ──────────────────────────────────────────────────────────────

  const setInteractive = (p: InteractivePayload | null) => { if (!interactive && p) interactive = p; };

  /** Deterministic hours/location answer — never calls LLM. */
  const hoursAnswer = (): string => {
    const s = ctx.settings;
    const status = ctx.isOpenNow ? (lang === "roman_urdu" ? "✅ Abhi KHULA hai" : "✅ Open right now") : (lang === "roman_urdu" ? "🔴 Abhi BAND hai" : "🔴 Closed right now");
    if (lang === "roman_urdu") {
      return `${status}\n🕐 Hours: ${s.opening_time} – ${s.closing_time}${s.city ? `\n📍 City: ${s.city}` : ""}`;
    }
    return `${status}\n🕐 Hours: ${s.opening_time} – ${s.closing_time}${s.city ? `\n📍 City: ${s.city}` : ""}`;
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
        ? "Delivery abhi available nahi — sirf Pickup ya Dine-in ho sakta hai."
        : "Delivery isn't available right now — Pickup or Dine-in only.";
    }
    const parts: string[] = [];
    if (lang === "roman_urdu") {
      parts.push("✅ Delivery available hai");
      if (s.delivery_areas.length) parts.push(`📍 Areas: ${s.delivery_areas.join(", ")}`);
      if (s.delivery_fee) parts.push(`💰 Fee: ${cur} ${s.delivery_fee}`);
      if (s.min_delivery_amount) parts.push(`🛒 Min order: ${cur} ${s.min_delivery_amount}`);
      if (s.estimated_delivery_minutes) parts.push(`⏱ Time: ~${s.estimated_delivery_minutes} min`);
    } else {
      parts.push("✅ Delivery is available");
      if (s.delivery_areas.length) parts.push(`📍 Areas: ${s.delivery_areas.join(", ")}`);
      if (s.delivery_fee) parts.push(`💰 Fee: ${cur} ${s.delivery_fee}`);
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

        for (const m of mentions) {
          let query = m.query;
          if (isDelta && query === "__last_item__" && cart.length > 0) {
            query = cart[cart.length - 1].name;
          }
          const resolved = await resolveItem(branchId, query, ctx.menu);
          if (resolved?.method === "vector") usedSemantic = true;
          if (!resolved) {
            const { matches } = await searchMenu(branchId, query, 4, ctx.menu);
            if (matches.length) {
              replies.push(reply.notFound(lang, query, matches.map((x) => x.name)));
              patch.last_shown_options = matches.map((x) => ({ id: x.id, name: x.name, price: x.price }));
              patch.last_shown_options_at = new Date().toISOString();
              setInteractive(itemPickList(lang, matches.map((x) => ({ id: x.id, name: x.name, price: x.price, category: x.category })), cur));
            } else {
              const ans = await grounded(`customer wants "${query}" — is it available? suggest similar items if not`);
              replies.push(ans ?? reply.notFound(lang, query, []));
            }
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
        }

        if (added.length) {
          replies.push(reply.itemsAdded(lang, added, cart, cur));
          setInteractive(cartActionButtons(lang));
        }
        break;
      }

      // ── Remove items ─────────────────────────────────────────────────────
      case "remove_items": {
        const removals = (action.payload?.removals as TurnUnderstanding["removals"]) ?? u.removals;
        for (const r of removals) {
          const resolved = await resolveItem(branchId, r.query, ctx.menu);
          cart = removeFromCart(cart, { menu_item_id: resolved?.id, name: resolved?.name ?? r.query, qty: r.qty });
        }
        replies.push(reply.itemsRemoved(lang, cart, cur));
        if (cart.length > 0) setInteractive(cartActionButtons(lang));
        break;
      }

      // ── Update quantity ──────────────────────────────────────────────────
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

      // ── Menu browse / item info ──────────────────────────────────────────
      case "show_menu":
      case "answer_info": {
        const query = (action.payload?.query as string) ?? u.info_query ?? "";
        let matches: Awaited<ReturnType<typeof searchMenu>>["matches"] = [];

        if (query) {
          const res = await searchMenu(branchId, query, 6, ctx.menu);
          usedSemantic = usedSemantic || res.usedEmbedding;
          matches = res.matches;
        } else {
          // Bare "menu" — show categories
          const cats = [...new Set(ctx.menu.map((m) => m.category).filter(Boolean))] as string[];
          if (cats.length > 1) setInteractive(categoryList(lang, cats));
          matches = ctx.menu.slice(0, 6).map((m) => ({
            id: m.id, name: m.name, price: m.price, category: m.category,
            description: null, is_available: true, similarity: null, method: "lexical" as const,
          }));
        }

        if (matches.length) {
          patch.last_shown_options = matches.slice(0, 10).map((mm) => ({ id: mm.id, name: mm.name, price: mm.price }));
          patch.last_shown_options_at = new Date().toISOString();
          setInteractive(itemPickList(lang, matches.slice(0, 10).map((mm) => ({ id: mm.id, name: mm.name, price: mm.price, category: mm.category })), cur));
        }

        // Use grounded answer to describe items accurately (passed relevantItems so it's focused)
        const relevantItems = matches.slice(0, 6).map((mm) => ({ name: mm.name, price: mm.price, category: mm.category ?? null, description: null }));
        const ans = query
          ? await groundedAnswer({ question: query, language: lang, appName: input.appName, currency: cur, settings: ctx.settings, menu: ctx.menu, isOpenNow: ctx.isOpenNow, relevantItems: relevantItems.length ? relevantItems : undefined })
          : null;

        if (ans) {
          replies.push(ans);
        } else if (matches.length) {
          replies.push(reply.itemList(lang, matches.slice(0, 6).map((mm) => ({ name: mm.name, price: mm.price })), cur));
        } else {
          replies.push(lang === "roman_urdu" ? "Koi matching item nahi mila. Koi aur cheez batayein?" : "No matching items found. Try something else?");
        }
        break;
      }

      // ── Deterministic factual answers ────────────────────────────────────
      case "answer_hours_location":
        replies.push(hoursAnswer());
        break;

      case "answer_payment":
        replies.push(paymentAnswer());
        break;

      case "answer_delivery_info":
        replies.push(deliveryInfoAnswer());
        break;

      // ── General grounded answer (non-menu question) ───────────────────────
      case "answer_grounded": {
        const question = (action.payload?.query as string) ?? u.info_query ?? input.messageTextForFallback ?? "";
        if (!question) break;
        const ans = await grounded(question);
        if (ans) replies.push(ans);
        break;
      }

      // ── Order type ───────────────────────────────────────────────────────
      case "ask_order_type": {
        const chosen = action.payload?.chosen as OrderType | undefined;
        if (chosen) {
          patch.order_type = chosen;
          // No text reply here — the next action (promptForStage) will reply
        } else {
          replies.push(reply.askOrderType(lang));
          setInteractive(orderTypeButtons(lang));
        }
        break;
      }

      // ── Collect delivery address ─────────────────────────────────────────
      case "collect_delivery_address": {
        const address = action.payload?.address as string | undefined;
        const savedAddrNote = u.notes?.match(/^use_saved_address:(.+)$/);
        if (savedAddrNote) {
          const { data: savedRow } = await supabaseAdmin
            .from("customer_addresses")
            .select("address")
            .eq("id", savedAddrNote[1])
            .maybeSingle();
          if (savedRow?.address) {
            patch.address = savedRow.address;
            patch.order_type = patch.order_type ?? "delivery";
            replies.push(reply.savedAddressConfirmed(lang, savedRow.address));
          } else {
            replies.push(reply.askAddress(lang));
          }
        } else if (address) {
          patch.address = address;
          patch.order_type = patch.order_type ?? "delivery";
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
            replies.push(reply.askAddress(lang));
          }
        }
        break;
      }

      // ── Collect dine-in details ──────────────────────────────────────────
      case "collect_dinein_details": {
        const guests = action.payload?.guests as number | null | undefined;
        const rtime = action.payload?.reservation_time as string | null | undefined;
        if (guests) patch.guests = guests;
        if (rtime) patch.reservation_time = rtime;
        if (!guests && !rtime) replies.push(reply.askDineIn(lang));
        break;
      }

      // ── Collect pickup time ──────────────────────────────────────────────
      case "collect_pickup_time": {
        const ptime = action.payload?.pickup_time as string | undefined;
        if (ptime) patch.pickup_time = ptime;
        else replies.push(reply.askPickupTime(lang));
        break;
      }

      // ── Cart / summary ───────────────────────────────────────────────────
      case "show_cart":
        if (cart.length === 0) {
          replies.push(reply.emptyCart(lang));
        } else {
          replies.push(reply.summary(lang, cart, patch.order_type ?? ctx.state.order_type, cur));
          setInteractive(cartActionButtons(lang));
        }
        break;

      case "show_summary":
        if (cart.length === 0) {
          replies.push(reply.emptyCart(lang));
        } else {
          replies.push(reply.summary(lang, cart, patch.order_type ?? ctx.state.order_type, cur));
          setInteractive(confirmButtons(lang));
        }
        break;

      // ── Place order ──────────────────────────────────────────────────────
      case "place_order": {
        if (cart.length === 0) { replies.push(reply.emptyCart(lang)); break; }
        const orderType = (patch.order_type ?? ctx.state.order_type) as OrderType | null;
        if (!orderType) {
          replies.push(reply.askOrderType(lang));
          patch.stage = "choosing_order_type";
          setInteractive(orderTypeButtons(lang));
          break;
        }
        try {
          const orderId = await orderRepo.place({
            conversationId: input.conversationId,
            branchId,
            sourceUserMessageId: input.sourceUserMessageId,
            type: orderType,
            items: cart.map((i) => ({ name: i.name, qty: i.qty, size: i.size, addons: i.addons, item_instructions: i.notes })),
            customerInstructions: ctx.state.customer_instructions,
            address: patch.address ?? ctx.state.address,
            guests: patch.guests ?? ctx.state.guests,
            reservationTime: patch.reservation_time ?? ctx.state.reservation_time,
            pickupTime: patch.pickup_time ?? ctx.state.pickup_time,
          });
          const placed = await orderRepo.getById(orderId);
          replies.push(reply.orderPlaced(lang, placed?.order_number ?? 0, cur, placed?.total ?? cartSubtotal(cart)));
          placeOrder = true;
          patch.stage = "placed";
          cart = [];
        } catch (err) {
          const msg = err instanceof Error ? err.message : "order failed";
          console.error("[executor] place_order failed:", msg);
          replies.push(lang === "roman_urdu" ? "Order mein kuch masla hua. Dobara try karein ya staff se baat karein." : "Something went wrong placing your order. Please try again or contact staff.");
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

      case "reorder_previous":
        replies.push(reply.noRecentOrder(lang));
        break;

      // ── Status ───────────────────────────────────────────────────────────
      case "report_order_status": {
        const recent = await orderRepo.getLatestForConversation(input.conversationId);
        if (recent) replies.push(reply.orderStatus(lang, recent.order_number, recent.status));
        else replies.push(reply.noRecentOrder(lang));
        break;
      }

      // ── Smalltalk ────────────────────────────────────────────────────────
      case "smalltalk":
        if (replies.length === 0) replies.push(reply.greeting(lang, input.appName));
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
            replies.push(reply.summary(lang, cart, patch.order_type ?? ctx.state.order_type, cur));
            setInteractive(cartActionButtons(lang));
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

  return {
    replyText: replies.filter(Boolean).join("\n").trim() || reply.clarify(lang, "fallback"),
    statePatch: patch,
    placeOrder,
    escalate: false,
    usedSemanticSearch: usedSemantic,
    interactive,
  };
}
