// =====================================================================
// schema.types.ts — TypeScript types for the REBUILT schema (db/schema.sql).
//
// Additive by design: this file introduces the new state model without
// removing the legacy types in database.types.ts that current code still
// imports. Phases 3–7 migrate call sites over to these types, after which
// the legacy definitions can be deleted.
// =====================================================================

import type { Json } from "./database.types";

// ---- Enums (mirror db/schema.sql CHECK constraints) ----

export type LanguagePreference = "english" | "roman_urdu";
export type OrderType = "delivery" | "pickup" | "dine-in";
export type OrderStatus =
  | "received"
  | "preparing"
  | "out_for_delivery"
  | "delivered"
  | "cancelled";

/**
 * Target FSM stage. Replaces the legacy `WorkflowStep`.
 * Non-linear: the state machine advises transitions from NLU intent,
 * not strictly from the current position.
 */
export type ConversationStage =
  | "greeting"
  | "browsing"
  | "building_cart"
  | "choosing_order_type"
  | "collecting_delivery"
  | "collecting_dinein"
  | "collecting_pickup"
  | "confirming"
  | "placed"
  | "post_order"
  | "human";

/** Stages that are valid resume targets (subset of ConversationStage). */
export type ResumeStage = Exclude<ConversationStage, "placed" | "post_order" | "human">;

export type MessageRole = "user" | "assistant";
export type MessageSenderKind = "user" | "ai" | "human" | "system";
export type MessageDeliveryStatus = "pending" | "sent" | "delivered" | "read" | "failed";

export type StaffRole = "admin" | "branch_staff";
export type StaffAlertKind =
  | "human_handoff"
  | "tool_validation"
  | "webhook_processing"
  | "delivery_notification"
  | "customer_cancellation";
export type StaffAlertSeverity = "low" | "medium" | "high";
export type StaffAlertStatus = "open" | "acknowledged" | "resolved";

export type AgentDecisionKind = "reply" | "place_order" | "fallback" | "escalate_to_human";
export type AgentProcessingResult = "success" | "partial" | "recovered" | "failed";

export type BranchMode = "single" | "multiple";
export type WebhookStatus = "received" | "processing" | "processed" | "failed";
export type MenuUploadStatus = "pending" | "processing" | "completed" | "error";

// ---- Cart / draft ----

export interface CartItem {
  menu_item_id: string;
  name: string;
  qty: number;
  unit_price: number;
  size: string | null;
  addons: string[];
  notes: string | null;
}

export interface PendingClarification {
  kind: "item_disambiguation" | "order_type" | "quantity" | "branch";
  options: Array<{ id: string; label: string }>;
}

// ---- conversation_states row (single state store) ----

export interface ConversationStateRow {
  conversation_id: string;

  stage: ConversationStage;
  resume_stage: ResumeStage | null;

  cart: CartItem[];
  order_type: OrderType | null;
  address: string | null;
  guests: number | null;
  reservation_time: string | null;
  pickup_time: string | null;
  customer_instructions: string | null;

  preferred_language: LanguagePreference;

  last_shown_options: Array<{ id: string; name: string; price: number }>;
  last_shown_options_at: string | null;
  last_shown_category: string | null;
  pending_clarification: PendingClarification | null;

  upsell_item_name: string | null;
  upsell_item_price: number | null;
  upsell_offered: boolean;
  declined_upsells: string[];

  summary_sent_at: string | null;
  last_user_whatsapp_msg_id: string | null;
  last_processed_user_message_id: string | null;
  last_processed_message_seq: number | null;
  last_processed_user_message_at: string | null;
  processing_token: string | null;
  processing_started_at: string | null;
  last_error: string | null;

  is_bot_active: boolean;
  invalid_step_count: number;
  consecutive_tool_failures: number;
  anger_level: number;
  last_intent: string | null;
  escalation_reason: string | null;
  escalated_at: string | null;

  created_at: string;
  updated_at: string;
}

// ---- Core rows (new/renamed tables) ----

export interface MenuCategoryRow {
  id: string;
  branch_id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface MenuItemRow {
  id: string;
  branch_id: string;
  category_id: string | null;
  name: string;
  price: number;
  category: string | null;
  description: string | null;
  is_available: boolean;
  available_days: string[];
  available_start_time: string | null;
  available_end_time: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface MenuItemEmbeddingRow {
  menu_item_id: string;
  branch_id: string;
  embedding: string; // pgvector literal
  embedding_model: string;
  embedding_source: string;
  created_at: string;
  updated_at: string;
}

export interface AgentTurnRow {
  id: string;
  conversation_id: string;
  message_id: string | null;
  whatsapp_message_id: string | null;
  stage_before: string;
  stage_after: string;
  decision_kind: AgentDecisionKind;
  nlu_intent: string | null;
  nlu_confidence: number | null;
  nlu_entities: Json;
  used_semantic_search: boolean;
  latency_ms: number | null;
  processing_result: AgentProcessingResult;
  assistant_reply: string | null;
  error_message: string | null;
  created_at: string;
}

// ---- RPC signatures ----

export interface MatchMenuItemRow {
  id: string;
  name: string;
  price: number;
  category: string | null;
  description: string | null;
  is_available: boolean;
  similarity: number;
}
