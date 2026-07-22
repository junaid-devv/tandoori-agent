import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error("❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.");
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, serviceKey);

export async function seedDemoData() {
  console.log("🌱 [DEMO SEED] Starting deterministic demo data seeding...");

  // 1. Ensure Demo Branch exists
  const branchSlug = "tandoori-islamabad";
  let { data: branch, error: branchErr } = await supabaseAdmin
    .from("branches")
    .select("*")
    .eq("slug", branchSlug)
    .maybeSingle();

  if (!branch) {
    const { data: newBranch, error: createBranchErr } = await supabaseAdmin
      .from("branches")
      .insert({
        slug: branchSlug,
        name: "Tandoori Hub - Flagship Branch",
        address: "Sector F-6/2, Islamabad",
        is_active: true,
      })
      .select()
      .single();

    if (createBranchErr || !newBranch) {
      throw new Error(`Failed to create demo branch: ${createBranchErr?.message}`);
    }
    branch = newBranch;
  }

  const branchId = branch.id;

  // 2. Ensure Restaurant Settings for Demo Branch
  await supabaseAdmin
    .from("restaurant_settings")
    .upsert(
      {
        branch_id: branchId,
        is_accepting_orders: true,
        opening_time: "11:00 AM",
        closing_time: "11:30 PM",
        delivery_enabled: true,
        delivery_fee: 150,
        min_delivery_amount: 500,
        city: "Islamabad",
        phone_delivery: "051-8899112",
        phone_dine_in: "051-8899113",
        ai_personality: "Warm & Professional",
        delivery_areas: ["F-6", "F-7", "F-8", "G-6", "G-7", "E-7", "Blue Area"],
      },
      { onConflict: "branch_id" }
    );

  // 3. Ensure Demo Contact ("Tariq Mahmood")
  const demoPhone = "+923001234567";
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
        name: "Tariq Mahmood",
        active_branch_id: branchId,
        preferred_language: "english",
        tags: ["VIP", "Regular", "Family Orders"],
        notes: "Prefers mild spice level in Karahi. Prompt delivery to F-6/2.",
        total_orders: 5,
        last_order_at: new Date(Date.now() - 86400000 * 3).toISOString(),
      })
      .select()
      .single();

    if (createContactErr || !newContact) {
      throw new Error(`Failed to create demo contact: ${createContactErr?.message}`);
    }
    contact = newContact;
  } else {
    // Update contact details
    await supabaseAdmin
      .from("contacts")
      .update({
        name: "Tariq Mahmood",
        active_branch_id: branchId,
        tags: ["VIP", "Regular", "Family Orders"],
        notes: "Prefers mild spice level in Karahi. Prompt delivery to F-6/2.",
      })
      .eq("id", contact.id);
  }

  // 4. Ensure Demo Customer Address
  await supabaseAdmin
    .from("customer_addresses")
    .upsert(
      {
        contact_id: contact.id,
        branch_id: branchId,
        label: "Home",
        address: "House #42, Street 7, Sector F-6/2, Islamabad",
        address_key: "home_f6_2",
        use_count: 4,
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
      name: "Tariq Mahmood",
      mode: "agent",
      has_unread: false,
    })
    .select()
    .single();

  if (convErr || !conversation) {
    throw new Error(`Failed to create demo conversation: ${convErr?.message}`);
  }

  // Initial conversation state
  await supabaseAdmin
    .from("conversation_states")
    .upsert(
      {
        conversation_id: conversation.id,
        workflow_step: "idle",
        cart: [],
        preferred_language: "english",
      },
      { onConflict: "conversation_id" }
    );

  // 6. Ensure Demo Menu Items exist for Demo Branch
  const menuItems = [
    { name: "Peshawari Chicken Karahi", price: 2400, category: "Karahi Specialties", description: "Fresh chicken cooked in traditional Peshawari style with fresh tomatoes and ginger.", is_available: true },
    { name: "Mutton Shinwari Karahi", price: 3400, category: "Karahi Specialties", description: "Tender mutton cooked in pure desi ghee with green chillies.", is_available: true },
    { name: "Roghani Naan", price: 80, category: "Tandoor & Breads", description: "Soft tandoori naan glazed with sesame seeds and butter.", is_available: true },
    { name: "Garlic Naan", price: 100, category: "Tandoor & Breads", description: "Freshly baked naan topped with crushed garlic and cilantro.", is_available: true },
    { name: "Mint Raita", price: 180, category: "Sides & Beverages", description: "Chilled yogurt mixed with fresh mint, coriander, and spices.", is_available: true },
    { name: "Coke 1.5L", price: 200, category: "Sides & Beverages", description: "Chilled 1.5 Liter Coca-Cola bottle.", is_available: true },
    { name: "Shahi Kheer", price: 350, category: "Desserts", description: "Traditional rice pudding infused with saffron and pistachios.", is_available: true },
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

  // 7. Ensure Demo Admin User exists for login
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

  // Upsert staff profile
  await supabaseAdmin.from("staff_profiles").upsert(
    {
      user_id: userId,
      full_name: "Demo Admin",
      role: "admin",
      default_branch_id: branchId,
    },
    { onConflict: "user_id" }
  );

  console.log("✅ [DEMO SEED] Demo data seeding completed successfully!");
  return { branchId, conversationId: conversation.id, demoPhone, demoEmail };
}

seedDemoData()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
