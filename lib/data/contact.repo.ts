/**
 * lib/data/contact.repo.ts
 * Repository for `contacts` + `customer_addresses`.
 * Thin, typed wrapper over supabaseAdmin. One place for contact access patterns.
 */
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { LanguagePreference } from "@/lib/schema.types";

export interface ContactRow {
  id: string;
  phone: string;
  name: string | null;
  active_branch_id: string | null;
  preferred_language: LanguagePreference;
  tags: string[];
  notes: string | null;
  total_orders: number;
  last_order_at: string | null;
  created_at: string;
  updated_at: string;
}

export const contactRepo = {
  async getByPhone(phone: string, restaurantId?: string): Promise<ContactRow | null> {
    let query = supabaseAdmin.from("contacts").select("*").eq("phone", phone);
    if (restaurantId) {
      query = query.eq("restaurant_id", restaurantId);
    }
    const { data, error } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return (data as ContactRow) ?? null;
  },

  async getById(id: string): Promise<ContactRow | null> {
    const { data, error } = await supabaseAdmin
      .from("contacts")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return (data as ContactRow) ?? null;
  },

  /** Upsert by phone (unique per restaurant). Returns the row. */
  async upsertByPhone(input: {
    restaurantId: string;
    phone: string;
    name?: string | null;
    active_branch_id?: string | null;
  }): Promise<ContactRow> {
    const { data, error } = await supabaseAdmin
      .from("contacts")
      .upsert(
        {
          restaurant_id: input.restaurantId,
          phone: input.phone,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.active_branch_id !== undefined ? { active_branch_id: input.active_branch_id } : {}),
        },
        { onConflict: "restaurant_id,phone" },
      )
      .select("*")
      .single();
    if (error) throw error;
    return data as ContactRow;
  },

  async setActiveBranch(contactId: string, branchId: string | null): Promise<void> {
    const { error } = await supabaseAdmin
      .from("contacts")
      .update({ active_branch_id: branchId })
      .eq("id", contactId);
    if (error) throw error;
  },

  async setPreferredLanguage(contactId: string, language: LanguagePreference): Promise<void> {
    const { error } = await supabaseAdmin
      .from("contacts")
      .update({ preferred_language: language })
      .eq("id", contactId);
    if (error) throw error;
  },

  /** Increment order stats after a successful order. */
  async recordOrder(contactId: string, orderedAtIso: string): Promise<void> {
    const current = await this.getById(contactId);
    if (!current) return;
    const { error } = await supabaseAdmin
      .from("contacts")
      .update({
        total_orders: (current.total_orders ?? 0) + 1,
        last_order_at: orderedAtIso,
      })
      .eq("id", contactId);
    if (error) throw error;
  },
};
