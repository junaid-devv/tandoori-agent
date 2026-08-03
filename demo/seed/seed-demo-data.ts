import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

const DEMO_SEED_SCRIPT_PATTERN = /(?:^|[\\/])demo[\\/]seed[\\/]seed-demo-data\.(?:ts|js)$/;

function createDemoSupabaseAdmin() {
  dotenv.config({ path: ".env.local" });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error("❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.");
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.");
  }

  return createClient(supabaseUrl, serviceKey);
}

export async function seedDemoData() {
  const supabaseAdmin = createDemoSupabaseAdmin();

  console.log("🌱 [DEMO SEED] Starting generic fast-food demo data seeding...");

  // 1. Update Restaurant Profile (Burger Hub - Single Branch Mode)
  await supabaseAdmin
    .from("restaurant_profiles")
    .upsert({
      id: "default",
      app_name: "Burger Hub",
      dashboard_title: "Burger Hub Management",
      city: "Lahore",
      currency: "Rs.",
      brand_color: "#EA580C",
      brand_hover_color: "#C2410C",
      branch_mode: "single",
      ai_personality_default: "Warm & Professional",
    }, { onConflict: "id" });

  // Delete secondary branches to enforce true single-branch mode for demo
  await supabaseAdmin.from("branches").delete().neq("slug", "burger-hub-dha");

  // 2. Ensure Single Primary Branch
  const primarySlug = "burger-hub-dha";
  let { data: branch } = await supabaseAdmin
    .from("branches")
    .select("*")
    .eq("slug", primarySlug)
    .maybeSingle();

  if (!branch) {
    const { data: newBranch, error: createBranchErr } = await supabaseAdmin
      .from("branches")
      .insert({
        slug: primarySlug,
        name: "Burger Hub — Main Branch",
        address: "Phase 5 Commercial, DHA, Lahore",
        is_active: true,
      })
      .select()
      .single();

    if (createBranchErr || !newBranch) {
      throw new Error(`Failed to create demo branch: ${createBranchErr?.message}`);
    }
    branch = newBranch;
  } else {
    await supabaseAdmin
      .from("branches")
      .update({
        name: "Burger Hub — Main Branch",
        address: "Phase 5 Commercial, DHA, Lahore",
        is_active: true,
      })
      .eq("id", branch.id);
  }
  const branchId = branch.id;

  // 3. Restaurant Settings
  await supabaseAdmin
    .from("restaurant_settings")
    .upsert(
      {
        branch_id: branchId,
        is_accepting_orders: true,
        opening_time: "12:00 PM",
        closing_time: "02:00 AM",
        delivery_enabled: true,
        delivery_fee: 150,
        min_delivery_amount: 450,
        city: "Lahore",
        phone_delivery: "042-111-222-333",
        phone_dine_in: "042-111-222-334",
        ai_personality: "Warm & Professional",
        delivery_areas: ["DHA Phase 1-6", "Gulberg", "Model Town", "Garden Town", "Askari 10"],
      },
      { onConflict: "branch_id" }
    );

  // 4. Demo Customer Contact ("Ahmed Khan")
  const demoPhone = "+923331234567";
  let { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("*")
    .eq("phone", demoPhone)
    .maybeSingle();

  if (!contact) {
    const { data: newContact, error: createContactErr } = await supabaseAdmin
      .from("contacts")
      .insert({
        phone: demoPhone,
        name: "Ahmed Khan",
        active_branch_id: branchId,
        preferred_language: "roman_urdu",
        tags: ["VIP", "Regular", "Burger Fan"],
        notes: "Prefers extra sauce on Zinger Burger. Prompt delivery to DHA Phase 5.",
        total_orders: 8,
        last_order_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (createContactErr || !newContact) {
      throw new Error(`Failed to create demo contact: ${createContactErr?.message}`);
    }
    contact = newContact;
  } else {
    await supabaseAdmin
      .from("contacts")
      .update({
        name: "Ahmed Khan",
        active_branch_id: branchId,
        tags: ["VIP", "Regular", "Burger Fan"],
        notes: "Prefers extra sauce on Zinger Burger. Prompt delivery to DHA Phase 5.",
      })
      .eq("id", contact.id);
  }

  // Address
  await supabaseAdmin
    .from("customer_addresses")
    .upsert(
      {
        contact_id: contact.id,
        branch_id: branchId,
        label: "Home",
        address: "House #15, Street 4, DHA Phase 5, Lahore",
        address_key: "home_dha_5",
        use_count: 6,
      },
      { onConflict: "contact_id,branch_id,address_key" }
    );

  // 5. Reset Conversations & Messages for Demo Contact
  const { data: convs } = await supabaseAdmin
    .from("conversations")
    .select("id")
    .eq("contact_id", contact.id);

  if (convs && convs.length > 0) {
    const convIds = convs.map((c) => c.id);
    await supabaseAdmin.from("messages").delete().in("conversation_id", convIds);
    await supabaseAdmin.from("orders").delete().in("conversation_id", convIds);
    await supabaseAdmin.from("conversations").delete().in("id", convIds);
  }

  // Create clean initial demo conversation
  const { data: conversation, error: convErr } = await supabaseAdmin
    .from("conversations")
    .insert({
      contact_id: contact.id,
      branch_id: branchId,
      phone: demoPhone,
      name: "Ahmed Khan",
      mode: "agent",
      has_unread: false,
    })
    .select()
    .single();

  if (convErr || !conversation) {
    throw new Error(`Failed to create demo conversation: ${convErr?.message}`);
  }

  await supabaseAdmin
    .from("conversation_states")
    .upsert(
      {
        conversation_id: conversation.id,
        workflow_step: "idle",
        cart: [],
        preferred_language: "roman_urdu",
      },
      { onConflict: "conversation_id" }
    );

  // 6. Fast Food Menu Items
  const menuItems = [
    { name: "Smash Zinger Combo", price: 890, category: "Gourmet Burgers", description: "Crispy double Zinger patty, melted cheddar, signature sauce + Fries + Drink.", is_available: true },
    { name: "Classic Beef Burger", price: 750, category: "Gourmet Burgers", description: "Juicy beef patty, smoked cheddar, caramelized onions & BBQ mayo.", is_available: true },
    { name: "Grilled Chicken Burger", price: 680, category: "Gourmet Burgers", description: "Flame grilled chicken breast, lettuce, tomato & garlic aioli.", is_available: true },
    { name: "Loaded Cheese Fries", price: 490, category: "Sides & Appetizers", description: "Crispy fries smothered in liquid cheese, jalapeños & crispy bacon bits.", is_available: true },
    { name: "Crispy Chicken Wings (6pcs)", price: 550, category: "Sides & Appetizers", description: "Crispy fried wings tossed in Spicy Buffalo or BBQ sauce.", is_available: true },
    { name: "Club Sandwich Meal", price: 650, category: "Sandwiches & Wraps", description: "Triple layered toasted bread with grilled chicken, egg & cheese + Fries.", is_available: true },
    { name: "Zinger Paratha Roll", price: 380, category: "Sandwiches & Wraps", description: "Crispy Zinger strip wrapped in crispy tandoori paratha with garlic mayo.", is_available: true },
    { name: "Chocolate Shake", price: 350, category: "Beverages & Shakes", description: "Thick creamy Belgian chocolate milkshake topped with whipped cream.", is_available: true },
    { name: "Soft Drink 500ml", price: 120, category: "Beverages & Shakes", description: "Chilled Coca-Cola / Sprite / Fanta 500ml.", is_available: true },
    { name: "Molten Lava Cake", price: 420, category: "Desserts", description: "Warm chocolate cake with gooey molten center served with vanilla ice cream.", is_available: true },
  ];

  for (const item of menuItems) {
    const { data: existingItem } = await supabaseAdmin
      .from("menu_items")
      .select("id")
      .eq("branch_id", branchId)
      .eq("name", item.name)
      .maybeSingle();

    if (!existingItem) {
      await supabaseAdmin.from("menu_items").insert({
        ...item,
        branch_id: branchId,
      });
    }
  }

  // 7. Seed 45 Historical & Active Orders for Analytics & Overview
  console.log("📊 Seeding historical orders for analytics charts...");
  const orderStatuses = ["delivered", "delivered", "delivered", "delivered", "preparing", "received", "cancelled"];
  const orderTypes: Array<"delivery" | "pickup" | "dine-in"> = ["delivery", "delivery", "pickup", "dine-in"];
  const names = ["Zaid Ali", "Fatima Noor", "Usman Sheikh", "Sana Malik", "Hamza Bilal", "Ayesha Khan", "Omer Farooq", "Zainab Shah"];

  const now = Date.now();
  for (let i = 0; i < 40; i++) {
    const daysAgo = Math.floor(Math.random() * 28);
    const hoursAgo = Math.floor(Math.random() * 12);
    const createdAt = new Date(now - (daysAgo * 86400000 + hoursAgo * 3600000)).toISOString();
    const status = i < 3 ? (i === 0 ? "received" : i === 1 ? "preparing" : "out_for_delivery") : orderStatuses[i % orderStatuses.length];
    const type = orderTypes[i % orderTypes.length];
    const customerName = names[i % names.length];
    const phone = `+92321${1000000 + i}`;

    // Create dummy contact & conversation for each historical order
    const { data: histContact } = await supabaseAdmin
      .from("contacts")
      .upsert({ phone, name: customerName, active_branch_id: branchId }, { onConflict: "phone" })
      .select()
      .single();

    if (histContact) {
      const { data: histConv } = await supabaseAdmin
        .from("conversations")
        .insert({
          contact_id: histContact.id,
          branch_id: branchId,
          phone,
          name: customerName,
          mode: "agent",
          has_unread: i === 0,
          updated_at: createdAt,
          created_at: createdAt,
        })
        .select()
        .single();

      if (histConv) {
        const item1 = menuItems[i % menuItems.length];
        const item2 = menuItems[(i + 3) % menuItems.length];
        const subtotal = item1.price + item2.price;
        const deliveryFee = type === "delivery" ? 150 : 0;

        const { data: createdOrder } = await supabaseAdmin
          .from("orders")
          .insert({
            branch_id: branchId,
            conversation_id: histConv.id,
            type,
            status,
            subtotal,
            delivery_fee: deliveryFee,
            address: type === "delivery" ? `House #${i + 1}, Street ${i % 10 + 1}, DHA, Lahore` : null,
            created_at: createdAt,
            updated_at: createdAt,
          })
          .select()
          .single();

        if (createdOrder) {
          await supabaseAdmin.from("order_items").insert([
            { order_id: createdOrder.id, name: item1.name, qty: 1, price: item1.price },
            { order_id: createdOrder.id, name: item2.name, qty: 1, price: item2.price },
          ]);
        }
      }
    }
  }

  // 8. Demo Admin User
  const demoEmail = process.env.DEMO_USER_EMAIL || "demo_admin@tandoori.pk";
  const demoPassword = process.env.DEMO_USER_PASSWORD || "DemoAdmin123!";

  const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
  const existingUser = usersData.users.find((u) => u.email === demoEmail);

  let userId: string;
  if (existingUser) {
    userId = existingUser.id;
    await supabaseAdmin.auth.admin.updateUserById(userId, { password: demoPassword });
  } else {
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: demoEmail,
      password: demoPassword,
      email_confirm: true,
      user_metadata: { full_name: "Demo Admin" },
    });
    if (createErr || !created.user) {
      throw new Error(`Failed to create demo admin user: ${createErr?.message}`);
    }
    userId = created.user.id;
  }

  await supabaseAdmin.from("staff_profiles").upsert(
    {
      user_id: userId,
      full_name: "Demo Admin",
      role: "admin",
      default_branch_id: branchId,
    },
    { onConflict: "user_id" }
  );

  console.log("✅ [DEMO SEED] Generic fast-food demo data seeding completed!");
  return { branchId, conversationId: conversation.id, demoPhone, demoEmail };
}

if (process.argv[1] && DEMO_SEED_SCRIPT_PATTERN.test(process.argv[1])) {
  seedDemoData()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
