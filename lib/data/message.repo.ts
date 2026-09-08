/**
 * lib/data/message.repo.ts
 * Repository for `messages`: ingest (with WhatsApp-id dedup), history, delivery status.
 */
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { MessageDeliveryStatus, MessageRole, MessageSenderKind } from "@/lib/schema.types";

export interface MessageRow {
  id: string;
  ingest_seq: number;
  conversation_id: string;
  role: MessageRole;
  sender_kind: MessageSenderKind;
  content: string;
  whatsapp_msg_id: string | null;
  delivery_status: MessageDeliveryStatus | null;
  delivery_error: string | null;
  delivery_status_updated_at: string | null;
  metadata?: Record<string, any> | null;
  created_at: string;
}

const DELIVERY_RANK: Record<MessageDeliveryStatus, number> = {
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
};

export const messageRepo = {
  async insert(input: {
    conversationId: string;
    role: MessageRole;
    senderKind: MessageSenderKind;
    content: string;
    whatsappMsgId?: string | null;
    deliveryStatus?: MessageDeliveryStatus | null;
    metadata?: Record<string, any> | null;
  }): Promise<MessageRow> {
    const { data, error } = await supabaseAdmin
      .from("messages")
      .insert({
        conversation_id: input.conversationId,
        role: input.role,
        sender_kind: input.senderKind,
        content: input.content,
        whatsapp_msg_id: input.whatsappMsgId ?? null,
        delivery_status: input.deliveryStatus ?? null,
        metadata: input.metadata ?? {},
      })
      .select("*")
      .single();
    if (error) throw error;
    return data as MessageRow;
  },

  async getByWhatsappId(whatsappMsgId: string): Promise<MessageRow | null> {
    const { data, error } = await supabaseAdmin
      .from("messages")
      .select("*")
      .eq("whatsapp_msg_id", whatsappMsgId)
      .maybeSingle();
    if (error) throw error;
    return (data as MessageRow) ?? null;
  },

  /** Recent history for a conversation, oldest-first (for LLM context windows). */
  async recentHistory(conversationId: string, limit = 20): Promise<MessageRow[]> {
    const { data, error } = await supabaseAdmin
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("ingest_seq", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return ((data as MessageRow[]) ?? []).reverse();
  },

  async deleteById(id: string): Promise<void> {
    const { error } = await supabaseAdmin.from("messages").delete().eq("id", id);
    if (error) throw error;
  },

  /**
   * Monotonic delivery-status update: never downgrades (e.g. read -> sent is ignored).
   * Returns false when the message is unknown.
   */
  async applyDeliveryStatus(
    whatsappMsgId: string,
    nextStatus: MessageDeliveryStatus,
    opts: { error?: string | null; atIso?: string | null } = {},
  ): Promise<boolean> {
    const existing = await this.getByWhatsappId(whatsappMsgId);
    if (!existing) return false;
    const current = existing.delivery_status;
    if (current && DELIVERY_RANK[nextStatus] < DELIVERY_RANK[current]) return true;

    const { error } = await supabaseAdmin
      .from("messages")
      .update({
        delivery_status: nextStatus,
        delivery_error: nextStatus === "failed" ? opts.error ?? null : null,
        delivery_status_updated_at: opts.atIso ?? new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (error) throw error;
    return true;
  },
};
