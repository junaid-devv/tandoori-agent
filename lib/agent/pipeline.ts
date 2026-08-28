/**
 * lib/agent/pipeline.ts — Phase 7
 *
 * The ONE place that sequences a turn:
 *   1. deterministic fast-path (interactive button / bare numeric selection) — no LLM
 *   2. understandTurn() — single LLM extraction
 *   3. nextTransition() — pure FSM
 *   4. executeTurn() — actions -> reply + state patch
 *   5. persist state (+ agent_turns observability)
 *
 * Returns the reply text + metadata; the webhook (Phase 7 wiring / caller) is
 * responsible only for transport (dispatch via assistant-dispatcher) and dedup.
 */
import { understandTurn, type TurnUnderstanding } from "./nlu";
import { nextTransition } from "./state-machine";
import { executeTurn } from "./executor";
import type { InteractivePayload } from "./interactive";
import { loadTurnContext } from "./context";
import { stateRepo } from "@/lib/data/state.repo";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { ConversationStage } from "@/lib/schema.types";

export interface TurnResult {
  replyText: string;
  stage: ConversationStage;
  placeOrder: boolean;
  escalate: boolean;
  intent: string;
  usedSemanticSearch: boolean;
  latencyMs: number;
  interactive?: InteractivePayload | null;
}

export interface RunTurnInput {
  conversationId: string;
  branchId: string;
  phone: string;
  messageText: string;
  sourceUserMessageId: string;
  whatsappMessageId?: string | null;
  messageId?: string | null;
  appName: string;
  currency: string;
  /** Customer's name from WhatsApp contact profile, for personalised greetings. */
  customerName?: string | null;
  /** True for greeting/ack turns where menu load can be skipped. */
  trivial?: boolean;
}

const NUMERIC_RE = /^\s*(\d{1,2})\s*$/;

/**
 * Deterministic interpretation of an interactive tap id (ordertype:*, confirm:*,
 * item:*, category:*). Returns a synthesized understanding so we skip the LLM.
 */
function understandingFromInteractiveId(
  id: string,
  language: TurnUnderstanding["language"],
  lastShownOptions: Array<{ id: string; name: string; price: number }>,
): TurnUnderstanding | null {
  const base: TurnUnderstanding = {
    intents: ["unknown"],
    primary_intent: "unknown",
    confidence: 1,
    language,
    items: [],
    removals: [],
    order_type: null,
    address: null,
    guests: null,
    reservation_time: null,
    pickup_time: null,
    info_query: null,
    sentiment: "neutral",
    wants_human: false,
    notes: "fast_path_interactive",
  };

  const [ns, ...rest] = id.split(":");
  const val = rest.join(":");

  switch (ns) {
    case "ordertype":
      if (val === "delivery" || val === "pickup" || val === "dine-in") {
        return { ...base, intents: ["set_order_type"], primary_intent: "set_order_type", order_type: val };
      }
      return null;
    case "confirm":
      return val === "yes"
        ? { ...base, intents: ["confirm_order"], primary_intent: "confirm_order" }
        : { ...base, intents: ["deny"], primary_intent: "deny" };
    case "item": {
      const chosen = lastShownOptions.find((o) => o.id === val);
      const name = chosen?.name ?? val;
      return {
        ...base,
        intents: ["add_items"],
        primary_intent: "add_items",
        items: [{ query: name, qty: 1, size: null, addons: [], notes: null }],
      };
    }
    case "category":
      return { ...base, intents: ["browse_menu"], primary_intent: "browse_menu", info_query: val };
    case "action":
      if (val === "checkout" || val === "view_cart") {
        return { ...base, intents: ["confirm_order"], primary_intent: "confirm_order" };
      }
      if (val === "add_more") {
        return { ...base, intents: ["browse_menu"], primary_intent: "browse_menu" };
      }
      return null;
    case "addr":
      if (val === "new") {
        // User wants to type a new address — prompt them
        return { ...base, intents: ["provide_address"], primary_intent: "provide_address" };
      }
      if (val.startsWith("saved:")) {
        // Saved address selected — the executor resolves it from the saved record
        return {
          ...base,
          intents: ["provide_address"],
          primary_intent: "provide_address",
          notes: `use_saved_address:${val.replace("saved:", "")}`,
        };
      }
      return null;
    default:
      return null;
  }
}

export async function runTurn(input: RunTurnInput): Promise<TurnResult> {
  const startedAt = Date.now();
  const ctx = await loadTurnContext({
    conversationId: input.conversationId,
    branchId: input.branchId,
    needsMenu: !input.trivial,
  });

  let understanding: TurnUnderstanding | null = null;

  // ---- 1a) Deterministic fast-path: interactive tap (button/list id) ----
  if (/^(ordertype|confirm|item|category):/.test(input.messageText.trim())) {
    understanding = understandingFromInteractiveId(
      input.messageText.trim(),
      ctx.state.preferred_language,
      ctx.state.last_shown_options,
    );
  }

  // ---- 1b) Deterministic fast-path: bare numeric selection of last-shown option ----
  const numeric = input.messageText.match(NUMERIC_RE);
  if (!understanding && numeric && ctx.view.awaiting_selection && ctx.state.last_shown_options.length > 0) {
    const idx = Number(numeric[1]) - 1;
    const chosen = ctx.state.last_shown_options[idx];
    if (chosen) {
      // Synthesize an add_items understanding for the chosen option (no LLM call).
      understanding = {
        intents: ["add_items"],
        primary_intent: "add_items",
        confidence: 1,
        language: ctx.state.preferred_language,
        items: [{ query: chosen.name, qty: 1, size: null, addons: [], notes: null }],
        removals: [],
        order_type: null,
        address: null,
        guests: null,
        reservation_time: null,
        pickup_time: null,
        info_query: null,
        sentiment: "neutral",
        wants_human: false,
        notes: "fast_path_numeric_selection",
      };
    }
  }

  // ---- 2) NLU (single LLM call) ----
  if (!understanding) {
    understanding = await understandTurn({
      messageText: input.messageText,
      language: ctx.state.preferred_language,
      stage: ctx.state.stage,
      cart: ctx.state.cart.map((c) => ({ name: c.name, qty: c.qty })),
      lastShownOptions: ctx.state.last_shown_options.map((o) => o.name),
    });
  }

  // ---- 3) FSM ----
  const transition = nextTransition(ctx.view, understanding);

  // ---- 4) Execute ----
  const exec = await executeTurn({
    transition,
    understanding,
    ctx,
    branchId: input.branchId,
    conversationId: input.conversationId,
    sourceUserMessageId: input.sourceUserMessageId,
    appName: input.appName,
    currency: input.currency,
    customerName: input.customerName ?? null,
    messageTextForFallback: input.messageText,
  });

  // ---- 5) Persist state ----
  await stateRepo.patch(input.conversationId, {
    ...exec.statePatch,
    last_processed_user_message_id: input.whatsappMessageId ?? undefined,
    last_processed_user_message_at: new Date().toISOString(),
  });

  const latencyMs = Date.now() - startedAt;

  // Observability (best-effort; never blocks the reply).
  void recordAgentTurn({
    conversationId: input.conversationId,
    messageId: input.messageId ?? null,
    whatsappMessageId: input.whatsappMessageId ?? null,
    stageBefore: ctx.state.stage,
    stageAfter: exec.statePatch.stage ?? ctx.state.stage,
    decisionKind: exec.escalate ? "escalate_to_human" : exec.placeOrder ? "place_order" : "reply",
    intent: understanding.primary_intent,
    confidence: understanding.confidence,
    entities: understanding,
    usedSemanticSearch: exec.usedSemanticSearch,
    latencyMs,
    replyText: exec.replyText,
    error: exec.statePatch.last_error ?? null,
  });

  return {
    replyText: exec.replyText,
    stage: exec.statePatch.stage ?? ctx.state.stage,
    placeOrder: exec.placeOrder,
    escalate: exec.escalate,
    intent: understanding.primary_intent,
    usedSemanticSearch: exec.usedSemanticSearch,
    latencyMs,
    interactive: exec.interactive ?? null,
  };
}

async function recordAgentTurn(row: {
  conversationId: string;
  messageId: string | null;
  whatsappMessageId: string | null;
  stageBefore: string;
  stageAfter: string;
  decisionKind: "reply" | "place_order" | "escalate_to_human" | "fallback";
  intent: string;
  confidence: number;
  entities: unknown;
  usedSemanticSearch: boolean;
  latencyMs: number;
  replyText: string;
  error: string | null;
}): Promise<void> {
  try {
    await supabaseAdmin.from("agent_turns").insert({
      conversation_id: row.conversationId,
      message_id: row.messageId,
      whatsapp_message_id: row.whatsappMessageId,
      stage_before: row.stageBefore,
      stage_after: row.stageAfter,
      decision_kind: row.decisionKind,
      nlu_intent: row.intent,
      nlu_confidence: row.confidence,
      nlu_entities: row.entities,
      used_semantic_search: row.usedSemanticSearch,
      latency_ms: row.latencyMs,
      processing_result: row.error ? "partial" : "success",
      assistant_reply: row.replyText,
      error_message: row.error,
    });
  } catch (error) {
    console.error("[pipeline] recordAgentTurn failed (non-fatal):", error);
  }
}
