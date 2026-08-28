/**
 * lib/agent/executor.ts — Phase 7
 *
 * Executes the FSM's AgentAction[] for one turn: performs the async work
 * (vector search, cart mutation, order placement) and produces reply text +
 * a state patch. Replaces the imperative branches of the old order-engine.
 *
 * Pure-ish: all IO goes through repos / lib/menu/search. Returns data; the
 * pipeline persists + dispatches.
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
  type InteractivePayload,
} from "./interactive";
import type { TurnContext } from "./context";
import type { CartItem, ConversationStateRow, LanguagePreference, OrderType } from "@/lib/schema.types";

export interface ExecutionResult {
  replyText: string;
  statePatch: Partial<ConversationStateRow>;
  placeOrder: boolean;
  escalate: boolean;
  usedSemanticSearch: boolean;
  /** Optional WhatsApp interactive attachment (buttons or list). */
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
  /** Raw message text, used as a last-resort grounded-answer query. */
  messageTextForFallback?: string;
}

export async function executeTurn(input: ExecInput): Promise<ExecutionResult> {
  const { transition, understanding: u, ctx, branchId } = input;
  const lang: LanguagePreference = u.language || ctx.state.preferred_language;
  const currency = input.currency;

  let cart: CartItem[] = ctx.state.cart.map((i) => ({ ...i }));
  const patch: Partial<ConversationStateRow> = {
    stage: transition.nextStage,
    preferred_language: lang,
    last_intent: u.primary_intent,
  };
  const replies: string[] = [];
  let placeOrder = false;
  let usedSemantic = false;
  let interactive: InteractivePayload | null = null;

  // Grounded-answer helper: answers ANY question from real menu + settings.
  const answerGrounded = async (question: string): Promise<string | null> =>
    groundedAnswer({
      question,
      language: lang,
      appName: input.appName,
      currency,
      settings: ctx.settings,
      menu: ctx.menu,
      isOpenNow: ctx.isOpenNow,
    });

  // Escalation short-circuits.
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

  if (!ctx.isOpenNow) {
    // Still allow browsing/info, but flag closed on order attempts.
    const orderingActions = new Set(["place_order", "ask_order_type", "collect_delivery_address"]);
    if (transition.actions.some((a) => orderingActions.has(a.kind))) {
      replies.push(reply.closed(lang, ctx.settings.opening_time));
    }
  }

  for (const action of transition.actions) {
    switch (action.kind) {
      case "greet":
        replies.push(reply.greeting(lang, input.appName));
        break;

      case "add_items": {
        const mentions = (action.payload?.items as TurnUnderstanding["items"]) ?? u.items;
        const added: Array<{ name: string; qty: number }> = [];
        for (const m of mentions) {
          const resolved = await resolveItem(branchId, m.query);
          if (resolved?.method === "vector") usedSemantic = true;
          if (!resolved) {
            const { matches } = await searchMenu(branchId, m.query, 3);
            if (matches.length) {
              // Offer close matches as a tap-list instead of a flat "not found".
              replies.push(reply.notFound(lang, m.query, matches.map((x) => x.name)));
              interactive = interactive ?? itemPickList(
                lang,
                matches.map((x) => ({ id: x.id, name: x.name, price: x.price, category: x.category })),
                currency,
              );
              patch.last_shown_options = matches.map((x) => ({ id: x.id, name: x.name, price: x.price }));
              patch.last_shown_options_at = new Date().toISOString();
            } else {
              // Genuinely unknown item → grounded reply (suggests real options).
              const g = await answerGrounded(`customer wants "${m.query}" — is it available? if not, what similar items do you have?`);
              replies.push(g ?? reply.notFound(lang, m.query, []));
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
          added.push({ name: resolved.name, qty: m.qty ?? 1 });
        }
        if (added.length) replies.push(reply.itemsAdded(lang, added, cart, currency));
        break;
      }

      case "remove_items": {
        const removals = (action.payload?.removals as TurnUnderstanding["removals"]) ?? u.removals;
        for (const r of removals) {
          const resolved = await resolveItem(branchId, r.query);
          cart = removeFromCart(cart, { menu_item_id: resolved?.id, name: resolved?.name ?? r.query, qty: r.qty });
        }
        replies.push(reply.itemsRemoved(lang, cart, currency));
        break;
      }

      case "update_quantity": {
        const items = (action.payload?.items as TurnUnderstanding["items"]) ?? u.items;
        for (const m of items) {
          const resolved = await resolveItem(branchId, m.query);
          cart = updateQuantity(cart, { menu_item_id: resolved?.id, name: resolved?.name ?? m.query, qty: m.qty ?? 1 });
        }
        replies.push(reply.itemsAdded(lang, [], cart, currency));
        break;
      }

      case "show_menu":
      case "answer_info": {
        const query = (action.payload?.query as string) ?? u.info_query ?? "";

        // 1) Try semantic search to surface concrete items (enables a tap-list).
        let matches: Awaited<ReturnType<typeof searchMenu>>["matches"] = [];
        if (query) {
          const res = await searchMenu(branchId, query, 6);
          usedSemantic = usedSemantic || res.usedEmbedding;
          matches = res.matches;
        } else if (ctx.menu.length) {
          // bare browse → show categories as a list
          const cats = Array.from(new Set(ctx.menu.map((m) => m.category).filter(Boolean))) as string[];
          if (cats.length > 1) interactive = interactive ?? categoryList(lang, cats);
          matches = ctx.menu.slice(0, 6).map((m) => ({
            id: m.id, name: m.name, price: m.price, category: m.category,
            description: null, is_available: true, similarity: null, method: "lexical" as const,
          }));
        }

        // 2) Always ANSWER with grounded LLM (natural, never "not on menu"),
        //    passing the search hits as focus so prices/names stay exact.
        const grounded = query
          ? await answerGrounded(query)
          : null;
        if (grounded) {
          replies.push(grounded);
        } else if (matches.length) {
          replies.push(reply.info(lang, matches.slice(0, 5).map((mm) => `• ${mm.name} — ${currency} ${mm.price}`)));
        } else {
          // last resort: still helpful, not a dead end
          const fallbackAns = await answerGrounded(query || "what do you have on the menu");
          replies.push(fallbackAns ?? reply.recommendation(lang, ctx.menu.slice(0, 4), currency));
        }

        // 3) Attach a tap-list of the concrete items we found (if any).
        if (matches.length) {
          patch.last_shown_options = matches.slice(0, 10).map((mm) => ({ id: mm.id, name: mm.name, price: mm.price }));
          patch.last_shown_options_at = new Date().toISOString();
          interactive = interactive ?? itemPickList(
            lang,
            matches.slice(0, 10).map((mm) => ({ id: mm.id, name: mm.name, price: mm.price, category: mm.category })),
            currency,
          );
        }
        break;
      }

      case "answer_grounded": {
        const query = (action.payload?.query as string) ?? u.info_query ?? input.messageTextForFallback ?? "";
        const grounded = await answerGrounded(query || "help me");
        replies.push(grounded ?? reply.clarify(lang, "fallback"));
        break;
      }

      case "answer_payment":
        replies.push((await answerGrounded("how can I pay / payment methods")) ?? reply.payment(lang));
        break;

      case "answer_hours_location":
        replies.push(
          (await answerGrounded("what are your opening hours and location")) ??
            reply.info(lang, [`${ctx.settings.opening_time} - ${ctx.settings.closing_time}`]),
        );
        break;

      case "offer_upsell":
        // Non-blocking; keep it lightweight for now (real upsell selection = future).
        patch.upsell_offered = true;
        break;

      case "ask_order_type": {
        const chosen = action.payload?.chosen as OrderType | undefined;
        if (chosen) {
          patch.order_type = chosen;
        } else {
          replies.push(reply.askOrderType(lang));
          interactive = interactive ?? orderTypeButtons(lang);
        }
        break;
      }

      case "collect_delivery_address": {
        const address = action.payload?.address as string | undefined;
        if (address) {
          patch.address = address;
          patch.order_type = patch.order_type ?? "delivery";
        } else {
          replies.push(reply.askAddress(lang));
        }
        break;
      }

      case "collect_dinein_details": {
        const guests = action.payload?.guests as number | null | undefined;
        const rtime = action.payload?.reservation_time as string | null | undefined;
        if (guests) patch.guests = guests;
        if (rtime) patch.reservation_time = rtime;
        if (!guests && !rtime) replies.push(reply.askDineIn(lang));
        break;
      }

      case "collect_pickup_time": {
        const ptime = action.payload?.pickup_time as string | undefined;
        if (ptime) patch.pickup_time = ptime;
        else replies.push(reply.askPickupTime(lang));
        break;
      }

      case "show_summary":
        if (cart.length === 0) {
          replies.push(reply.emptyCart(lang));
        } else {
          replies.push(reply.summary(lang, cart, patch.order_type ?? ctx.state.order_type, currency));
          interactive = interactive ?? confirmButtons(lang);
        }
        break;

      case "place_order": {
        if (cart.length === 0) {
          replies.push(reply.emptyCart(lang));
          break;
        }
        const orderType = (patch.order_type ?? ctx.state.order_type) as OrderType | null;
        if (!orderType) {
          replies.push(reply.askOrderType(lang));
          patch.stage = "choosing_order_type";
          break;
        }
        try {
          const orderId = await orderRepo.place({
            conversationId: input.conversationId,
            branchId,
            sourceUserMessageId: input.sourceUserMessageId,
            type: orderType,
            items: cart.map((i) => ({
              name: i.name,
              qty: i.qty,
              size: i.size,
              addons: i.addons,
              item_instructions: i.notes,
            })),
            customerInstructions: ctx.state.customer_instructions,
            address: patch.address ?? ctx.state.address,
            guests: patch.guests ?? ctx.state.guests,
            reservationTime: patch.reservation_time ?? ctx.state.reservation_time,
            pickupTime: patch.pickup_time ?? ctx.state.pickup_time,
          });
          const placed = await orderRepo.getById(orderId);
          replies.push(reply.orderPlaced(lang, placed?.order_number ?? 0, currency, placed?.total ?? cartSubtotal(cart)));
          placeOrder = true;
          patch.stage = "placed";
          cart = [];
        } catch (error) {
          const msg = error instanceof Error ? error.message : "order failed";
          console.error("[executor] place_order failed:", msg);
          replies.push(reply.clarify(lang, "order_error"));
          patch.last_error = msg;
        }
        break;
      }

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

      case "reorder_previous": {
        replies.push(reply.info(lang, [reply.noRecentOrder(lang)])); // full reorder wiring = follow-up
        break;
      }

      case "report_order_status": {
        const recent = await orderRepo.getLatestForConversation(input.conversationId);
        if (recent) replies.push(reply.orderStatus(lang, recent.order_number, recent.status));
        else replies.push(reply.noRecentOrder(lang));
        break;
      }

      case "ask_clarification":
        replies.push(reply.clarify(lang, String(action.payload?.reason ?? "")));
        break;

      case "smalltalk":
        if (!replies.length) replies.push(reply.greeting(lang, input.appName));
        break;

      case "fallback":
      default:
        if (!replies.length) {
          // Even on true fallback, try a grounded reply on the raw message before
          // giving the generic "didn't get that".
          const g = await answerGrounded(input.messageTextForFallback || "help me order");
          replies.push(g ?? reply.clarify(lang, "fallback"));
        }
        break;
    }
  }

  patch.cart = cart;

  return {
    replyText: replies.filter(Boolean).join("\n\n").trim() || reply.clarify(lang, "fallback"),
    statePatch: patch,
    placeOrder,
    escalate: false,
    usedSemanticSearch: usedSemantic,
    interactive,
  };
}
