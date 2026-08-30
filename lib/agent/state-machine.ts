/**
 * lib/agent/state-machine.ts
 *
 * Pure FSM: (StateView, TurnUnderstanding) → Transition.
 * No IO, no network — trivially unit-testable.
 */
import type { Intent, TurnUnderstanding } from "./nlu";
import type { CartItem, ConversationStage, OrderType } from "@/lib/schema.types";

export type AgentActionKind =
  | "greet"
  | "show_menu"
  | "answer_info"
  | "answer_grounded"
  | "answer_hours_location"  // deterministic — reads settings, no LLM
  | "answer_payment"         // deterministic — reads settings, no LLM
  | "answer_delivery_info"   // deterministic — reads settings, no LLM
  | "offer_upsell"
  | "add_items"
  | "remove_items"
  | "update_quantity"
  | "ask_order_type"
  | "collect_delivery_address"
  | "collect_dinein_details"
  | "collect_pickup_time"
  | "show_cart"
  | "show_summary"
  | "place_order"
  | "cancel_order"
  | "restart_order"
  | "reorder_previous"
  | "report_order_status"
  | "smalltalk"
  | "ask_clarification"
  | "escalate_human"
  | "fallback";

export interface AgentAction {
  kind: AgentActionKind;
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
  awaiting_selection: boolean;
}

export interface Transition {
  nextStage: ConversationStage;
  actions: AgentAction[];
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
  if (orderType === "delivery") return "collecting_delivery";
  if (orderType === "dine-in") return "collecting_dinein";
  return "collecting_pickup";
}

/** Next missing slot for the current view. null = all slots filled. */
function missingSlot(view: StateView): ConversationStage | null {
  if (!view.order_type) return "choosing_order_type";
  if (view.order_type === "delivery" && !view.has_address) return "collecting_delivery";
  if (view.order_type === "dine-in" && !view.has_dinein_details) return "collecting_dinein";
  if (view.order_type === "pickup" && !view.has_pickup_time) return "collecting_pickup";
  return null;
}

/** Next missing slot after a newly chosen order type (view not patched yet). */
function missingSlotForType(orderType: OrderType, view: StateView): ConversationStage | null {
  if (orderType === "delivery" && !view.has_address) return "collecting_delivery";
  if (orderType === "dine-in" && !view.has_dinein_details) return "collecting_dinein";
  if (orderType === "pickup" && !view.has_pickup_time) return "collecting_pickup";
  return null;
}

function promptForStage(stage: ConversationStage): AgentAction {
  switch (stage) {
    case "choosing_order_type": return { kind: "ask_order_type" };
    case "collecting_delivery":  return { kind: "collect_delivery_address" };
    case "collecting_dinein":    return { kind: "collect_dinein_details" };
    case "collecting_pickup":    return { kind: "collect_pickup_time" };
    case "confirming":           return { kind: "show_summary" };
    default:                     return { kind: "fallback" };
  }
}

/**
 * Informational intents that never advance the checkout stage.
 * Returns a single action or null if the intent is not informational.
 */
function infoActionFor(intent: Intent, u: TurnUnderstanding): AgentAction | null {
  switch (intent) {
    case "browse_menu":
      return { kind: "show_menu" };
    case "ask_item_info":
    case "ask_recommendation":
      return { kind: "answer_info", payload: { query: u.info_query ?? "", intent } };
    case "ask_hours_or_location":
      return { kind: "answer_hours_location" };
    case "ask_payment":
      return { kind: "answer_payment" };
    case "ask_delivery_info":
      return { kind: "answer_delivery_info" };
    case "general_question":
      return { kind: "answer_grounded", payload: { query: u.info_query ?? "", intent } };
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

export function nextTransition(view: StateView, u: TurnUnderstanding): Transition {
  // 1) Escalation always wins
  if (
    u.wants_human ||
    u.intents.includes("human_request") ||
    u.sentiment === "angry" ||
    u.intents.includes("complaint")
  ) {
    return {
      nextStage: "human",
      actions: [{ kind: "escalate_human", payload: { reason: u.intents.includes("complaint") ? "complaint" : "requested" } }],
      escalate: true,
    };
  }

  const actions: AgentAction[] = [];
  let nextStage: ConversationStage = view.stage;

  // 2) Hard resets
  if (u.intents.includes("restart_order")) {
    return { nextStage: "browsing", actions: [{ kind: "restart_order" }], escalate: false };
  }
  if (u.intents.includes("cancel_order")) {
    return { nextStage: "post_order", actions: [{ kind: "cancel_order" }], escalate: false };
  }
  if (u.intents.includes("reorder_previous")) {
    return { nextStage: "confirming", actions: [{ kind: "reorder_previous" }], escalate: false };
  }

  // 3) Greeting — only at the start / empty cart
  if (
    u.intents.includes("greeting") &&
    view.cart.length === 0 &&
    (view.stage === "greeting" || view.stage === "browsing")
  ) {
    actions.push({ kind: "greet" });
    nextStage = "browsing";
  }

  // 4) Cart mutations (non-linear — can happen from any stage)
  if (u.intents.includes("add_items") && u.items.length > 0) {
    actions.push({ kind: "add_items", payload: { items: u.items } });
    if (!view.upsell_offered) {
      actions.push({ kind: "offer_upsell" });
    }
    const allSlotsReady = Boolean(view.order_type && missingSlot(view) === null);
    if (allSlotsReady) {
      actions.push({ kind: "show_summary" });
      nextStage = "confirming";
    } else {
      nextStage = "building_cart";
    }
  }
  if (u.intents.includes("remove_items") && u.removals.length > 0) {
    actions.push({ kind: "remove_items", payload: { removals: u.removals } });
    if (view.cart.length > 1) nextStage = "building_cart";
  }
  if (u.intents.includes("update_quantity") && u.items.length > 0) {
    actions.push({ kind: "update_quantity", payload: { items: u.items } });
    nextStage = "building_cart";
  }

  // 5) Informational intents — always answered, never change checkout stage
  const inCheckout = CHECKOUT_STAGES.includes(view.stage);
  for (const intent of u.intents) {
    const ia = infoActionFor(intent, u);
    if (ia) {
      // Avoid duplicate info actions in the same turn
      if (!actions.some((a) => a.kind === ia.kind)) {
        actions.push(ia);
      }
      if (!inCheckout && (ia.kind === "show_menu" || ia.kind === "answer_info")) {
        nextStage = view.cart.length > 0 ? "building_cart" : "browsing";
      }
    }
  }

  // 6) Order type selection
  if (u.intents.includes("set_order_type") || u.order_type) {
    const chosen = u.order_type;
    if (chosen) {
      actions.push({ kind: "ask_order_type", payload: { chosen } });
      nextStage = stageForOrderType(chosen);
      const hasSlotInThisTurn =
        (chosen === "delivery" && Boolean(u.address || view.has_address)) ||
        (chosen === "pickup" && Boolean(u.pickup_time || view.has_pickup_time)) ||
        (chosen === "dine-in" && Boolean((u.guests || u.reservation_time) || view.has_dinein_details));

      const missing = missingSlotForType(chosen, view);
      if (missing && !hasSlotInThisTurn) {
        actions.push(promptForStage(missing));
        nextStage = missing;
      } else if (view.cart.length > 0 && hasSlotInThisTurn) {
        if (!actions.some((a) => a.kind === "show_summary")) {
          actions.push({ kind: "show_summary" });
        }
        nextStage = "confirming";
      }
    } else {
      actions.push({ kind: "ask_order_type" });
      nextStage = "choosing_order_type";
    }
  }

  // 7) Address / slot collection
  const orderTypeAlreadySet = Boolean(view.order_type || u.order_type);
  if (u.address) {
    actions.push({ kind: "collect_delivery_address", payload: { address: u.address } });
    if (orderTypeAlreadySet && view.cart.length > 0) {
      if (!actions.some((a) => a.kind === "show_summary")) {
        actions.push({ kind: "show_summary" });
      }
      nextStage = "confirming";
    }
  }
  if (u.intents.includes("provide_address") && !u.address) {
    // Tap on "New Address" button — just prompt
    if (!actions.some((a) => a.kind === "collect_delivery_address")) {
      actions.push({ kind: "collect_delivery_address" });
    }
  }
  if (u.guests || u.reservation_time) {
    actions.push({ kind: "collect_dinein_details", payload: { guests: u.guests, reservation_time: u.reservation_time } });
    if (orderTypeAlreadySet && view.cart.length > 0) {
      if (!actions.some((a) => a.kind === "show_summary")) {
        actions.push({ kind: "show_summary" });
      }
      nextStage = "confirming";
    }
  }
  if (u.pickup_time) {
    actions.push({ kind: "collect_pickup_time", payload: { pickup_time: u.pickup_time } });
    if (orderTypeAlreadySet && view.cart.length > 0) {
      if (!actions.some((a) => a.kind === "show_summary")) {
        actions.push({ kind: "show_summary" });
      }
      nextStage = "confirming";
    }
  }

  // 8) Confirm / checkout
  if (u.intents.includes("confirm_order")) {
    if (view.cart.length === 0) {
      actions.push({ kind: "ask_clarification", payload: { reason: "empty_cart" } });
    } else {
      const missing = missingSlot(view);
      if (missing && view.stage !== "confirming") {
        nextStage = missing;
        actions.push(promptForStage(missing));
      } else if (view.stage !== "confirming" && u.notes !== "fast_path_confirm") {
        actions.push({ kind: "show_summary" });
        nextStage = "confirming";
      } else {
        actions.push({ kind: "place_order" });
        nextStage = "placed";
      }
    }
  }

  // 9) Bare affirm — resolve by stage context
  if (u.primary_intent === "affirm" && actions.length === 0) {
    if (view.stage === "confirming") {
      actions.push({ kind: "place_order" });
      nextStage = "placed";
    } else if (view.stage === "building_cart" && view.upsell_offered) {
      actions.push({ kind: "add_items", payload: { upsell: true } });
    } else if (view.awaiting_selection) {
      actions.push({ kind: "ask_clarification", payload: { reason: "which_option" } });
    } else {
      actions.push({ kind: "ask_clarification", payload: { reason: "affirm_no_context" } });
    }
  }

  // 10) Bare deny — go back to cart view
  if (u.primary_intent === "deny" && actions.length === 0) {
    if (view.stage === "building_cart" && view.upsell_offered) {
      nextStage = "choosing_order_type";
      actions.push({ kind: "ask_order_type" });
    } else if (view.cart.length > 0) {
      actions.push({ kind: "show_cart" });
      nextStage = "building_cart";
    } else {
      actions.push({ kind: "show_menu" });
      nextStage = "browsing";
    }
  }

  // 11) Fallback
  if (actions.length === 0) {
    if (u.info_query) {
      actions.push({ kind: "answer_grounded", payload: { query: u.info_query } });
    } else {
      actions.push({ kind: "fallback" });
    }
  }

  return { nextStage, actions, escalate: false };
}
