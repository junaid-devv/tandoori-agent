import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { RESTAURANT_ORDER_SCENARIO } from "@/demo/scenarios/restaurant-order.scenario";
import { getDashboardSession } from "@/lib/auth";

export async function POST(request: Request) {
  const isDemoEnabled = process.env.ENABLE_DEMO_MODE === "true" || process.env.NODE_ENV !== "production";
  const demoSecret = request.headers.get("x-demo-secret");
  const expectedSecret = process.env.DEMO_SECRET_KEY || "tandoori-demo-secret-key";
  const session = await getDashboardSession();

  if (!isDemoEnabled && demoSecret !== expectedSecret && !session) {
    return NextResponse.json({ error: "Demo mode disabled or unauthorized" }, { status: 403 });
  }

  try {
    const demoOrder = RESTAURANT_ORDER_SCENARIO.finalOrder;

    // 1. Get demo branch
    const { data: branch } = await supabaseAdmin
      .from("branches")
      .select("id")
      .eq("slug", RESTAURANT_ORDER_SCENARIO.branchSlug)
      .single();

    if (!branch) {
      return NextResponse.json({ error: "Demo branch not found. Run demo seed first." }, { status: 400 });
    }

    // 2. Get demo conversation
    const { data: conv } = await supabaseAdmin
      .from("conversations")
      .select("id")
      .eq("phone", demoOrder.phone)
      .eq("branch_id", branch.id)
      .single();

    if (!conv) {
      return NextResponse.json({ error: "Demo conversation not found. Run demo seed first." }, { status: 400 });
    }

    // 3. Remove any existing order with order_number 1042 or for this conversation
    await supabaseAdmin.from("orders").delete().eq("conversation_id", conv.id);

    // 4. Create new order
    const { data: createdOrder, error: orderErr } = await supabaseAdmin
      .from("orders")
      .insert({
        branch_id: branch.id,
        conversation_id: conv.id,
        order_number: demoOrder.orderNumber,
        type: demoOrder.type,
        status: "received",
        subtotal: demoOrder.subtotal,
        delivery_fee: demoOrder.deliveryFee,
        address: demoOrder.address,
        customer_instructions: "Mild spice in Peshawari Karahi please",
        assigned_to: null,
      })
      .select()
      .single();

    if (orderErr || !createdOrder) {
      throw new Error(`Failed to insert demo order: ${orderErr?.message}`);
    }

    // 5. Insert order items
    const itemsToInsert = demoOrder.items.map((item) => ({
      order_id: createdOrder.id,
      name: item.name,
      qty: item.qty,
      price: item.price,
      size: item.size ?? null,
      addons: JSON.stringify(item.addons ?? []),
      item_instructions: item.size ? `Size: ${item.size}` : null,
    }));

    const { error: itemsErr } = await supabaseAdmin.from("order_items").insert(itemsToInsert);

    if (itemsErr) {
      throw new Error(`Failed to insert demo order items: ${itemsErr.message}`);
    }

    // Update conversation state to completed
    await supabaseAdmin
      .from("conversation_states")
      .update({
        workflow_step: "completed",
        cart: demoOrder.items,
        order_type: demoOrder.type,
        address: demoOrder.address,
      })
      .eq("conversation_id", conv.id);

    return NextResponse.json({ success: true, order: createdOrder });
  } catch (error) {
    console.error("[api/demo/order] Error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Order creation failed" }, { status: 500 });
  }
}
