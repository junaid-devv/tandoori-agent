import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-utils";
import { requireApiSession } from "@/lib/branch-request";
import { canAccessOrder } from "@/lib/record-access";
import { supabaseAdmin } from "@/lib/supabase-admin";

// GET /api/orders/[id]
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiSession();
  if (auth.response || !auth.session) {
    return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const accessibleOrder = await canAccessOrder(auth.session, id);
  if (!accessibleOrder) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const { data, error } = await supabaseAdmin
    .from("orders")
    .select(`
      id,
      branch_id,
      order_number,
      type,
      status,
      subtotal,
      delivery_fee,
      total,
      customer_instructions,
      cancellation_requested_at,
      cancelled_at,
      address,
      guests,
      reservation_time,
      pickup_time,
      assigned_to,
      created_at,
      branches (id, name, slug, phone, address),
      order_items (id, name, qty, price, size, addons, item_instructions),
      conversations (phone, name)
    `)
    .eq("id", id)
    .single();

  if (error || !data) {
    return apiErrorResponse(error ?? new Error("Order not found"), {
      fallback: "Failed to load order.",
      context: "orders GET [id]",
    });
  }

  return NextResponse.json(data);
}
