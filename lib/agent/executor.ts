/**
 * lib/agent/executor.ts
 *
 * Executes AgentAction[] for one turn. Produces replyText + statePatch.
 *
 * Key principles:
 * - Factual questions (hours, payment, delivery info) are answered deterministically
 *   from settings — zero LLM calls, zero timeouts.
 * - Named menu facts are rendered directly. Free-form questions share a bounded
 *   generation budget so several questions cannot multiply the timeout.
 * - Replies are built as a flat string[] and joined with a single newline.
 *   No \n\n inside individual reply strings.
 * - The final action owns the interactive payload shown to the customer.
 */
import type { Transition } from "./state-machine";
import type { TurnUnderstanding } from "./nlu";
import { reply } from "./reply";
import { addToCart, removeFromCart, findCartMatches, cartSubtotal } from "./cart";
import { searchMenu, resolveItemDetailed, extractBaseItemName, menuNameCoversQuery } from "@/lib/menu/search";
import { orderRepo } from "@/lib/data/order.repo";
import { groundedAnswer } from "./answer";
import { catalogQuestionMatches, deliveryQuestionTopics } from "./questions";
import {
  orderTypeButtons,
  confirmButtons,
  itemPickList,
  categoryList,
  cartActionButtons,
  variantButtons,
  type InteractivePayload,
} from "./interactive";
import { invalidateSettingsContext, type TurnContext } from "./context";
import type { CartItem, ConversationStateRow, LanguagePreference, OrderType } from "@/lib/schema.types";
import { resolveDeliveryQuote, deliveryFeeInfo, outsideAreaDeliveryInfo, outsideAreaDeliveryRate } from "@/lib/delivery-pricing";
import { deliveryAreaNames, hasDeliveryRestrictions, findMatchingDeliveryArea, isCompleteDeliveryAddress } from "./delivery";
import { parseCustomerTimeToIso } from "@/lib/restaurant-time";
import { createStaffAlert } from "@/lib/staff-alerts";
import { isValidDeliveryAddress } from "@/lib/customer-crm";
import { getMenuCatalog, invalidateMenuCache } from "@/lib/menu";
import { isWithinOperatingHours } from "@/lib/settings";
import { sharedLocationPin } from "@/lib/location-pin";


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

  let cart: CartItem[] = ctx.state.cart.map((i) => ({ ...i, addons: [...(i.addons ?? [])] }));
  const patch: Partial<ConversationStateRow> = {
    stage: transition.nextStage,
    preferred_language: lang,
    last_intent: u.primary_intent,
  };

  const value = <K extends keyof ConversationStateRow>(key: K): ConversationStateRow[K] =>
    patch[key] !== undefined ? patch[key] as ConversationStateRow[K] : ctx.state[key];
  const orderChanged = transition.actions.some((a) => ["add_items", "remove_items", "update_quantity", "restart_order", "reorder_previous"].includes(a.kind))
    || Boolean(u.order_type || u.address || u.guests || u.pickup_time || u.reservation_time || u.notes?.startsWith("use_saved_address:") || u.intents.includes("use_saved_address"));
  if (orderChanged) patch.summary_sent_at = null;
  // A follow-up "yes" must answer the latest question, not an older checkout.
  if (transition.actions.some((a) => ["answer_info", "answer_grounded", "answer_hours_location", "answer_payment", "answer_delivery_info", "smalltalk", "show_menu", "report_order_status", "fallback"].includes(a.kind))) {
    patch.summary_sent_at = null;
    if (!ctx.state.pending_clarification?.remaining_items?.length) patch.pending_clarification = null;
  }

  // Persist rider/kitchen notes from NLU (exclude internal markers)
  const INTERNAL_NOTES = new Set(["add_delta", "coercion_failed", "nlu_error", "nlu_circuit_open", "prompt_new_address"]);
  if (u.notes && !u.notes.startsWith("fast_path") && !u.notes.startsWith("use_saved_address") && !INTERNAL_NOTES.has(u.notes) && u.notes.length > 5) {
    patch.customer_instructions = [ctx.state.customer_instructions, u.notes].filter(Boolean).filter((n, i, all) => all.indexOf(n) === i).join("; ").slice(-1000);
    patch.summary_sent_at = null;
  }

  const replies: string[] = [];
  let placeOrder = false;
  let outsideAreaQuoteRequested = false;
  let usedSemantic = false;
  let hasDisambiguation = false;
  let interactive: InteractivePayload | null = null;
  let mediaUrls: string[] | undefined = undefined;
  const addedInTurn: Array<{ name: string; newCartQty: number; notes?: string | null }> = [];
  let carriedPending = ctx.state.pending_clarification?.remaining_items?.length
    ? ctx.state.pending_clarification : null;


  const setInteractive = (p: InteractivePayload | null) => {
    if (p) {
      interactive = p;
      if (p.kind === "buttons") {
        const isOrderType = p.payload.buttons.some((b) => b.id.startsWith("ordertype:"));
        patch.pending_clarification = {
          kind: isOrderType ? "order_type" : "item_disambiguation",
          options: p.payload.buttons.map((b) => ({ id: b.id, label: b.title })),
        };
        const isActionOrConfirm = p.payload.buttons.some((b) =>
          /^(action|confirm|ordertype|addr):/.test(b.id)
        );
        if (isActionOrConfirm) {
          patch.last_shown_options = [];
          patch.last_shown_options_at = null;
          patch.last_shown_category = null;
        }
      } else if (p.kind === "list") {
        patch.pending_clarification = {
          kind: "item_disambiguation",
          options: p.payload.rows.map((r) => ({ id: r.id, label: r.title })),
        };
      }
      if (carriedPending) patch.pending_clarification = { ...patch.pending_clarification!, remaining_items: carriedPending.remaining_items };
    }
  };

  const presentPending = async (pending: NonNullable<ConversationStateRow["pending_clarification"]>) => {
    if (!pending.remaining_items?.length) return;
    const mention = pending.remaining_items[0];
    const resolved = await resolveItemDetailed(branchId, mention.query, mention.size, ctx.menu);
    const choices = resolved.kind === "variants" ? resolved.variants : resolved.kind === "ambiguous" ? resolved.matches
      : resolved.kind === "exact" ? [resolved.item] : resolved.suggestions;
    patch.last_shown_options = choices;
    patch.last_shown_options_at = new Date().toISOString();
    replies.push(choices.length ? reply.itemVariants(lang, mention.query, choices, cur)
      : reply.notFound(lang, mention.query, [], [...new Set(ctx.menu.map((item) => item.category).filter(Boolean))] as string[]));
    if (choices.length) setInteractive(itemPickList(lang, choices, cur));
    patch.pending_clarification = { ...pending, options: choices.length ? patch.pending_clarification?.options ?? pending.options : [] };
    hasDisambiguation = true;
  };

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

  const deliveryAddressPrompt = (address?: string | null): string => {
    if (ctx.settings.delivery_pricing_mode !== "area") return reply.deliveryAreaNotCovered(lang, deliveryAreaNames(ctx.settings));
    const areas = deliveryAreaNames(ctx.settings).join(", ");
    const status = resolveDeliveryQuote(address, ctx.settings).status;
    if (status === "unserved" && outsideAreaDeliveryRate(ctx.settings)) {
      return `📍 ${outsideAreaDeliveryInfo(ctx.settings, cur, lang)}`;
    }
    const explanation = status === "unserved"
      ? (lang === "roman_urdu" ? "Is area mein delivery available nahi hai. " : lang === "pashto" ? "Da area ke delivery nishta. " : "That area is not served. ")
      : status === "ambiguous"
      ? (lang === "roman_urdu" ? "Is address se aik se zyada areas match ho rahe hain. " : lang === "pashto" ? "Da address sara yaw na zyat areas match keegi. " : "That address matches more than one delivery area. ")
      : "";
    return explanation + (lang === "roman_urdu"
      ? `📍 Delivery charges confirm karne ke liye apna exact area aur mukammal address bhejein. Supported areas: ${areas}. Ya Pickup choose karein.`
      : lang === "pashto"
      ? `📍 Da delivery fee dapara khpal exact area aw mukammal address rawalega. Areas: ${areas}. Ya Pickup select kra.`
      : `📍 Please confirm your exact area and full address so we can determine the delivery fee. Supported areas: ${areas}. You can also choose Pickup.`);
  };

  const requestOutsideAreaQuote = (address: string | null | undefined): boolean => {
    if (!address || !ctx.settings.delivery_enabled || !outsideAreaDeliveryRate(ctx.settings)
      || resolveDeliveryQuote(address, ctx.settings).status !== "unserved"
      || !(sharedLocationPin(address) || isValidDeliveryAddress(address) && isCompleteDeliveryAddress(address))) return false;
    patch.address = address;
    patch.order_type = "delivery";
    patch.summary_sent_at = null;
    patch.delivery_fee_quote = null;
    patch.stage = "human";
    patch.is_bot_active = false;
    patch.escalation_reason = "outside_area_delivery_quote";
    patch.escalated_at = new Date().toISOString();
    outsideAreaQuoteRequested = true;
    interactive = null;
    replies.push(outsideAreaDeliveryInfo(ctx.settings, cur, lang), lang === "roman_urdu"
      ? "Aap ka address aur order request team ko de diya hai. Final delivery fee abhi confirm honi hai; order abhi place nahi hua."
      : lang === "pashto"
      ? "Staso address aw order request team ta warkar sho. Final delivery fee la na da confirm; order la na day place shway."
      : "I've passed your destination and order request to our team. The final delivery fee is pending confirmation; your order has not been placed yet.");
    return true;
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
      if (deliveryAreaNames(s).length) parts.push(`📍 Ilaqay: ${deliveryAreaNames(s).join(", ")}`);
      parts.push(`💰 ${deliveryFeeInfo(s, cur, value("address"))}`);
      if (s.min_delivery_amount) parts.push(`🛒 Kam az kam order: ${cur} ${s.min_delivery_amount}`);
      if (s.estimated_delivery_minutes) parts.push(`⏱ Delivery Wakht: ~${s.estimated_delivery_minutes} min`);
    } else if (lang === "roman_urdu") {
      parts.push("✅ Delivery available hai");
      parts.push(`🕐 Delivery Timings: ${s.opening_time} – ${s.closing_time}`);
      if (deliveryAreaNames(s).length) parts.push(`📍 Areas: ${deliveryAreaNames(s).join(", ")}`);
      parts.push(`💰 ${deliveryFeeInfo(s, cur, value("address"))}`);
      if (s.min_delivery_amount) parts.push(`🛒 Min order: ${cur} ${s.min_delivery_amount}`);
      if (s.estimated_delivery_minutes) parts.push(`⏱ Delivery Time: ~${s.estimated_delivery_minutes} min`);
    } else {
      parts.push("✅ Delivery is available");
      parts.push(`🕐 Delivery Hours: ${s.opening_time} – ${s.closing_time}`);
      if (deliveryAreaNames(s).length) parts.push(`📍 Areas: ${deliveryAreaNames(s).join(", ")}`);
      parts.push(`💰 ${deliveryFeeInfo(s, cur, value("address"))}`);
      if (s.min_delivery_amount) parts.push(`🛒 Min order: ${cur} ${s.min_delivery_amount}`);
      if (s.estimated_delivery_minutes) parts.push(`⏱ ETA: ~${s.estimated_delivery_minutes} min`);
    }
    return parts.join("\n");
  };

  let answerDeadline: number | null = null;
  const grounded = async (question: string): Promise<string | null> => {
    answerDeadline ??= Date.now() + (Number(process.env.ORDER_AGENT_ANSWER_TIMEOUT_MS) || 6000);
    const remaining = answerDeadline - Date.now();
    if (remaining <= 0) return null;
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
      timeoutMs: remaining,
    });
  };

  const answerCatalogQuestion = (q: string): boolean => {
    const direct = catalogQuestionMatches(q, ctx.menu);
    if (!direct.length) return false;
    replies.push(reply.itemList(lang, direct, cur));
    if (/include|contain|content|ingredient|what.*in|kya.*(?:hai|milta)|mein.*kya/i.test(q)) {
      for (const item of direct.slice(0, 10).filter((item) => !item.description)) replies.push(
        `${item.name}: ${lang === "roman_urdu" ? "Ingredients ki tafseel listed nahi hai; staff se verify karwa sakte hain." : "Ingredient details are not listed; staff can verify them."}`);
    }
    if (!hasDisambiguation && !value("pending_clarification")?.remaining_items?.length) {
      const available = direct.filter((item) => item.is_available);
      patch.last_shown_options = available.slice(0, 10);
      patch.last_shown_options_at = new Date().toISOString();
      setInteractive(itemPickList(lang, available, cur));
    }
    return true;
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

  // Pictures are customer-facing assets, never an authoritative priced catalog.
  if (!ctx.menu.length && transition.actions.some((a) =>
    ["add_items", "answer_info", "answer_grounded", "place_order", "show_summary"].includes(a.kind))) {
    return { replyText: reply.catalogNotReady(lang), statePatch: { ...patch,
      stage: "human", is_bot_active: false, summary_sent_at: null,
      escalation_reason: "menu_catalog_missing", escalated_at: new Date().toISOString(),
      last_error: "No verified menu catalog for this branch" },
      placeOrder: false, escalate: true, usedSemanticSearch: false };
  }

  // Menu data has no priced addon catalog or allergen guarantees. Staff must verify these.
  if (u.items.some((item) => item.addons.length > 0)
    || /\ballerg(?:y|ic|ies|en|ens)\b|الرجی/i.test(input.messageTextForFallback ?? "")) {
    return { replyText: reply.escalated(lang), statePatch: { ...patch, stage: "human", is_bot_active: false,
      escalation_reason: "preparation_verification", escalated_at: new Date().toISOString() },
      placeOrder: false, escalate: true, usedSemanticSearch: false };
  }

  // Closed-guard: only block ordering actions
  if (!ctx.isOpenNow) {
    const blockedActions = new Set(["place_order", "ask_order_type", "collect_delivery_address"]);
    if (transition.actions.some((a) => blockedActions.has(a.kind))) {
      replies.push(reply.closed(lang, ctx.settings.opening_time));
    }
  }

  if (u.guests) patch.guests = u.guests;
  if (u.reservation_time) patch.reservation_time = parseCustomerTimeToIso(u.reservation_time, ctx.settings.timezone);
  if (u.pickup_time) patch.pickup_time = parseCustomerTimeToIso(u.pickup_time, ctx.settings.timezone);
  if (u.order_type) patch.order_type = u.order_type;

  // Placed orders require staff coordination: a fulfillment switch may change fees,
  // dispatch and kitchen work. Never silently rewrite an already accepted order.
  if (ctx.state.stage === "placed" && cart.length === 0 && transition.actions.some((a) =>
    ["collect_delivery_address", "collect_dinein_details", "collect_pickup_time"].includes(a.kind))) {
    return { replyText: reply.escalated(lang), statePatch: { stage: "human", is_bot_active: false,
      escalation_reason: "post_order_change", escalated_at: new Date().toISOString(), preferred_language: lang },
      placeOrder: false, escalate: true, usedSemanticSearch: false };
  }
  if (!carriedPending && transition.actions.some((a) => ["add_items", "remove_items", "update_quantity"].includes(a.kind))) patch.pending_clarification = null;

  const orderSummary = () => reply.summary(lang, cart, value("order_type"), cur, value("address"), ctx.settings, {
    guests: value("guests"), reservation_time: value("reservation_time"), pickup_time: value("pickup_time"),
    customer_instructions: value("customer_instructions"),
  });
  let repriced = false;
  const checkoutReady = (): boolean => {
    if (hasDisambiguation) return false;
    if (value("pending_clarification")?.remaining_items?.length) {
      patch.stage = "building_cart";
      return false;
    }
    if (!cart.length) {
      patch.stage = "browsing";
      replies.push(reply.emptyCart(lang));
      return false;
    }
    for (const item of cart) {
      const current = ctx.menu.find((m) => m.id === item.menu_item_id);
      if (!current || current.is_available === false) {
        patch.stage = "building_cart";
        patch.summary_sent_at = null;
        replies.push(reply.itemUnavailable(lang, item.name));
        setInteractive(cartActionButtons(lang));
        return false;
      }
      if (item.unit_price !== current.price) {
        item.unit_price = current.price;
        repriced = true;
        patch.summary_sent_at = null;
      }
    }
    const type = value("order_type");
    if (!type || type === "delivery" && ctx.settings.delivery_enabled === false) {
      patch.order_type = null;
      patch.stage = "choosing_order_type";
      replies.push(type ? reply.deliveryDisabled(lang) : reply.askOrderType(lang));
      setInteractive(orderTypeButtons(lang, ctx.settings));
      return false;
    }
    if (type === "delivery") {
      const address = value("address");
      if (requestOutsideAreaQuote(address)) return false;
      if (!isValidDeliveryAddress(address) || !isCompleteDeliveryAddress(address) || hasDeliveryRestrictions(ctx.settings) && !findMatchingDeliveryArea(address!, ctx.settings)) {
        patch.stage = "collecting_delivery";
        patch.address = null;
        patch.summary_sent_at = null;
        const prompt = isCompleteDeliveryAddress(address) ? deliveryAddressPrompt(address) : reply.askAddress(lang);
        if (!replies.includes(prompt)) replies.push(prompt);
        return false;
      }
      if (cartSubtotal(cart) < ctx.settings.min_delivery_amount) {
        patch.stage = "building_cart";
        patch.summary_sent_at = null;
        replies.push(reply.minDeliveryNotMet(lang, cartSubtotal(cart), ctx.settings.min_delivery_amount, cur));
        setInteractive(cartActionButtons(lang));
        return false;
      }
    }
    if (type === "pickup" && !parseCustomerTimeToIso(value("pickup_time"), ctx.settings.timezone)) {
      patch.pickup_time = null;
      patch.stage = "collecting_pickup";
      if (!replies.includes(reply.askPickupTime(lang))) replies.push(reply.askPickupTime(lang));
      return false;
    }
    if (type === "dine-in" && (!value("guests") || !parseCustomerTimeToIso(value("reservation_time"), ctx.settings.timezone))) {
      patch.stage = "collecting_dinein";
      if (!replies.includes(reply.askDineIn(lang))) replies.push(reply.askDineIn(lang));
      return false;
    }
    const scheduled = type === "pickup" ? value("pickup_time") : type === "dine-in" ? value("reservation_time") : null;
    if (scheduled && !isWithinOperatingHours(ctx.settings.opening_time, ctx.settings.closing_time, ctx.settings.timezone, new Date(scheduled))) {
      patch.summary_sent_at = null;
      patch.stage = type === "pickup" ? "collecting_pickup" : "collecting_dinein";
      if (type === "pickup") patch.pickup_time = null;
      else patch.reservation_time = null;
      replies.push(hoursAnswer(), type === "pickup" ? reply.askPickupTime(lang) : reply.askDineIn(lang));
      return false;
    }
    return true;
  };

  // ── Action dispatch ───────────────────────────────────────────────────────
  for (const action of transition.actions) {
    switch (action.kind) {

      // ── Greet ────────────────────────────────────────────────────────────
      case "greet": {
        const wasSalam = /^(?:aoa\b|a\.?o\.?a\b|ass?alam|aslam|salam\b|سلام|ستړې|ستړی)/i.test(input.messageTextForFallback?.trim() ?? "");
        replies.push(reply.greeting(lang, input.appName, input.customerName ?? null, wasSalam));
        const willAddItems = transition.actions.some((a) => a.kind === "add_items");
        if (!willAddItems) {
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

        // Resolve independent portions together. An unresolved first dish must
        // not hide valid later dishes. Only unresolved portions enter the queue.
        const resolutions = await Promise.all(mentions.map((m) => resolveItemDetailed(branchId,
          isDelta && m.query === "__last_item__" && cart.length ? cart[cart.length - 1].name : m.query,
          m.size, ctx.menu, ctx.state.last_shown_category ?? null)));
        const unresolved: TurnUnderstanding["items"] = [];
        let presentedChoice = false;

        for (const [mentionIndex, m] of mentions.entries()) {
          let query = m.query || "";
          if (isDelta && query === "__last_item__" && cart.length > 0) {
            query = cart[cart.length - 1].name;
          }
          if (!query.trim()) continue;

          // Null quantity means an instruction edit, never an implicit extra portion.
          if (m.qty === null && m.notes) {
            const matches = findCartMatches(cart, query);
            if (matches.length === 1) {
              matches[0].notes = m.notes;
              replies.push(reply.itemInstructionUpdated(lang, matches[0].name, m.notes));
            } else {
              hasDisambiguation = true;
              replies.push(reply.clarify(lang, "which_option"));
            }
            continue;
          }

          const res = resolutions[mentionIndex];
          if (res.kind !== "exact") {
            // Missing dishes are declined in this reply, never queued as a
            // perpetual choice that replays during delivery/address replies.
            if (res.kind === "variants" || res.kind === "ambiguous") unresolved.push(m);
            if (presentedChoice) continue;
            presentedChoice = true;
            patch.last_shown_options = [];
            patch.last_shown_options_at = null;
            patch.pending_clarification = null;
          }
          if (res.kind === "exact") {
            const resolved = res.item;
            if (carriedPending?.options.some((o) => o.id === `item:${resolved.id}`)) {
              carriedPending = null;
              patch.pending_clarification = null;
            }
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
              replies.push(reply.notFound(lang, query, [], cats));
              if (cats.length > 0 && cart.length === 0 && input.menuDisplayMode !== "menu_pictures") {
                setInteractive(categoryList(lang, cats, lang === "pashto" ? "Menu katal ghwaray?" : lang === "roman_urdu" ? "Menu dekhna chahenge?" : "What would you like?"));
              }
            }
          }
          if (res.kind !== "exact") {
            hasDisambiguation = true;
          }
        }

        if (unresolved.length) {
          const pendingItems = [...unresolved, ...(carriedPending?.remaining_items ?? [])];
          patch.pending_clarification = { kind: "item_disambiguation",
            options: patch.pending_clarification?.options ?? [],
            remaining_items: pendingItems.filter((item, index) => pendingItems.findIndex((other) =>
              other.query.toLowerCase() === item.query.toLowerCase() && other.size === item.size
              && other.qty === item.qty && other.notes === item.notes) === index) };
          carriedPending = null;
        }

        addedInTurn.push(...added);
        if (added.length && !hasDisambiguation) {
          patch.last_shown_options = [];
          patch.last_shown_options_at = null;
          patch.last_shown_category = null;

          const willShowSummary = transition.actions.some((a) => a.kind === "show_summary");
          if (!willShowSummary) {
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
          const pending = carriedPending?.remaining_items ?? [];
          const remaining = pending.filter((item) => !menuNameCoversQuery(r.query, item.query));
          const removedPending = remaining.length < pending.length;
          if (removedPending) {
            carriedPending = remaining.length ? { ...carriedPending!, remaining_items: remaining } : null;
            patch.pending_clarification = carriedPending;
            patch.last_shown_options = [];
            patch.last_shown_options_at = null;
          }
          const matches = findCartMatches(cart, r.query);
          if (!matches.length && removedPending) continue;
          if (!matches.length || matches.length > 1 && r.qty !== "all") {
            replies.push(reply.clarify(lang, "which_option"));
            hasDisambiguation = true;
            continue;
          }
          // 'all naan' may remove all preparations; a partial removal must identify one.
          for (const match of matches) cart = removeFromCart(cart, { menu_item_id: match.menu_item_id, qty: r.qty });
        }
        if (!transition.actions.some((a) => a.kind === "add_items")) {
          replies.push(reply.itemsRemoved(lang, cart, cur));
          if (cart.length > 0 && !hasDisambiguation) setInteractive(cartActionButtons(lang));
        }
        break;
      }

      case "update_quantity": {
        const items = (action.payload?.items as TurnUnderstanding["items"]) ?? u.items;
        for (const m of items) {
          const matches = findCartMatches(cart, m.query || "__last_item__");
          if (matches.length !== 1) {
            hasDisambiguation = true;
            replies.push(reply.clarify(lang, "which_option"));
            continue;
          }
          const target = matches[0];
          if (m.size) {
            const resolved = await resolveItemDetailed(branchId, extractBaseItemName(target.name).baseName, m.size, ctx.menu);
            if (resolved.kind !== "exact" || resolved.item.is_available === false) {
              hasDisambiguation = true;
              replies.push(reply.clarify(lang, "which_option"));
              continue;
            }
            target.menu_item_id = resolved.item.id;
            target.name = resolved.item.name;
            target.unit_price = resolved.item.price;
            target.size = m.size;
          }
          if (m.qty !== null) target.qty = m.qty;
          if (m.notes) target.notes = m.notes;
        }
        replies.push(reply.cartUpdated(lang, cart, cur));
        if (cart.length > 0 && !hasDisambiguation) setInteractive(cartActionButtons(lang));
        break;
      }

      case "offer_upsell": {
        patch.upsell_offered = true;
        break;
      }

      // ── Information ───────────────────────────────────────────────────────
      case "answer_hours_location": {
        const query = String(action.payload?.query ?? u.info_query ?? input.messageTextForFallback ?? "");
        const wantsContact = /phone|contact|number|rabta|رابطہ|نمبر/i.test(query);
        if (!wantsContact || /hours|tim|open|clos|location|address|kahan|waqt|khul|band/i.test(query)) replies.push(hoursAnswer());
        if (wantsContact) {
          const phones = [...new Set([ctx.settings.phone_delivery, ctx.settings.phone_dine_in].filter(Boolean))];
          replies.push(phones.length ? `☎ ${phones.join(" / ")}` : (lang === "roman_urdu" ? "Contact number abhi listed nahi hai." : "A contact number has not been listed yet."));
        }
        break;
      }

      case "answer_payment":
        replies.push(paymentAnswer());
        break;

      case "answer_delivery_info": {
        const queryStr = String(action.payload?.query ?? u.info_query ?? input.messageTextForFallback ?? "").toLowerCase();
        const topics = deliveryQuestionTopics(queryStr);
        // Follow-ups refer to the accepted order even when new delivery is
        // disabled. Read its actual status before quoting any arrival estimate.
        let answeredOrderTime = false;
        if (topics.time && (ctx.state.stage === "placed" || ctx.state.stage === "post_order" || /\b(?:my|mera|mere)\s+order\b/.test(queryStr))) {
          const recent = await orderRepo.getLatestForConversation(input.conversationId);
          if (recent) {
            replies.push(reply.orderTiming(lang, recent, ctx.settings));
            answeredOrderTime = true;
            if (!topics.fee) break;
          }
        }
        if (!ctx.settings.delivery_enabled) { replies.push(deliveryInfoAnswer()); break; }
        let answered = answeredOrderTime;
        if (topics.time && !answeredOrderTime) {
          answered = true;
          const estDelivery = Math.round(Number(ctx.settings?.estimated_delivery_minutes) || 45);
          replies.push(
            lang === "pashto"
              ? `⏱ Delivery ke takreeban ~${estDelivery} minute lagygi.`
              : lang === "roman_urdu"
              ? `⏱ Delivery mein takreeban ~${estDelivery} minutes lagte hain.`
              : `⏱ Estimated delivery time is ~${estDelivery} mins.`
          );
        }
        if (topics.fee) {
          answered = true;
          replies.push(`💰 ${deliveryFeeInfo(ctx.settings, cur, u.address ?? value("address") ?? queryStr)}`);
        }
        if (!answered) {
          replies.push(deliveryInfoAnswer());
        }
        break;
      }

      case "answer_grounded": {
        const question = (action.payload?.query as string) ?? u.info_query ?? input.messageTextForFallback ?? "";
        if (question) {
          if (answerCatalogQuestion(question)) break;
          const ans = await grounded(question);
          if (ans) replies.push(ans);
          else { patch.last_error = "Information answer could not be verified"; replies.push(reply.answerUnavailable(lang)); }
        }
        break;
      }

      case "answer_info": {
        const q = String(action.payload?.query ?? u.info_query ?? input.messageTextForFallback ?? "").trim();
        if (answerCatalogQuestion(q)) break;
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

            if (item.is_available !== false && (lowerAns.includes(lowerFull) || (lowerBase.length >= 4 && lowerAns.includes(lowerBase)))) {
              if (!mentionedMap.has(item.id)) {
                mentionedMap.set(item.id, { id: item.id, name: item.name, price: item.price, category: item.category });
              }
            }
          }

          const matchedItems = Array.from(mentionedMap.values());
          if (matchedItems.length > 0 && !hasDisambiguation && !value("pending_clarification")?.remaining_items?.length) {
            patch.last_shown_options = matchedItems.slice(0, 10);
            patch.last_shown_options_at = new Date().toISOString();

            // Every tap shows a concrete named variant and price; never pick an
            // arbitrary first size behind a generic dish button.
            setInteractive(itemPickList(lang, matchedItems.slice(0, 10), cur));
          }
        } else {
          if (answerDeadline !== null && Date.now() >= answerDeadline) {
            patch.last_error = "Information answer could not be verified";
            replies.push(reply.answerUnavailable(lang));
            break;
          }
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
        // Store supplied destinations while food choices are pending; defer
        // only the next-slot prompt, never silently discard an explicit slot.
        if (hasDisambiguation && !action.payload?.address && !u.notes?.startsWith("use_saved_address:") && !u.intents.includes("use_saved_address")) break;
        // Clear stale/invalid addresses that leaked from button payloads or previous bugs
        const currentAddr = value("address");
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
        if (savedAddrNote || u.intents.includes("use_saved_address")) {
          const savedRow = !savedAddrNote || ctx.savedAddress?.id === savedAddrNote[1] ? ctx.savedAddress : null;
          if (savedRow?.address) {
            if (!isValidDeliveryAddress(savedRow.address) || !isCompleteDeliveryAddress(savedRow.address)) {
              replies.push(reply.askAddress(lang));
              patch.stage = "collecting_delivery";
              patch.address = null;
            } else if (hasDeliveryRestrictions(ctx.settings) && !findMatchingDeliveryArea(savedRow.address, ctx.settings)) {
              if (requestOutsideAreaQuote(savedRow.address)) break;
              replies.push(deliveryAddressPrompt(savedRow.address));
              patch.stage = "collecting_delivery";
              patch.address = null;
            } else {
              patch.address = savedRow.address;
              patch.order_type = patch.order_type ?? "delivery";
              replies.push(reply.savedAddressConfirmed(lang, savedRow.address));

            }
          } else {
            replies.push(reply.askAddress(lang));
            patch.stage = "collecting_delivery";
            patch.address = null;
          }
        } else if (address) {
          if (sharedLocationPin(address) && requestOutsideAreaQuote(address)) break;
          if (!isValidDeliveryAddress(address)) {
            patch.address = null;
            patch.stage = "collecting_delivery";
            replies.push(reply.askAddress(lang));
            break;
          }
          if (hasDeliveryRestrictions(ctx.settings) && !findMatchingDeliveryArea(address, ctx.settings)) {
            if (requestOutsideAreaQuote(address)) break;
            replies.push(deliveryAddressPrompt(address));
            patch.stage = "collecting_delivery";
            patch.address = null;
          } else {
            if (!isCompleteDeliveryAddress(address)) {
              patch.address = null;
              patch.stage = "collecting_delivery";
              replies.push(reply.askAddress(lang));
              break;
            }
            patch.address = address;
            patch.order_type = patch.order_type ?? "delivery";

          }
        } else {
          const isNewAddressRequest = Boolean(
            action.payload?.isNewAddressRequest ||
            u.notes === "prompt_new_address" ||
            u.notes === "fast_path_new_address_request"
          );
          const saved = !isNewAddressRequest && ctx.savedAddress && isValidDeliveryAddress(ctx.savedAddress.address) && isCompleteDeliveryAddress(ctx.savedAddress.address)
            && (!hasDeliveryRestrictions(ctx.settings) || findMatchingDeliveryArea(ctx.savedAddress.address, ctx.settings)) ? ctx.savedAddress : null;
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
            replies.push(reply.askAddress(lang));
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

        const currentGuests = value("guests");
        const currentRtime = value("reservation_time");
        if (!currentGuests || !currentRtime) patch.stage = "collecting_dinein";

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
          if (!patch.pickup_time) {
            patch.stage = "collecting_pickup";
            replies.push(reply.askPickupTime(lang));
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
        const addr = value("address");
        if (cart.length === 0) {
          replies.push(reply.emptyCart(lang));
        } else {
          replies.push(reply.summary(lang, cart, value("order_type"), cur, addr ?? null, ctx.settings));
          setInteractive(cartActionButtons(lang, { hideViewCart: true }));
        }
        break;
      }

      case "show_summary": {
        if (!checkoutReady()) break;
        patch.stage = "confirming";
        patch.summary_sent_at = new Date().toISOString();
        patch.delivery_fee_quote = value("order_type") === "delivery" ? resolveDeliveryQuote(value("address"), ctx.settings).fee : 0;
        replies.push(orderSummary());
        setInteractive(confirmButtons(lang));
        break;
      }

      // ── Place order ──────────────────────────────────────────────────────
      case "place_order": {
        if (!checkoutReady()) break;
        const feeNeedsReview = value("order_type") === "delivery"
          && (ctx.settings.delivery_pricing_mode === "area" || value("delivery_fee_quote") != null)
          && value("delivery_fee_quote") !== resolveDeliveryQuote(value("address"), ctx.settings).fee;
        if (!value("summary_sent_at") || repriced || orderChanged || feeNeedsReview) {
          patch.stage = "confirming";
          patch.summary_sent_at = new Date().toISOString();
          patch.delivery_fee_quote = value("order_type") === "delivery" ? resolveDeliveryQuote(value("address"), ctx.settings).fee : 0;
          replies.push(orderSummary());
          setInteractive(confirmButtons(lang));
          break;
        }

        if (!ctx.isOpenNow) {
          replies.push(reply.closed(lang, ctx.settings.opening_time));
          patch.stage = "confirming";
          break;
        }
        if (cart.length === 0) { replies.push(reply.emptyCart(lang)); break; }
        const orderType = (value("order_type")) as OrderType | null;
        if (!orderType) {
          replies.push(reply.askOrderType(lang));
          patch.stage = "choosing_order_type";
          setInteractive(orderTypeButtons(lang, ctx.settings));
          break;
        }
        const deliveryAddr = value("address");
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
          if (hasDeliveryRestrictions(ctx.settings) && !findMatchingDeliveryArea(deliveryAddr, ctx.settings)) {
            replies.push(deliveryAddressPrompt(deliveryAddr));
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
              ? resolveDeliveryQuote(deliveryAddr, ctx.settings).fee ?? 0
              : 0;

          const pTime = value("pickup_time");
          const finalPickupTime = pTime ? parseCustomerTimeToIso(pTime, ctx.settings.timezone) : null;
          const rTime = value("reservation_time");
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
            customerInstructions: value("customer_instructions"),
            address: deliveryAddr,
            guests: value("guests"),
            reservationTime: finalReservationTime,
            pickupTime: finalPickupTime,
            deliveryFee,
          });
          // Placement already committed. A receipt lookup failure must never report
          // that the order failed and invite the customer to submit it again.
          const placed = await orderRepo.getById(orderId).catch(() => null);
          replies.push(
            reply.orderPlaced(
              lang,
              placed?.order_number ?? orderId,
              cur,
              placed?.total ?? (cartSubtotal(cart) + deliveryFee),
              orderType,
              ctx.settings,
            ),
          );
          placeOrder = true;
          patch.stage = "placed";
          patch.summary_sent_at = null;
          patch.pending_clarification = null;
          patch.last_shown_options = [];
          patch.last_shown_options_at = null;
          interactive = null;
          cart = [];
        } catch (err) {
          const msg =
            (err && typeof err === "object" && "message" in err ? String(err.message) : String(err)) ||
            "order failed";
          console.error("[executor] place_order failed:", msg);
          if (/menu price|menu item no longer|reviewed order changed/i.test(msg)) {
            invalidateMenuCache(branchId);
            const latest = await getMenuCatalog(branchId);
            cart = cart.map((item) => {
              const current = latest.find((m) => m.id === item.menu_item_id);
              return current ? { ...item, unit_price: current.price } : item;
            });
            patch.stage = "building_cart";
            patch.summary_sent_at = null;
            replies.push(lang === "roman_urdu" ? "Menu ki qeemat ya availability badal gayi hai. Updated cart check karke checkout karein."
              : lang === "pashto" ? "Da menu qeemat ya availability badal shaway. Cart bia ogoray ao checkout wokray."
              : "Menu prices or availability changed. Please review the updated cart and checkout again.");
            replies.push(reply.cartUpdated(lang, cart, cur));
            setInteractive(cartActionButtons(lang));
          } else if (/closed|not accepting orders/i.test(msg)) {
            patch.stage = "building_cart";
            patch.summary_sent_at = null;
            replies.push(reply.closed(lang, ctx.settings.opening_time));
            setInteractive(cartActionButtons(lang));
          } else if (/min.*delivery|minimum.*delivery/i.test(msg)) {
            const sub = cartSubtotal(cart);
            replies.push(reply.minDeliveryNotMet(lang, sub, ctx.settings.min_delivery_amount, cur));
            patch.stage = "confirming";
            replies.push(reply.summary(lang, cart, orderType, cur, deliveryAddr ?? null, ctx.settings));
            setInteractive(cartActionButtons(lang));
          } else if (/delivery fee changed/i.test(msg)) {
            await invalidateSettingsContext(branchId);
            patch.summary_sent_at = null;
            patch.stage = "confirming";
            replies.push("Delivery charges changed. Please review your order again before confirming.");
            setInteractive(cartActionButtons(lang));
          } else if (/delivery.*area|outside.*area|area.*outside/i.test(msg)) {
            replies.push(deliveryAddressPrompt(deliveryAddr));
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

      case "reorder_previous": {
        const recent = await orderRepo.getLatestForConversation(input.conversationId);
        const previous = recent ? await orderRepo.getWithItems(recent.id) : null;
        if (!previous?.items.length) {
          replies.push(reply.noRecentOrder(lang));
          patch.stage = "browsing";
          break;
        }
        cart = [];
        for (const old of previous.items) {
          const item = ctx.menu.find((m) => m.name.toLowerCase() === old.name.toLowerCase());
          if (!item || item.is_available === false) {
            replies.push(reply.itemUnavailable(lang, old.name));
            continue;
          }
          cart = addToCart(cart, { menu_item_id: item.id, name: item.name, unit_price: item.price,
            qty: old.qty, size: old.size, addons: old.addons ?? [], notes: old.item_instructions });
        }
        // Reuse the food choices at today's prices. Re-collect fulfillment and confirmation.
        patch.order_type = null;
        patch.address = null;
        patch.guests = null;
        patch.pickup_time = null;
        patch.reservation_time = null;
        patch.summary_sent_at = null;
        patch.pending_clarification = null;
        patch.stage = cart.length ? "building_cart" : "browsing";
        if (cart.length) {
          replies.push(reply.cartUpdated(lang, cart, cur));
          setInteractive(cartActionButtons(lang));
        }
        break;
      }

      // ── Cancel / restart ─────────────────────────────────────────────────
      case "cancel_order": {
        const recent = cart.length === 0 ? await orderRepo.getLatestForConversation(input.conversationId) : null;
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
          } else if (recent.status === "received" && withinWindow && await orderRepo.cancelOrder(recent.id)) {
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
        patch.stage = "browsing";
        patch.order_type = null;
        patch.address = null;
        patch.guests = null;
        patch.reservation_time = null;
        patch.pickup_time = null;
        patch.customer_instructions = null;
        patch.pending_clarification = null;
        patch.last_shown_options = [];
        patch.last_shown_options_at = null;
        patch.last_shown_category = null;
        patch.upsell_item_name = null;
        patch.upsell_item_price = null;
        patch.upsell_offered = false;
        patch.declined_upsells = [];
        patch.summary_sent_at = null;
        break;
      }

      case "restart_order":
        patch.customer_instructions = null;
        patch.pending_clarification = null;
        patch.last_shown_options = [];
        patch.last_shown_options_at = null;
        patch.last_shown_category = null;
        patch.summary_sent_at = null;
        patch.upsell_item_name = null;
        patch.upsell_item_price = null;
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
          if (recent) {
            const question = String(action.payload?.query ?? u.info_query ?? input.messageTextForFallback ?? "");
            replies.push(deliveryQuestionTopics(question).time ? reply.orderTiming(lang, recent, ctx.settings)
              : reply.orderStatus(lang, recent.order_number, recent.status, ctx.settings?.estimated_delivery_minutes));
          }
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
        if (u.notes === "fast_path_resume") {
          const pending = ctx.state.pending_clarification;
          if (pending?.remaining_items?.length) {
            await presentPending(pending);
          } else if (cart.length && checkoutReady()) {
            patch.stage = "confirming";
            patch.summary_sent_at = new Date().toISOString();
            patch.delivery_fee_quote = value("order_type") === "delivery" ? resolveDeliveryQuote(value("address"), ctx.settings).fee : 0;
            replies.push(orderSummary());
            setInteractive(confirmButtons(lang));
          }
        }
        if (replies.length === 0 && patch.customer_instructions) {
          replies.push(reply.itemInstructionUpdated(lang, lang === "english" ? "Order" : "Order", patch.customer_instructions));
          if (cart.length) setInteractive(cartActionButtons(lang));
        }
        if (replies.length === 0) {
          // Help with the missing step instead of sending a generic fallback
          // while the customer is already answering a delivery/pickup question.
          if (ctx.state.stage === "collecting_delivery") {
            replies.push(reply.askAddress(lang));
          } else if (ctx.state.stage === "collecting_pickup") {
            replies.push(reply.askPickupTime(lang));
          } else if (ctx.state.stage === "collecting_dinein") {
            replies.push(reply.askDineIn(lang));
          } else if (ctx.state.stage === "choosing_order_type") {
            replies.push(reply.askOrderType(lang));
            setInteractive(orderTypeButtons(lang, ctx.settings));
          } else if (cart.length > 0) {
            replies.push(reply.clarify(lang, "fallback"));
            setInteractive(cartActionButtons(lang, { hideViewCart: true }));
          } else {
            replies.push(reply.clarify(lang, "fallback"));
            const cats = [...new Set(ctx.menu.map((m) => m.category).filter(Boolean))] as string[];
            if (cats.length) setInteractive(categoryList(lang, cats));
          }
        }
        break;
    }
    if (outsideAreaQuoteRequested) break;
  }

  // An unrelated addition, address reply or menu question must not discard an
  // earlier requested portion that is still waiting for a size/flavor choice.
  if (!outsideAreaQuoteRequested && carriedPending && !hasDisambiguation && !transition.actions.some((a) => ["cancel_order", "restart_order", "reorder_previous"].includes(a.kind))
    && (u.notes === "fast_path_resume" || transition.actions.some((a) => ["add_items", "remove_items", "show_menu", "show_summary", "place_order"].includes(a.kind)))) {
    await presentPending(carriedPending);
  }

  if (!cart.length && patch.stage !== "placed" && patch.stage !== "human" && !u.order_type && !u.address && !u.guests && !u.pickup_time && !u.reservation_time) patch.stage = "browsing";
  patch.cart = cart;

  // Filter replies: If size disambiguation is active (variantButtons), do not ask for delivery address or pickup time in the same message
  let finalReplies = replies.filter(Boolean);
  if (hasDisambiguation && !outsideAreaQuoteRequested) {
    finalReplies = finalReplies.filter((r) => {
      if (r.includes(reply.askAddress(lang)) || r.includes("Pichli dafa") || r.includes("Last time you used")) return false;
      if (r.includes("Pickup kis waqt") || r.includes("What time will you pick up")) return false;
      if (r.includes("Kitne log") || r.includes("How many guests")) return false;
      return true;
    });
    // Override stage to building_cart so next turn's fast-paths (numeric selection, name matching) work
    patch.stage = "building_cart";
  }

  // A scheduled review can fail validation. Acknowledge actual additions even
  // when checkout is blocked, and acknowledge resolved portions before choices.
  if (addedInTurn.length && !placeOrder && !patch.summary_sent_at) {
    const acknowledgement = reply.itemsAdded(lang, addedInTurn, cart, cur);
    finalReplies.unshift(ctx.settings.delivery_pricing_mode === "area" && value("order_type") === "delivery"
      ? acknowledgement.replace(/\bTotal:/g, "Subtotal:") : acknowledgement);
  }

  if (patch.summary_sent_at === null) patch.delivery_fee_quote = null;

  // De-duplicate identical consecutive lines
  finalReplies = finalReplies.filter((line, idx, arr) => idx === 0 || line !== arr[idx - 1]);

  return {
    replyText: finalReplies.map((r) => r.trim()).filter(Boolean).join("\n\n") || reply.clarify(lang, "fallback"),
    statePatch: patch,
    placeOrder,
    escalate: outsideAreaQuoteRequested,
    usedSemanticSearch: usedSemantic,
    interactive,
    mediaUrls,
  };
}
