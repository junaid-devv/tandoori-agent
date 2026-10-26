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
import { orderRepo } from "@/lib/data/order.repo";
import { reply } from "./reply";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { inferLanguagePreference } from "@/lib/core/lang-detect";
import { extractBaseItemName, extractSizeFromQuery } from "@/lib/menu/search";
import type { ConversationStateRow } from "@/lib/schema.types";
import type { ConversationStage } from "@/lib/schema.types";

export interface TurnResult {
  replyText: string;
  stage: ConversationStage;
  address?: string | null;
  placeOrder: boolean;
  escalate: boolean;
  intent: string;
  usedSemanticSearch: boolean;
  latencyMs: number;
  interactive?: InteractivePayload | null;
  mediaUrls?: string[];
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
  menuDisplayMode?: string;
  menuCardImages?: string[];
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
    questions: [],
    sentiment: "neutral",
    wants_human: false,
    notes: "fast_path_interactive",
  };
}

/**
 * Deterministic interpretation of an interactive tap id.
 * Returns a synthesized understanding so we skip the NLU LLM call entirely.
 */
export function understandingFromInteractiveId(
  id: string,
  language: TurnUnderstanding["language"],
  lastShownOptions: Array<{ id: string; name: string; price: number }>,
  pendingOptions?: Array<{ id: string; label: string }>,
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
      if (val === "yes" || val === "confirm") {
        return { ...base, intents: ["confirm_order"], primary_intent: "confirm_order", notes: "fast_path_confirm" };
      }
      // "Go Back" / "Wapas Jao" — show cart, don't cancel
      return { ...base, intents: ["view_cart"], primary_intent: "view_cart" };

    case "item": {
      const chosen = lastShownOptions.find((o) => o.id === val);
      const pendingMatch = pendingOptions?.find((o) => o.id === `item:${val}` || o.id === val);
      const name = chosen?.name ?? pendingMatch?.label ?? val;
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
        return {
          ...base,
          intents: ["browse_menu"],
          primary_intent: "browse_menu",
          info_query: "add_more",
          notes: "fast_path_add_more",
        };
      }
      if (val === "view_menu") {
        return {
          ...base,
          intents: ["browse_menu"],
          primary_intent: "browse_menu",
          info_query: "view_menu",
          notes: "fast_path_view_menu",
        };
      }
      return null;

    case "addr":
      if (val === "new") {
        // User wants to type a new address — tell FSM to prompt for it
        return { ...base, intents: ["provide_address"], primary_intent: "provide_address", notes: "prompt_new_address" };
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

/** Exact choices only. Natural-language edits, questions and compound orders go to NLU. */
export function fastUnderstanding(text: string, state: ConversationStateRow, savedAddressId?: string | null): TurnUnderstanding | null {
  const raw = text.trim().replace(/^\[voice note\]\s*/i, "").trim();
  const lang = inferLanguagePreference(raw, state.preferred_language);
  const options = state.pending_clarification?.options ?? [];
  const recent = state.last_shown_options_at && Date.now() - Date.parse(state.last_shown_options_at) < 5 * 60_000;
  const shown = recent ? state.last_shown_options : [];
  const fromId = (id: string) => {
    const u = understandingFromInteractiveId(id, lang, shown, options);
    if (u?.items.length && state.pending_clarification?.remaining_items?.length) {
      const [pending, ...remaining] = state.pending_clarification.remaining_items;
      u.items = [{ ...pending, query: u.items[0].query, size: null }, ...remaining];
    }
    return u;
  };
  if (/^(ordertype|confirm|item|category|action|addr):/.test(raw)) {
    // Item IDs must belong to the current menu options, not a stale or forged tap.
    if (raw.startsWith("item:") && !shown.some((o) => `item:${o.id}` === raw)) return null;
    return fromId(raw);
  }
  const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const numeric = raw.match(NUMERIC_RE);
  if (numeric && options.length) {
    const option = options[Number(numeric[1]) - 1];
    return option ? fromId(option.id) : { ...makeBase(lang), notes: "fast_path_invalid_selection" };
  }
  // Exact label equivalence: "don't confirm" and "no delivery" must never match a button.
  const matches = options.filter((o) => normalize(o.label) === normalize(raw));
  if (matches.length === 1) return fromId(matches[0].id);
  if (state.pending_clarification?.remaining_items?.length && recent) {
    const volumeOnly = /^\d+(?:\.\d+)?\s*(?:ml|l(?:itre|iter)?s?)$/i.test(raw);
    const variants = shown.filter((o) => normalize(extractBaseItemName(o.name).variant ?? "") === normalize(raw)
      || volumeOnly && extractSizeFromQuery(o.name) === extractSizeFromQuery(raw));
    if (variants.length === 1) return fromId(`item:${variants[0].id}`);
  }
  if (numeric && recent && (state.stage === "browsing" || state.stage === "building_cart")) {
    const option = shown[Number(numeric[1]) - 1];
    if (option) {
      const u = fromId(`item:${option.id}`);
      if (u) u.notes = "fast_path_numeric_selection";
      return u;
    }
  }
  const base = makeBase(lang);
  if (/^(?:ass?alam(?:u?\s*(?:o|al)?\s*alaikum)?|aoa|salam|hi|hello|hey|stare?\s*mashay|pa\s*kher)[!.]*$/i.test(raw)) {
    return { ...base, intents: ["greeting"], primary_intent: "greeting" };
  }
  if (/^(?:yes|haan|han|ji|jee|ok|okay|theek hai|done|confirm|confirm order|place order)[!.]*$/i.test(raw)) {
    return { ...base, intents: ["affirm"], primary_intent: "affirm" };
  }
  if (/^(?:checkout|check out|proceed to checkout|bill)$/i.test(raw)) return fromId("action:checkout");
  if (/^(?:menu|view menu)$/i.test(raw)) return fromId("action:view_menu");
  if (/^(?:add more|aur add karna hai|kuch aur add karna hai|or kia add krna hai)$/i.test(raw)) return fromId("action:add_more");
  if (/^(?:back|go back|wapas jao|view cart)$/i.test(raw)) return fromId("action:view_cart");
  if (/^(?:new address|naya address)$/i.test(raw)) return fromId("addr:new");
  // Exact address references are slot changes, never a replay of previous food.
  if (/^(?:old address|previous address|same address|use saved(?: address)?|pichla address|purana address|wahi address|pakhwanay address)[!.]*$/i.test(raw)) {
    return savedAddressId ? fromId(`addr:saved:${savedAddressId}`)
      : { ...base, intents: ["provide_address"], primary_intent: "provide_address", notes: "prompt_new_address" };
  }
  if (/^(?:[?؟]+|what next|next step|ab kya|aage kya)[!.?؟]*$/i.test(raw)) return { ...base, notes: "fast_path_resume" };
  if (/^(?:delivery|pickup|takeaway|dine[ -]?in)$/i.test(raw)) {
    return fromId(`ordertype:${/^dine/i.test(raw) ? "dine-in" : /^take/i.test(raw) ? "pickup" : raw.toLowerCase()}`);
  }
  return null;
}

function priorHistory(history: Array<{ id: string; role: "user" | "assistant"; content: string }>, messageId?: string | null) {
  const current = history.findIndex((m) => m.id === messageId);
  // If the current message fell outside the window, use no history rather than future turns.
  return (messageId ? (current >= 0 ? history.slice(0, current) : []) : history)
    .map(({ role, content }) => ({ role, content }));
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

  // Placement consumes the reviewed cart in its own DB transaction. If the
  // process crashed before committing the reply receipt, recover that same
  // order's acknowledgment instead of reinterpreting an empty-cart confirm.
  if (ctx.state.stage === "placed" && !ctx.state.cart.length && input.sourceUserMessageId) {
    const order = await orderRepo.getLatestForConversation(input.conversationId);
    if (order?.source_user_message_id === input.sourceUserMessageId) {
      const text = reply.orderPlaced(ctx.state.preferred_language, order.order_number ?? order.id,
        input.currency, order.total, order.type, ctx.settings);
      if (input.messageId) await stateRepo.commitTurn(input.conversationId, input.messageId,
        { stage: "placed", summary_sent_at: null, pending_clarification: null,
          last_user_whatsapp_msg_id: input.whatsappMessageId ?? undefined,
          last_processed_user_message_at: new Date().toISOString() }, { replyText: text });
      return { replyText: text, stage: "placed", placeOrder: false, escalate: false,
        intent: "recovered_order_reply", usedSemanticSearch: false, latencyMs: Date.now() - startedAt };
    }
  }

  let understanding = fastUnderstanding(input.messageText, ctx.state, ctx.savedAddress?.id);

  // ── 2) NLU ─────────────────────────────────────────────────────────────────
  const nluStart = Date.now();
  if (!understanding) {
    understanding = await understandTurn({
      messageText: input.messageText,
      language: ctx.state.preferred_language,
      stage: ctx.state.stage,
      cart: ctx.state.cart.map((c) => ({ name: c.name, qty: c.qty })),
      lastShownOptions: ctx.view.awaiting_selection ? ctx.state.last_shown_options.map((o) => o.name) : [],
      conversationId: input.conversationId,
      pendingOptions: ctx.state.pending_clarification?.options,
      pendingItems: ctx.state.pending_clarification?.remaining_items,
      fulfillment: {
        order_type: ctx.state.order_type, address: ctx.state.address, guests: ctx.state.guests,
        reservation_time: ctx.state.reservation_time, pickup_time: ctx.state.pickup_time,
      },
      // Only history preceding this inbound message; never consume later queued turns.
      history: priorHistory(ctx.history ?? [], input.messageId),
    });
  }
  t.nlu = Date.now() - nluStart;

  // Uncertain extractions must not edit a real order. Explicit taps have confidence 1.
  if (understanding.confidence < 0.55 && !understanding.wants_human) {
    understanding = { ...makeBase(understanding.language), confidence: understanding.confidence,
      notes: "fast_path_uncertain_understanding" };
  }
  const invalidStepCount = understanding.primary_intent === "unknown" && understanding.notes !== "fast_path_resume" ? ctx.state.invalid_step_count + 1 : 0;
  if (invalidStepCount >= 3) {
    understanding = { ...understanding, wants_human: true, intents: ["human_request"], primary_intent: "human_request" };
  }

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
    currency: input.currency || (ctx.settings as unknown as { currency?: string })?.currency || "Rs.",
    customerName: input.customerName ?? null,
    messageTextForFallback: input.messageText,
    menuDisplayMode: input.menuDisplayMode,
    menuCardImages: input.menuCardImages,
  });
  t.exec = Date.now() - execStart;

  // ── 5) Persist state — AWAITED before returning ───────────────────────────
  // This is intentionally awaited (not fire-and-forget) so that the next turn
  // (e.g. confirm button tap arriving within milliseconds) always sees the
  // updated order_type / address / cart. The ~30–50 ms overhead is worth the
  // correctness guarantee.
  {
    const statePatch = {
      ...exec.statePatch,
      invalid_step_count: invalidStepCount,
      last_processed_user_message_id: input.whatsappMessageId ?? undefined,
      last_user_whatsapp_msg_id: input.whatsappMessageId ?? undefined,
      last_processed_user_message_at: new Date().toISOString(),
    };
    if (input.messageId) await stateRepo.commitTurn(input.conversationId, input.messageId, statePatch, {
      replyText: exec.replyText, interactive: exec.interactive ?? null, mediaUrls: exec.mediaUrls,
    });
    else await stateRepo.patch(input.conversationId, statePatch);
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
    address: exec.statePatch.address !== undefined ? exec.statePatch.address : ctx.state.address,
    placeOrder: exec.placeOrder,
    escalate: exec.escalate,
    intent: understanding.primary_intent,
    usedSemanticSearch: exec.usedSemanticSearch,
    latencyMs,
    interactive: exec.interactive ?? null,
    mediaUrls: exec.mediaUrls,
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
