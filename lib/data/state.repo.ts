/**
 * lib/data/state.repo.ts — Phase 5
 *
 * The SINGLE conversation state store (new schema `conversation_states`), which
 * absorbs the old `user_sessions` table. Provides:
 *   - get/ensure/patch of the merged state row
 *   - `deriveSessionView()`: reconstructs the legacy user_sessions-shaped fields
 *     (active_node/status) from stage+is_bot_active+escalation, so the dashboard
 *     keeps working without a schema-specific UI rewrite.
 *
 * Call-site migration of the live dashboard/webhook happens in Phase 7 (atomic
 * flip to the new schema); this repo is the target API they migrate onto.
 */
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { ConversationStateRow, ConversationStage } from "@/lib/schema.types";

const TABLE = "conversation_states";

function defaults(conversationId: string): ConversationStateRow {
  const now = new Date().toISOString();
  return {
    conversation_id: conversationId,
    stage: "greeting",
    resume_stage: null,
    cart: [],
    order_type: null,
    address: null,
    guests: null,
    reservation_time: null,
    pickup_time: null,
    customer_instructions: null,
    preferred_language: "english",
    last_shown_options: [],
    last_shown_options_at: null,
    last_shown_category: null,
    pending_clarification: null,
    upsell_item_name: null,
    upsell_item_price: null,
    upsell_offered: false,
    declined_upsells: [],
    summary_sent_at: null,
    last_user_whatsapp_msg_id: null,
    last_processed_user_message_id: null,
    last_processed_message_seq: null,
    last_processed_user_message_at: null,
    processing_token: null,
    processing_started_at: null,
    last_error: null,
    is_bot_active: true,
    invalid_step_count: 0,
    consecutive_tool_failures: 0,
    anger_level: 0,
    last_intent: null,
    escalation_reason: null,
    escalated_at: null,
    created_at: now,
    updated_at: now,
  };
}

export function getDefaultState(conversationId: string): ConversationStateRow {
  return defaults(conversationId);
}

/** Coerce a raw DB row into a fully-populated, type-safe state object. */
export function parseState(raw: Partial<ConversationStateRow> & { conversation_id: string }): ConversationStateRow {
  return { ...defaults(raw.conversation_id), ...raw };
}

export const stateRepo = {
  async get(conversationId: string): Promise<ConversationStateRow | null> {
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .select("*")
      .eq("conversation_id", conversationId)
      .maybeSingle();
    if (error) throw error;
    return data ? parseState(data as Partial<ConversationStateRow> & { conversation_id: string }) : null;
  },

  async ensure(conversationId: string, seed?: Partial<ConversationStateRow>): Promise<ConversationStateRow> {
    // Single upsert — avoids a SELECT + INSERT round trip on new conversations.
    // `ignoreDuplicates: false` returns the existing row on conflict.
    const row = { ...defaults(conversationId), ...seed, conversation_id: conversationId };
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .upsert(row, { onConflict: "conversation_id", ignoreDuplicates: true })
      .select("*")
      .single();
    if (error) throw error;
    return parseState(data as Partial<ConversationStateRow> & { conversation_id: string });
  },

  /** Partial update (upsert on conversation_id). Always bumps updated_at. */
  async patch(conversationId: string, patch: Partial<ConversationStateRow>): Promise<ConversationStateRow> {
    const next = { conversation_id: conversationId, ...patch, updated_at: new Date().toISOString() };
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .upsert(next, { onConflict: "conversation_id" })
      .select("*")
      .single();
    if (error) throw error;
    return parseState(data as Partial<ConversationStateRow> & { conversation_id: string });
  },
};

// ---------------------------------------------------------------------
// Dashboard compatibility view (legacy user_sessions shape)
// ---------------------------------------------------------------------
export type LegacySessionNode =
  | "branch_selection"
  | "menu_lookup"
  | "cart_builder"
  | "checkout"
  | "order_review"
  | "support"
  | "human_handoff";

export interface LegacySessionView {
  active_node: LegacySessionNode;
  status: "active" | "paused" | "human_handoff";
  is_bot_active: boolean;
  invalid_step_count: number;
  escalation_reason: string | null;
  escalated_at: string | null;
}

const STAGE_TO_NODE: Record<ConversationStage, LegacySessionNode> = {
  greeting: "cart_builder",
  browsing: "menu_lookup",
  building_cart: "cart_builder",
  choosing_order_type: "checkout",
  collecting_delivery: "checkout",
  collecting_dinein: "checkout",
  collecting_pickup: "checkout",
  confirming: "order_review",
  placed: "order_review",
  post_order: "support",
  human: "human_handoff",
};

/** Reconstruct the legacy session-shaped fields the dashboard reads. */
export function deriveSessionView(state: ConversationStateRow, mode: "agent" | "human"): LegacySessionView {
  const isHuman = mode === "human" || state.stage === "human" || Boolean(state.escalation_reason);
  return {
    active_node: isHuman ? "human_handoff" : STAGE_TO_NODE[state.stage],
    status: isHuman ? "human_handoff" : state.is_bot_active ? "active" : "paused",
    is_bot_active: !isHuman && state.is_bot_active,
    invalid_step_count: state.invalid_step_count,
    escalation_reason: state.escalation_reason,
    escalated_at: state.escalated_at,
  };
}
