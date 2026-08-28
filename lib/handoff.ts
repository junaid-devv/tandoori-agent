import { sendAndPersistOutboundMessage, persistSystemMessage } from "./messages";
import { createStaffAlert, resolveStaffAlerts } from "./staff-alerts";
import { supabaseAdmin } from "./supabase-admin";
import { stateRepo } from "./data/state.repo";

function buildHandoffReply(prefersRomanUrdu: boolean): string {
  return prefersRomanUrdu
    ? "Main manager ko message forward kar raha hoon. Thori dair mein reply aa jayega."
    : "I'm forwarding this to the manager. They'll reply shortly.";
}

export async function escalateToHuman(input: {
  conversationId: string;
  branchId: string;
  phone: string;
  reason: string;
  prefersRomanUrdu: boolean;
}) {
  // Check current state to avoid duplicate escalation
  const state = await stateRepo.get(input.conversationId);
  const alreadyEscalated = state?.stage === "human" || state?.is_bot_active === false;

  const now = new Date().toISOString();
  const { error: conversationError } = await supabaseAdmin
    .from("conversations")
    .update({
      mode: "human",
      has_unread: true,
      updated_at: now,
    })
    .eq("id", input.conversationId);

  if (conversationError) throw conversationError;

  // Persist escalation into the merged state store (replaces user_sessions write)
  await stateRepo.patch(input.conversationId, {
    stage: "human",
    is_bot_active: false,
    escalation_reason: input.reason,
    escalated_at: now,
    last_intent: "human_request",
  });

  await createStaffAlert({
    conversationId: input.conversationId,
    branchId: input.branchId,
    kind: "human_handoff",
    severity: "high",
    message: input.reason,
  });

  await persistSystemMessage(input.conversationId, `Conversation escalated to a human operator: ${input.reason}`).catch(
    (error) => {
      console.error("[handoff] Failed to persist handoff note:", error);
    },
  );

  if (!alreadyEscalated) {
    await sendAndPersistOutboundMessage({
      conversationId: input.conversationId,
      phone: input.phone,
      content: buildHandoffReply(input.prefersRomanUrdu),
      senderKind: "system",
    }).catch((error) => {
      console.error("[handoff] Failed to notify customer about handoff:", error);
    });
  }
}

export async function resumeBotForConversation(conversationId: string): Promise<void> {
  await stateRepo.patch(conversationId, {
    stage: "browsing",
    is_bot_active: true,
    escalation_reason: null,
    escalated_at: null,
  });
  await resolveStaffAlerts(conversationId, "human_handoff").catch((error) => {
    console.error("[handoff] Failed to resolve handoff alerts:", error);
  });
}
