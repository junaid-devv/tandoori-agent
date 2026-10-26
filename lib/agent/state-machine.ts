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
  has_guests: boolean;
  has_reservation_time: boolean;
  has_pickup_time: boolean;
  upsell_offered: boolean;
  awaiting_selection: boolean;
  can_confirm?: boolean;
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
      return {
        kind: "show_menu",
        payload: {
          category: u.info_query ?? undefined,
          isAddMore: u.notes === "fast_path_add_more" || u.info_query === "add_more",
        },
      };
    case "ask_item_info":
    case "ask_recommendation":
      return { kind: "answer_info", payload: { query: u.info_query ?? "", intent } };
    case "ask_hours_or_location":
      return { kind: "answer_hours_location" };
    case "ask_payment":
      return { kind: "answer_payment" };
    case "ask_delivery_info":
      return { kind: "answer_delivery_info", payload: { query: u.info_query ?? "" } };
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
  if (u.wants_human || u.intents.includes("human_request") || u.sentiment === "angry" || u.intents.includes("complaint")) {
    return { nextStage: "human", actions: [{ kind: "escalate_human", payload: { reason: u.intents.includes("complaint") ? "complaint" : "requested" } }], escalate: true };
  }
  if (u.intents.includes("restart_order")) return { nextStage: "browsing", actions: [{ kind: "restart_order" }], escalate: false };
  if (u.intents.includes("cancel_order")) return { nextStage: "browsing", actions: [{ kind: "cancel_order" }], escalate: false };
  if (u.intents.includes("reorder_previous")) return { nextStage: "building_cart", actions: [{ kind: "reorder_previous" }], escalate: false };

  const actions: AgentAction[] = [];
  let nextStage = view.stage;
  const adding = u.intents.includes("add_items") && u.items.length > 0;
  const removing = u.intents.includes("remove_items") && u.removals.length > 0;
  const updating = u.intents.includes("update_quantity") && u.items.length > 0;
  const changedCart = adding || removing || updating;
  // Removals first: replacing a dish must not delete the just-added replacement.
  if (removing) actions.push({ kind: "remove_items", payload: { removals: u.removals } });
  if (updating) actions.push({ kind: "update_quantity", payload: { items: u.items } });
  if (adding) {
    actions.push({ kind: "add_items", payload: { items: u.items } });
    if (!view.upsell_offered) actions.push({ kind: "offer_upsell" });
  }
  if (changedCart) nextStage = "building_cart";

  if (u.intents.includes("greeting")) {
    actions.push({ kind: view.cart.length === 0 ? "greet" : "smalltalk" });
    if (!changedCart && view.cart.length === 0) nextStage = "browsing";
  }
  for (const intent of u.intents) {
    const action = infoActionFor(intent, u);
    if (action && !actions.some((a) => a.kind === action.kind)) actions.push(action);
    // Questions and menu interruptions preserve the checkout's missing slot.
    if (action?.kind === "show_menu" && !CHECKOUT_STAGES.includes(view.stage) && !changedCart) {
      nextStage = view.cart.length ? "building_cart" : "browsing";
    }
  }

  const chosenType = u.order_type ?? view.order_type ?? (u.address ? "delivery" : null);
  const effective: StateView = {
    ...view,
    order_type: chosenType,
    has_address: Boolean(u.address) || view.has_address,
    has_guests: Boolean(u.guests) || view.has_guests,
    has_reservation_time: Boolean(u.reservation_time) || view.has_reservation_time,
    has_dinein_details: (Boolean(u.guests) || view.has_guests) && (Boolean(u.reservation_time) || view.has_reservation_time),
    has_pickup_time: Boolean(u.pickup_time) || view.has_pickup_time,
  };
  const hasSlots = Boolean(u.address || u.guests || u.reservation_time || u.pickup_time || u.notes?.startsWith("use_saved_address:"));
  const changedFulfillment = Boolean(u.order_type || hasSlots || u.intents.includes("provide_address"));
  if (u.order_type) actions.push({ kind: "ask_order_type", payload: { chosen: u.order_type } });
  if (u.address || u.notes?.startsWith("use_saved_address:")) {
    actions.push({ kind: "collect_delivery_address", payload: { address: u.address } });
  } else if (u.intents.includes("provide_address")) {
    actions.push({ kind: "collect_delivery_address", payload: { isNewAddressRequest: true } });
    effective.has_address = false;
  }
  if (u.guests || u.reservation_time) actions.push({ kind: "collect_dinein_details", payload: { guests: u.guests, reservation_time: u.reservation_time } });
  if (u.pickup_time) actions.push({ kind: "collect_pickup_time", payload: { pickup_time: u.pickup_time } });

  const confirm = u.intents.includes("confirm_order") || u.primary_intent === "affirm";
  const hasCart = view.cart.length > 0 || adding;
  // Completion always follows mutations and slot validation; no stale summary can authorize a changed order.
  if (hasCart && (confirm || changedFulfillment || (changedCart && chosenType))) {
    const missing = missingSlot(effective);
    if (missing) {
      nextStage = missing;
      const prompt = promptForStage(missing);
      if (!actions.some((a) => a.kind === prompt.kind)) actions.push(prompt);
    } else if (confirm && view.stage === "confirming" && view.can_confirm !== false && !changedCart && !changedFulfillment && !u.notes) {
      actions.push({ kind: "place_order" });
      nextStage = "placed";
    } else if (confirm && view.stage === "confirming" && view.can_confirm !== false && !changedCart && !changedFulfillment && u.notes?.startsWith("fast_path")) {
      actions.push({ kind: "place_order" });
      nextStage = "placed";
    } else {
      actions.push({ kind: "show_summary" });
      nextStage = "confirming";
    }
  } else if (confirm && !hasCart && actions.length === 0) {
    actions.push({ kind: view.stage === "placed" ? "smalltalk" : "ask_clarification", payload: { reason: "empty_cart" } });
  } else if (changedFulfillment && !hasCart) {
    nextStage = chosenType ? (missingSlot(effective) ?? "browsing") : "choosing_order_type";
    if (!hasSlots && chosenType) actions.push(promptForStage(stageForOrderType(chosenType)));
  }
  if (u.primary_intent === "deny" && actions.length === 0) {
    nextStage = view.cart.length ? "building_cart" : "browsing";
    actions.push({ kind: view.cart.length ? "show_cart" : "show_menu" });
  }
  if (actions.length === 0) actions.push(u.info_query ? { kind: "answer_grounded", payload: { query: u.info_query } } : { kind: "fallback" });
  return { nextStage, actions, escalate: false };
}
