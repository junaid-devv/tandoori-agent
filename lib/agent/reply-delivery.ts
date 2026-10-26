/** Durable delivery of a committed turn. Safe failures may be retried without
 * running NLU, changing the cart or placing an order a second time. */
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendAndPersistAssistantMessage } from "@/lib/assistant-dispatcher";
import { OutboundMessageError } from "@/lib/messages";
import { createStaffAlert } from "@/lib/staff-alerts";
import type { InteractivePayload } from "./interactive";

export interface StoredAgentReply {
  replyText: string;
  interactive?: InteractivePayload | null;
  mediaUrls?: string[];
}

/** Caller holds the conversation lock. The DB claim is also atomic, so another
 * worker cannot accidentally send the same stored reply concurrently. A send
 * with an uncertain provider outcome is deliberately never auto-retried. */
export async function deliverCommittedReply(input: {
  conversationId: string; branchId: string; messageId: string; phone: string; phoneNumberId?: string;
}, send = sendAndPersistAssistantMessage): Promise<void> {
  const token = randomUUID();
  const { data, error } = await supabaseAdmin.rpc("claim_restaurant_agent_reply", {
    p_conversation_id: input.conversationId, p_message_id: input.messageId, p_token: token,
  });
  if (error) throw error;
  if (!data) {
    const receipt = await supabaseAdmin.from("messages").select("metadata").eq("id", input.messageId)
      .eq("conversation_id", input.conversationId).maybeSingle();
    if (receipt.error) throw receipt.error;
    if (["sending", "uncertain"].includes(receipt.data?.metadata?.agent_reply_status)) {
      await createStaffAlert({ conversationId: input.conversationId, branchId: input.branchId,
        kind: "delivery_notification", severity: "high",
        message: "A committed reply has an uncertain delivery outcome. Check WhatsApp delivery before resending; the order/cart must not be entered again." });
    }
    return;
  }
  const stored = data as StoredAgentReply;
  let accepted = false;
  const finish = async (status: "sent" | "failed" | "uncertain") => {
    const { error: finishError } = await supabaseAdmin.rpc("finish_restaurant_agent_reply", {
      p_conversation_id: input.conversationId, p_message_id: input.messageId, p_token: token, p_status: status,
    });
    if (finishError) throw finishError;
  };
  try {
    await send({ conversationId: input.conversationId, phone: input.phone,
      content: stored.replyText, phoneNumberId: input.phoneNumberId,
      interactiveList: stored.interactive?.kind === "list" ? stored.interactive.payload : null,
      replyButtons: stored.interactive?.kind === "buttons" ? stored.interactive.payload : null,
      mediaUrls: stored.mediaUrls ?? null });
    accepted = true;
    await finish("sent");
  } catch (sendError) {
    const uncertain = accepted || sendError instanceof OutboundMessageError && sendError.messageSent;
    // If this update itself fails, status remains 'sending': automatic retry
    // stays disabled because the provider might already have accepted it.
    await finish(uncertain ? "uncertain" : "failed");
    throw sendError;
  }
}
