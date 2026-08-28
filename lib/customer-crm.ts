import { supabaseAdmin } from "./supabase-admin";
import type { OrderType } from "./schema.types";

/**
 * Reorder cart item — a simplified cart item shape for reorder candidates.
 * Intentionally separate from CartItem (schema.types) which requires menu_item_id;
 * reorder items are reconstructed from order_items rows that pre-date the rebuild.
 */
export interface ReorderCartItem {
  name: string;
  price: number;
  qty: number;
  category: string | null;
  size: string | null;
  addons: string[];
  item_instructions: string | null;
}

export type SavedAddress = {
  id: string;
  label: string;
  address: string;
  last_used_at: string;
  use_count: number;
};

export type ReorderCandidate = {
  orderNumber: number;
  orderType: OrderType;
  address: string | null;
  customerInstructions: string | null;
  items: ReorderCartItem[];
};

function normalizeAddressKey(address: string) {
  return address.toLowerCase().replace(/\s+/g, " ").trim();
}

function getAddressLabel(address: string) {
  const compact = address.replace(/\s+/g, " ").trim();
  if (!compact) return "Saved address";
  return compact.length > 36 ? `${compact.slice(0, 33)}...` : compact;
}

export async function saveCustomerAddressFromOrder(input: {
  conversationId: string;
  branchId: string;
  address: string | null;
}) {
  const address = input.address?.trim();
  if (!address) return;

  const { data: conversation, error: conversationError } = await supabaseAdmin
    .from("conversations")
    .select("contact_id")
    .eq("id", input.conversationId)
    .maybeSingle();
  if (conversationError || !conversation?.contact_id) {
    if (conversationError) console.error("[customer-crm] Failed to load conversation contact:", conversationError);
    return;
  }

  const now = new Date().toISOString();
  const addressKey = normalizeAddressKey(address);
  const { data: existing, error: lookupError } = await supabaseAdmin
    .from("customer_addresses")
    .select("id, use_count")
    .eq("contact_id", conversation.contact_id)
    .eq("branch_id", input.branchId)
    .eq("address_key", addressKey)
    .maybeSingle();

  if (lookupError) {
    console.error("[customer-crm] Failed to find saved address:", lookupError);
    return;
  }

  if (existing) {
    const { error } = await supabaseAdmin
      .from("customer_addresses")
      .update({
        label: getAddressLabel(address),
        address,
        use_count: Number(existing.use_count ?? 0) + 1,
        last_used_at: now,
      })
      .eq("id", existing.id);
    if (error) console.error("[customer-crm] Failed to update saved address:", error);
    return;
  }

  const { error } = await supabaseAdmin.from("customer_addresses").insert({
    contact_id: conversation.contact_id,
    branch_id: input.branchId,
    label: getAddressLabel(address),
    address,
    address_key: addressKey,
    use_count: 1,
    last_used_at: now,
  });
  if (error) console.error("[customer-crm] Failed to save address:", error);
}

export async function updateCustomerOrderStats(input: {
  conversationId: string;
  preferredLanguage?: "english" | "roman_urdu";
}) {
  const { data: conversation, error: conversationError } = await supabaseAdmin
    .from("conversations")
    .select("contact_id")
    .eq("id", input.conversationId)
    .maybeSingle();
  if (conversationError || !conversation?.contact_id) return;

  const { count } = await supabaseAdmin
    .from("orders")
    .select("id, conversations!inner(contact_id)", { count: "exact", head: true })
    .eq("conversations.contact_id", conversation.contact_id);

  await supabaseAdmin
    .from("contacts")
    .update({
      total_orders: count ?? 0,
      last_order_at: new Date().toISOString(),
      ...(input.preferredLanguage ? { preferred_language: input.preferredLanguage } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversation.contact_id);
}

export async function getLatestSavedAddress(conversationId: string): Promise<SavedAddress | null> {
  const { data: conversation, error: conversationError } = await supabaseAdmin
    .from("conversations")
    .select("contact_id, branch_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (conversationError || !conversation?.contact_id) return null;

  const { data, error } = await supabaseAdmin
    .from("customer_addresses")
    .select("id, label, address, last_used_at, use_count")
    .eq("contact_id", conversation.contact_id)
    .eq("branch_id", conversation.branch_id)
    .order("last_used_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data as SavedAddress;
}

export function isUseSavedAddressRequest(text: string) {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  return (
    /\b(same|previous|last|saved|old)\s+(address|location)\b/.test(normalized) ||
    /\b(use|deliver to|send to)\s+(same|previous|last|saved|old)\b/.test(normalized) ||
    /\b(wahi|pichla|purana)\s+(address|location|ghar)\b/.test(normalized)
  );
}

export function isReorderRequest(text: string) {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  return (
    /\b(reorder|repeat|same order|last order|previous order|order again)\b/.test(normalized) ||
    /\b(wahi|same|pichla|previous)\s+(order|cheez|items?)\b/.test(normalized)
  );
}

export async function getLastReorderCandidate(conversationId: string): Promise<ReorderCandidate | null> {
  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .select(`
      id,
      order_number,
      type,
      address,
      customer_instructions,
      order_items (
        name,
        qty,
        price,
        size,
        addons,
        item_instructions
      )
    `)
    .eq("conversation_id", conversationId)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !order) return null;

  const rawItems = Array.isArray(order.order_items) ? order.order_items : [];
  const items: ReorderCartItem[] = rawItems
    .map((item): ReorderCartItem | null => {
      const name = String(item.name ?? "").trim();
      const qty = Number(item.qty ?? 0);
      const price = Number(item.price ?? 0);
      if (!name || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price)) return null;
      return {
        name,
        qty,
        price,
        category: null,
        size: typeof item.size === "string" ? item.size : null,
        addons: Array.isArray(item.addons) ? item.addons.filter((entry): entry is string => typeof entry === "string") : [],
        item_instructions: typeof item.item_instructions === "string" ? item.item_instructions : null,
      };
    })
    .filter((item): item is ReorderCartItem => item != null);

  if (items.length === 0) return null;

  return {
    orderNumber: Number(order.order_number),
    orderType: order.type as OrderType,
    address: typeof order.address === "string" ? order.address : null,
    customerInstructions: typeof order.customer_instructions === "string" ? order.customer_instructions : null,
    items,
  };
}
