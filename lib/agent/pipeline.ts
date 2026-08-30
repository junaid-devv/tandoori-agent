/**
 * lib/agent/pipeline.ts
 *
 * Sequences a single turn:
 *   1. Deterministic fast-path (interactive tap / bare numeric) — no LLM
 *   2. understandTurn() — single NLU extraction
 *   3. nextTransition() — pure FSM
 *   4. executeTurn() — actions → reply + state patch
 *   5. Persist state (awaited before returning — prevents race with confirm/address taps)
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
  customerName?: string | null;
  trivial?: boolean;
}

const NUMERIC_RE = /^\s*(\d{1,2})\s*$/;

function makeBase(language: TurnUnderstanding["language"]): TurnUnderstanding {
  return {
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
}

/**
 * Deterministic interpretation of an interactive tap id.
 * Returns a synthesized understanding so we skip the NLU LLM call entirely.
 */
function understandingFromInteractiveId(
  id: string,
  language: TurnUnderstanding["language"],
  lastShownOptions: Array<{ id: string; name: string; price: number }>,
): TurnUnderstanding | null {
  const base = makeBase(language);
  const [ns, ...rest] = id.split(":");
  const val = rest.join(":");

  switch (ns) {
    case "ordertype":
      if (val === "delivery" || val === "pickup" || val === "dine-in") {
        return { ...base, intents: ["set_order_type"], primary_intent: "set_order_type", order_type: val };
      }
      return null;

    case "confirm":
      if (val === "yes") {
        return { ...base, intents: ["confirm_order"], primary_intent: "confirm_order", notes: "fast_path_confirm" };
      }
      // "Go Back" / "Wapas Jao" — show cart, don't cancel
      return { ...base, intents: ["view_cart"], primary_intent: "view_cart" };

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
      if (val === "checkout") {
        return { ...base, intents: ["confirm_order"], primary_intent: "confirm_order", notes: "fast_path_checkout" };
      }
      if (val === "view_cart") {
        return { ...base, intents: ["view_cart"], primary_intent: "view_cart" };
      }
      if (val === "add_more") {
        return { ...base, intents: ["browse_menu"], primary_intent: "browse_menu" };
      }
      return null;

    case "addr":
      if (val === "new") {
        // User wants to type a new address — tell FSM to prompt for it
        return { ...base, intents: ["provide_address"], primary_intent: "provide_address" };
      }
      if (val.startsWith("saved:")) {
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
  const t = { ctx: 0, nlu: 0, fsm: 0, exec: 0 };

  const ctx = await loadTurnContext({
    conversationId: input.conversationId,
    branchId: input.branchId,
    needsMenu: true,
  });
  t.ctx = Date.now() - startedAt;

  let understanding: TurnUnderstanding | null = null;

  // ── 1a) Interactive tap (button / list id) ──────────────────────────────────
  if (/^(ordertype|confirm|item|category|action|addr):/.test(input.messageText.trim())) {
    understanding = understandingFromInteractiveId(
      input.messageText.trim(),
      ctx.state.preferred_language,
      ctx.state.last_shown_options,
    );
  }

  // ── 1b) Pure greeting with empty cart ──────────────────────────────────────
  if (
    !understanding &&
    input.trivial &&
    ctx.state.cart.length === 0 &&
    /^(hi|hello|hey|salam|aoa|assalam|hola|hi there|hello there)$/i.test(input.messageText.trim())
  ) {
    understanding = {
      ...makeBase(ctx.state.preferred_language),
      intents: ["greeting"],
      primary_intent: "greeting",
      notes: "fast_path_greeting",
    };
  }

  // ── 1c) Bare numeric selection of last-shown option ────────────────────────
  const numeric = input.messageText.match(NUMERIC_RE);
  if (!understanding && numeric && ctx.view.awaiting_selection && ctx.state.last_shown_options.length > 0) {
    const idx = Number(numeric[1]) - 1;
    const chosen = ctx.state.last_shown_options[idx];
    if (chosen) {
      understanding = {
        ...makeBase(ctx.state.preferred_language),
        intents: ["add_items"],
        primary_intent: "add_items",
        items: [{ query: chosen.name, qty: 1, size: null, addons: [], notes: null }],
        notes: "fast_path_numeric_selection",
      };
    }
  }

  // ── 1d) Name match against last-shown options ──────────────────────────────
  // When options were recently shown (e.g. after category browse or "Add More"),
  // a message that closely matches one of them should add it — not ask about it.
  if (!understanding && ctx.state.last_shown_options.length > 0 && ctx.state.last_shown_options_at) {
    const ageMs = Date.now() - new Date(ctx.state.last_shown_options_at).getTime();
    const OPTION_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
    if (ageMs < OPTION_WINDOW_MS) {
      const text = input.messageText.trim().toLowerCase();
      const match = ctx.state.last_shown_options.find((o) => {
        const oName = o.name.toLowerCase();
        return oName === text || oName.includes(text) || text.includes(oName);
      });
      if (match) {
        understanding = {
          ...makeBase(ctx.state.preferred_language),
          intents: ["add_items"],
          primary_intent: "add_items",
          items: [{ query: match.name, qty: 1, size: null, addons: [], notes: null }],
          notes: "fast_path_name_match",
        };
      }
    }
  }

  // ── 1e) Order type, Checkout, Confirm & Navigation button text fast-paths ───
  if (!understanding) {
    const trimmed = input.messageText.trim();
    if (ctx.view.stage === "confirming" && /^(confirm\s*✓?|confirm order|place order|order confirm|haan confirm|yes confirm)$/i.test(trimmed)) {
      understanding = {
        ...makeBase(ctx.state.preferred_language),
        intents: ["confirm_order"],
        primary_intent: "confirm_order",
        notes: "fast_path_confirm",
      };
    } else if (/^(wapas jao|go back|back|cart dekhein|view cart)$/i.test(trimmed)) {
      understanding = {
        ...makeBase(ctx.state.preferred_language),
        intents: ["view_cart"],
        primary_intent: "view_cart",
        notes: "fast_path_view_cart",
      };
    } else if (/^(aur dalein|aur add karein|add more|aur kuch)$/i.test(trimmed)) {
      understanding = {
        ...makeBase(ctx.state.preferred_language),
        intents: ["browse_menu"],
        primary_intent: "browse_menu",
        notes: "fast_path_add_more",
      };
    } else if (/^(checkout|proceed to checkout|bill)$/i.test(trimmed)) {
      understanding = {
        ...makeBase(ctx.state.preferred_language),
        intents: ["confirm_order"],
        primary_intent: "confirm_order",
        notes: "fast_path_checkout",
      };
    } else if (ctx.view.stage === "choosing_order_type" && /^(delivery|pickup|dine-in|dine in)$/i.test(trimmed)) {
      const raw = trimmed.toLowerCase().replace(" ", "-");
      understanding = {
        ...makeBase(ctx.state.preferred_language),
        intents: ["set_order_type"],
        primary_intent: "set_order_type",
        order_type: raw === "delivery" || raw === "pickup" || raw === "dine-in" ? raw : null,
        notes: "fast_path_order_type",
      };
    } else if (/(?:delivery\s+(?:kis\s+time|kab|timing|time|available\s+hogi|hogi|chal|available)|kab\s+(?:tak\s+)?deliver\s+(?:hoga|hogi)|delivery\s+timing|delivery\s+charges|delivery\s+fee)/i.test(trimmed) && !/karahi|biryani|burger|tikka|kabab|pizza|bhejo|krdo|kardo/i.test(trimmed)) {
      understanding = {
        ...makeBase(ctx.state.preferred_language),
        intents: ["ask_delivery_info"],
        primary_intent: "ask_delivery_info",
        info_query: trimmed,
        notes: "fast_path_delivery_info",
      };
    } else if (/(?:restaurant\s+)?(?:kab|kistime|kis\s+time)\s+(?:open|khulta|khula|khul)|(?:kab|kistime|kis\s+time)\s+(?:open|close|khulta|band)|(?:opening|closing)\s+(?:time|hours)|(?:what\s+are\s+your\s+hours|timing\s+kya\s+hai|restaurant\s+timing|timings\s+kya\s+hain)/i.test(trimmed)) {
      understanding = {
        ...makeBase(ctx.state.preferred_language),
        intents: ["ask_hours_or_location"],
        primary_intent: "ask_hours_or_location",
        info_query: trimmed,
        notes: "fast_path_hours",
      };
    } else if (/^(?:payment|cod|cash\s+on\s+delivery|online\s+payment|card\s+payment|how\s+to\s+pay|payment\s+kese\s+karni\s+hai|payment\s+method)/i.test(trimmed)) {
      understanding = {
        ...makeBase(ctx.state.preferred_language),
        intents: ["ask_payment"],
        primary_intent: "ask_payment",
        info_query: trimmed,
        notes: "fast_path_payment",
      };
    } else if (ctx.menu && ctx.menu.length > 0) {
      const lower = trimmed.toLowerCase();
      const categories = [...new Set(ctx.menu.map((m) => m.category).filter(Boolean))] as string[];
      const matchedCategory = categories.find((c) => {
        const cLower = c.toLowerCase();
        return cLower === lower || cLower.includes(lower) || lower.includes(cLower);
      });
      if (
        matchedCategory &&
        lower !== "menu" &&
        lower.length <= 40 &&
        !/^(order|deliver|bhejo|krdo|kardo|chahiye|mangwana|pack|parcel|add|dal)/i.test(trimmed)
      ) {
        understanding = {
          ...makeBase(ctx.state.preferred_language),
          intents: ["browse_menu"],
          primary_intent: "browse_menu",
          info_query: matchedCategory,
          notes: "fast_path_category_match",
        };
      }
    }
  }

  // ── 2) NLU ─────────────────────────────────────────────────────────────────
  const nluStart = Date.now();
  if (!understanding) {
    understanding = await understandTurn({
      messageText: input.messageText,
      language: ctx.state.preferred_language,
      stage: ctx.state.stage,
      cart: ctx.state.cart.map((c) => ({ name: c.name, qty: c.qty })),
      lastShownOptions: ctx.state.last_shown_options.map((o) => o.name),
    });
  }
  t.nlu = Date.now() - nluStart;

  // ── 3) FSM ─────────────────────────────────────────────────────────────────
  const fsmStart = Date.now();
  const transition = nextTransition(ctx.view, understanding);
  t.fsm = Date.now() - fsmStart;

  // ── 4) Execute ────────────────────────────────────────────────────────────
  const execStart = Date.now();
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
  t.exec = Date.now() - execStart;

  // ── 5) Persist state — AWAITED before returning ───────────────────────────
  // This is intentionally awaited (not fire-and-forget) so that the next turn
  // (e.g. confirm button tap arriving within milliseconds) always sees the
  // updated order_type / address / cart. The ~30–50 ms overhead is worth the
  // correctness guarantee.
  try {
    await stateRepo.patch(input.conversationId, {
      ...exec.statePatch,
      last_processed_user_message_id: input.whatsappMessageId ?? undefined,
      last_user_whatsapp_msg_id: input.whatsappMessageId ?? undefined,
      last_processed_user_message_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[pipeline] state patch failed:", e);
  }

  const latencyMs = Date.now() - startedAt;

  // Observability — best-effort, never blocks reply
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
    latencyBreakdown: t,
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
  latencyBreakdown: { ctx: number; nlu: number; fsm: number; exec: number };
  replyText: string;
  error: string | null;
}): Promise<void> {
  try {
    console.log(
      `[turn] intent=${row.intent} total=${row.latencyMs}ms ` +
      `ctx=${row.latencyBreakdown.ctx}ms nlu=${row.latencyBreakdown.nlu}ms ` +
      `exec=${row.latencyBreakdown.exec}ms fast=${row.latencyBreakdown.nlu === 0}`,
    );
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
