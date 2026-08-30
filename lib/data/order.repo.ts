/**
 * lib/data/order.repo.ts
 * Repository for `orders` + `order_items`.
 * Order PLACEMENT stays in the `place_order_from_payload` RPC (atomic, validated);
 * this repo covers reads and status transitions.
 */
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { OrderStatus, OrderType } from "@/lib/schema.types";

export interface OrderRow {
  id: string;
  branch_id: string;
  conversation_id: string;
  source_user_message_id: string | null;
  order_number: number;
  type: OrderType;
  status: OrderStatus;
  subtotal: number;
  delivery_fee: number;
  total: number;
  customer_instructions: string | null;
  address: string | null;
  guests: number | null;
  reservation_time: string | null;
  pickup_time: string | null;
  cancellation_requested_at: string | null;
  cancelled_at: string | null;
  assigned_to: string | null;
  status_notified_at: string | null;
  status_notification_status: "sent" | "failed" | "skipped" | null;
  status_notification_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItemRow {
  id: string;
  order_id: string;
  name: string;
  qty: number;
  price: number;
  size: string | null;
  addons: string[];
  item_instructions: string | null;
  created_at: string;
}

export interface PlaceOrderPayload {
  conversationId: string;
  branchId: string;
  sourceUserMessageId: string;
  type: OrderType;
  items: Array<{
    menu_item_id?: string;
    name: string;
    qty: number;
    unit_price?: number;
    size?: string | null;
    addons?: string[];
    item_instructions?: string | null;
  }>;
  customerInstructions?: string | null;
  address?: string | null;
  guests?: number | null;
  reservationTime?: string | null;
  pickupTime?: string | null;
  deliveryFee?: number;
}

export const orderRepo = {
  /** Atomic, idempotent placement via RPC. Returns the order id. */
  async place(payload: PlaceOrderPayload): Promise<string> {
    const { data, error } = await supabaseAdmin.rpc("place_order_from_payload", {
      p_conversation_id: payload.conversationId,
      p_branch_id: payload.branchId,
      p_source_user_message_id: payload.sourceUserMessageId,
      p_type: payload.type,
      p_items: payload.items,
      p_customer_instructions: payload.customerInstructions ?? null,
      p_address: payload.address ?? null,
      p_guests: payload.guests ?? null,
      p_reservation_time: payload.reservationTime ?? null,
      p_pickup_time: payload.pickupTime ?? null,
      p_delivery_fee: payload.deliveryFee ?? 0,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    const id = row?.id as string | undefined;
    if (!id) throw new Error("place_order_from_payload returned no order id.");
    return id;
  },

  async getById(id: string): Promise<OrderRow | null> {
    const { data, error } = await supabaseAdmin.from("orders").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return (data as OrderRow) ?? null;
  },

  async getWithItems(id: string): Promise<{ order: OrderRow; items: OrderItemRow[] } | null> {
    const order = await this.getById(id);
    if (!order) return null;
    const { data, error } = await supabaseAdmin
      .from("order_items")
      .select("*")
      .eq("order_id", id)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return { order, items: (data as OrderItemRow[]) ?? [] };
  },

  async getLatestForConversation(conversationId: string): Promise<OrderRow | null> {
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data as OrderRow) ?? null;
  },

  async updateStatus(id: string, status: OrderStatus): Promise<void> {
    const patch: Record<string, unknown> = { status };
    if (status === "cancelled") patch.cancelled_at = new Date().toISOString();
    const { error } = await supabaseAdmin.from("orders").update(patch).eq("id", id);
    if (error) throw error;
  },

  async requestCancellation(id: string): Promise<void> {
    const { error } = await supabaseAdmin
      .from("orders")
      .update({ cancellation_requested_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  },
};
