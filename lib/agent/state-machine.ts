/**
 * lib/agent/state-machine.ts — Phase 5
 *
 * PURE finite-state machine. Given the current stage, the NLU understanding, and
 * the cart, it decides the next stage and the ordered list of ACTIONS to run.
 *
 * Key properties (fixing the old god-switch):
 *  - Non-linear: transitions are driven by INTENT, not strictly by position. A
 *    price question during address collection answers the question and STAYS in
 *    the address stage.
 *  - Multi-intent aware: a single message ("add fries and what's the biryani price")
 *    yields multiple actions in one turn.
 *  - No regex / keyword logic. It consumes the structured `TurnUnderstanding`.
 *  - Pure & synchronous: trivially unit-testable with no network/DB.
 *
 * The pipeline (Phase 7) executes the returned actions (which do the async work:
 * vector search, cart mutation, order placement) and renders the reply.
 */
import type { Intent, TurnUnderstanding } from "./nlu";
import type { CartItem, ConversationStage, OrderType } from "@/lib/schema.types";

export type AgentActionKind =
  | "greet"
  | "show_menu"
  | "answer_info"          // menu/item info or recommendation via vector search
  | "answer_grounded"      // any question answered from restaurant facts (LLM, grounded)
  | "add_items"
  | "remove_items"
  | "update_quantity"
  | "offer_upsell"
  | "ask_order_type"
  | "collect_delivery_address"
  | "collect_dinein_details"
  | "collect_pickup_time"
  | "show_summary"
  | "show_cart"            // show cart contents without checkout flow
  | "place_order"
  | "cancel_order"
  | "restart_order"
  | "reorder_previous"
  | "report_order_status"
  | "answer_payment"
  | "answer_hours_location"
  | "smalltalk"
  | "ask_clarification"    // ambiguous affirm/deny or unresolved reference
  | "escalate_human"
  | "fallback";

export interface AgentAction {
  kind: AgentActionKind;
  /** Carries the relevant slice of understanding for the executor. */
  payload?: Record<string, unknown>;
}

export interface StateView {
  stage: ConversationStage;
  cart: CartItem[];
  order_type: OrderType | null;
  has_address: boolean;
  has_dinein_details: boolean;
  has_pickup_time: boolean;
  upsell_offered: boolean;
  /** True when we just showed a list/options and a bare affirm/number is meaningful. */
  awaiting_selection: boolean;
}

export interface Transition {
  nextStage: ConversationStage;
  actions: AgentAction[];
  /** Escalation short-circuits everything. */
  escalate: boolean;
}

const CHECKOUT_STAGES: ConversationStage[] = [
  "choosing_order_type",
  "collecting_delivery",
  "collecting_dinein",
  "collecting_pickup",
  "confirming",
];

function stageForOrderType(orderType: OrderType): ConversationStage {
  switch (orderType) {
    case "delivery":
      return "collecting_delivery";
    case "dine-in":
      return "collecting_dinein";
    case "pickup":
      return "collecting_pickup";
  }
}

/** Which slot is still missing for the chosen order type? null = ready to confirm. */
function missingCheckoutStage(view: StateView): ConversationStage | null {
  if (!view.order_type) return "choosing_order_type";
  if (view.order_type === "delivery" && !view.has_address) return "collecting_delivery";
  if (view.order_type === "dine-in" && !view.has_dinein_details) return "collecting_dinein";
  if (view.order_type === "pickup" && !view.has_pickup_time) return "collecting_pickup";
  return null;
}

/**
 * Like missingCheckoutStage but for a NEWLY chosen order type (the view hasn't
 * been patched yet so we check against the known type directly).
 */
function missingCheckoutStageForType(orderType: "delivery" | "pickup" | "dine-in", view: StateView): ConversationStage | null {
  if (orderType === "delivery" && !view.has_address) return "collecting_delivery";
  if (orderType === "dine-in" && !view.has_dinein_details) return "collecting_dinein";
  if (orderType === "pickup" && !view.has_pickup_time) return "collecting_pickup";
  return null;
}

/**
 * Informational intents that can be answered WITHOUT leaving the current stage
 * (the non-linear "ask a question mid-checkout" case).
 */
function infoActionFor(intent: Intent, u: TurnUnderstanding): AgentAction | null {
  switch (intent) {
    case "browse_menu":
      return { kind: "show_menu" };
    case "ask_item_info":
    case "ask_recommendation":
      return { kind: "answer_info", payload: { query: u.info_query, items: u.items, intent } };
    case "ask_payment":
    case "ask_hours_or_location":
    case "ask_delivery_info":
    case "general_question":
      return { kind: "answer_grounded", payload: { query: u.info_query, intent } };
    case "order_status":
      return { kind: "report_order_status" };
    case "view_cart":
      return { kind: "show_cart" };
    case "smalltalk":
      return { kind: "smalltalk" };
    default:
      return null;
  }
}

/**
 * Compute the transition. Pure function of (view, understanding).
 */
export function nextTransition(view: StateView, u: TurnUnderstanding): Transition {
  // 1) Escalation always wins.
  if (u.wants_human || u.intents.includes("human_request") || u.sentiment === "angry" || u.intents.includes("complaint")) {
    return { nextStage: "human", actions: [{ kind: "escalate_human", payload: { reason: u.intents.includes("complaint") ? "complaint" : "requested" } }], escalate: true };
  }

  const actions: AgentAction[] = [];
  let nextStage: ConversationStage = view.stage;

  // 2) Hard resets.
  if (u.intents.includes("restart_order")) {
    return { nextStage: "browsing", actions: [{ kind: "restart_order" }], escalate: false };
  }
  if (u.intents.includes("cancel_order")) {
    return { nextStage: "post_order", actions: [{ kind: "cancel_order" }], escalate: false };
  }
  if (u.intents.includes("reorder_previous")) {
    return { nextStage: "confirming", actions: [{ kind: "reorder_previous" }], escalate: false };
  }

  // 3) Greeting (only meaningful when we have no cart / at start).
  if (u.intents.includes("greeting") && view.cart.length === 0 && (view.stage === "greeting" || view.stage === "browsing")) {
    actions.push({ kind: "greet" });
    nextStage = "browsing";
  }

  // 4) Cart mutations (can happen from almost any stage — non-linear).
  if (u.intents.includes("add_items") && u.items.length > 0) {
    actions.push({ kind: "add_items", payload: { items: u.items } });
    nextStage = "building_cart";
  }
  if (u.intents.includes("remove_items") && u.removals.length > 0) {
    actions.push({ kind: "remove_items", payload: { removals: u.removals } });
    nextStage = view.cart.length > 0 ? "building_cart" : nextStage;
  }
  if (u.intents.includes("update_quantity") && u.items.length > 0) {
    actions.push({ kind: "update_quantity", payload: { items: u.items } });
    nextStage = "building_cart";
  }

  // 5) Informational intents — answered WITHOUT changing checkout stage if we're
  //    mid-checkout (the key non-linear behavior).
  const inCheckout = CHECKOUT_STAGES.includes(view.stage);
  for (const intent of u.intents) {
    const infoAction = infoActionFor(intent, u);
    if (infoAction) {
      actions.push(infoAction);
      // Stay where we are if in checkout; otherwise drift to browsing for menu/info.
      if (!inCheckout && (infoAction.kind === "show_menu" || infoAction.kind === "answer_info")) {
        nextStage = view.cart.length > 0 ? "building_cart" : "browsing";
      }
    }
  }

  // 6) Order-type / logistics slot filling.
  if (u.order_type || u.intents.includes("set_order_type")) {
    const chosen = u.order_type;
    if (chosen) {
      actions.push({ kind: "ask_order_type", payload: { chosen } });
      nextStage = stageForOrderType(chosen);
      // After setting order type, immediately prompt for the next required slot
      // so the agent doesn't go silent.
      const missingAfterType = missingCheckoutStageForType(chosen, view);
      if (missingAfterType) {
        actions.push(promptForStage(missingAfterType));
      } else if (view.cart.length > 0) {
        // All slots filled — show summary
        actions.push({ kind: "show_summary" });
        nextStage = "confirming";
      }
    } else {
      // set_order_type intent but no order_type value — ask
      actions.push({ kind: "ask_order_type" });
    }
  }
  if (u.address) {
    actions.push({ kind: "collect_delivery_address", payload: { address: u.address } });
    // After address, show summary if cart is ready
    if (view.cart.length > 0) {
      actions.push({ kind: "show_summary" });
      nextStage = "confirming";
    }
  }
  if (u.guests || u.reservation_time) {
    actions.push({ kind: "collect_dinein_details", payload: { guests: u.guests, reservation_time: u.reservation_time } });
    if (view.cart.length > 0) {
      actions.push({ kind: "show_summary" });
      nextStage = "confirming";
    }
  }
  if (u.pickup_time) {
    actions.push({ kind: "collect_pickup_time", payload: { pickup_time: u.pickup_time } });
    if (view.cart.length > 0) {
      actions.push({ kind: "show_summary" });
      nextStage = "confirming";
    }
  }

  // 7) Confirmation.
  if (u.intents.includes("confirm_order")) {
    const missing = missingCheckoutStage(view);
    if (view.cart.length === 0) {
      actions.push({ kind: "ask_clarification", payload: { reason: "empty_cart" } });
    } else if (missing) {
      // They said "confirm" but a slot is missing — advance to the missing slot.
      nextStage = missing;
      actions.push(promptForStage(missing));
    } else {
      actions.push({ kind: "place_order" });
      nextStage = "placed";
    }
  }

  // 8) Bare affirm / deny — resolve against context.
  if (u.primary_intent === "affirm" && actions.length === 0) {
    if (view.upsell_offered) {
      // Treat as accepting the upsell — executor decides item.
      actions.push({ kind: "add_items", payload: { fromUpsell: true } });
      nextStage = "building_cart";
    } else if (view.stage === "confirming") {
      const missing = missingCheckoutStage(view);
      if (!missing && view.cart.length > 0) {
        actions.push({ kind: "place_order" });
        nextStage = "placed";
      } else if (missing) {
        nextStage = missing;
        actions.push(promptForStage(missing));
      }
    } else if (view.awaiting_selection) {
      actions.push({ kind: "ask_clarification", payload: { reason: "which_option" } });
    } else {
      actions.push({ kind: "ask_clarification", payload: { reason: "affirm_no_context" } });
    }
  }
  if (u.primary_intent === "deny" && actions.length === 0) {
    if (view.upsell_offered) {
      // Declined upsell — proceed toward checkout.
      const missing = missingCheckoutStage(view);
      nextStage = missing ?? "confirming";
      actions.push(missing ? promptForStage(missing) : { kind: "show_summary" });
    } else {
      actions.push({ kind: "smalltalk", payload: { deny: true } });
    }
  }

  // 9) After adding items, decide whether to move the flow forward.
  const addedItems = actions.some((a) => a.kind === "add_items");
  if (addedItems && !u.intents.includes("confirm_order")) {
    // Offer upsell once, else surface summary/next-step. Executor may no-op upsell.
    if (!view.upsell_offered) {
      actions.push({ kind: "offer_upsell" });
    }
  }

  // 10) Nothing matched → fallback (never a generic canned reply; executor uses info_query/vector).
  if (actions.length === 0) {
    if (u.info_query) {
      // Any leftover question → grounded answer (menu + facts), never a dead end.
      actions.push({ kind: "answer_grounded", payload: { query: u.info_query, intent: "general_question" } });
    } else {
      // Truly empty/meaningless: grounded answer on the raw message beats a canned
      // "I didn't get that" — the LLM can still greet/steer helpfully.
      actions.push({ kind: "fallback", payload: { primary_intent: u.primary_intent } });
    }
  }

  return { nextStage, actions, escalate: false };
}

function promptForStage(stage: ConversationStage): AgentAction {
  switch (stage) {
    case "choosing_order_type":
      return { kind: "ask_order_type" };
    case "collecting_delivery":
      return { kind: "collect_delivery_address" };
    case "collecting_dinein":
      return { kind: "collect_dinein_details" };
    case "collecting_pickup":
      return { kind: "collect_pickup_time" };
    case "confirming":
      return { kind: "show_summary" };
    default:
      return { kind: "fallback" };
  }
}
