/**
 * lib/data/conversation.repo.ts
 * Repository for `conversations`.
 * NOTE: conversation_states access is intentionally NOT here — the state store
 * merge (conversation_states + user_sessions) happens in Phase 5, and its repo
 * (`state.repo.ts`) lands there to migrate call sites atomically.
 */
import { supabaseAdmin } from "@/lib/supabase-admin";

export interface ConversationRow {
  id: string;
  contact_id: string;
  branch_id: string;
  phone: string;
  name: string | null;
  mode: "agent" | "human";
  has_unread: boolean;
  staff_notes: string | null;
  whatsapp_phone?: string | null;
  created_at: string;
  updated_at: string;
}

export const conversationRepo = {
  async getById(id: string): Promise<ConversationRow | null> {
    const { data, error } = await supabaseAdmin.from("conversations").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return (data as ConversationRow) ?? null;
  },

  async getByContactBranch(contactId: string, branchId: string): Promise<ConversationRow | null> {
    const { data, error } = await supabaseAdmin
      .from("conversations")
      .select("*")
      .eq("contact_id", contactId)
      .eq("branch_id", branchId)
      .maybeSingle();
    if (error) throw error;
    return (data as ConversationRow) ?? null;
  },

  /** Get-or-create by (contact_id, branch_id) unique key. */
  async ensure(input: {
    contactId: string;
    branchId: string;
    phone: string;
    name?: string | null;
    whatsappPhone?: string | null;
  }): Promise<ConversationRow> {
    const { data, error } = await supabaseAdmin
      .from("conversations")
      .upsert(
        {
          contact_id: input.contactId,
          branch_id: input.branchId,
          phone: input.phone,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.whatsappPhone ? { whatsapp_phone: input.whatsappPhone } : {}),
        },
        { onConflict: "contact_id,branch_id" },
      )
      .select("*")
      .single();
    if (error) throw error;
    return data as ConversationRow;
  },

  async setMode(id: string, mode: "agent" | "human"): Promise<void> {
    const { error } = await supabaseAdmin.from("conversations").update({ mode }).eq("id", id);
    if (error) throw error;
  },

  async setUnread(id: string, hasUnread: boolean): Promise<void> {
    const { error } = await supabaseAdmin.from("conversations").update({ has_unread: hasUnread }).eq("id", id);
    if (error) throw error;
  },

  async touch(id: string): Promise<void> {
    const { error } = await supabaseAdmin
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  },
};
