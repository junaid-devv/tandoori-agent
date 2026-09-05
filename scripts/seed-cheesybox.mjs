import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read .env.local
const envPath = path.resolve(__dirname, "../.env.local");
const envContent = fs.readFileSync(envPath, "utf-8");
const env = {};
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx !== -1) {
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
}

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || "https://msjgqesrnnxrjbhijmlq.supabase.co";
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseKey) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(supabaseUrl, supabaseKey);

const embeddingApiKey = env.MENU_EMBEDDING_API_KEY || env.HUGGINGFACE_API_KEY;
const embeddingBaseUrl = env.MENU_EMBEDDING_BASE_URL || "https://router.huggingface.co/deepinfra/v1/openai";
const embeddingModel = env.MENU_EMBEDDING_MODEL || "Qwen/Qwen3-Embedding-8B";
const embeddingDimensions = Number(env.MENU_EMBEDDING_DIMENSIONS) || 1536;

const openai = new OpenAI({
  apiKey: embeddingApiKey,
  baseURL: embeddingBaseUrl,
});

async function run() {
  console.log("=== Starting Cheesy Box Seeding & Migration ===");

  // 1. Load Cheesy Box Menu JSON
  const menuPath = path.resolve(__dirname, "../cheesybox-menu.json");
  const menuData = JSON.parse(fs.readFileSync(menuPath, "utf-8"));
  console.log(`Loaded ${menuData.items.length} menu items and ${menuData.categories.length} categories.`);

  // 2. Configure Branches
  console.log("Configuring branches...");
  let wahBranchId = "92de8ae3-eac0-4b31-8e13-a1c3557c7c5c";
  const { data: existingWah } = await sb.from("branches").select("id").eq("id", wahBranchId).maybeSingle();

  if (existingWah) {
    const { error } = await sb
      .from("branches")
      .update({
        name: "Cheesy Box — Wah Branch",
        slug: "cheesybox-wah",
        city: "Wah Cantt",
        address: "Wah Cantt (Dine In, Take Away & Delivery)",
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", wahBranchId);
    if (error) console.error("Error updating Wah branch:", error);
    else console.log("Updated Wah branch:", wahBranchId);
  } else {
    const { data: insertedWah, error } = await sb
      .from("branches")
      .insert({
        id: wahBranchId,
        name: "Cheesy Box — Wah Branch",
        slug: "cheesybox-wah",
        city: "Wah Cantt",
        address: "Wah Cantt (Dine In, Take Away & Delivery)",
        is_active: true,
      })
      .select("id")
      .single();
    if (error) throw error;
    wahBranchId = insertedWah.id;
    console.log("Inserted Wah branch:", wahBranchId);
  }

  // Rawalpindi Branch
  let pindiBranchId;
  const { data: existingPindi } = await sb.from("branches").select("id").eq("slug", "cheesybox-rawalpindi").maybeSingle();
  if (existingPindi) {
    pindiBranchId = existingPindi.id;
    await sb
      .from("branches")
      .update({
        name: "Cheesy Box — Rawalpindi Branch",
        city: "Rawalpindi",
        address: "Rawalpindi (Dine In, Take Away & Delivery)",
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", pindiBranchId);
    console.log("Updated Rawalpindi branch:", pindiBranchId);
  } else {
    const { data: insertedPindi, error } = await sb
      .from("branches")
      .insert({
        name: "Cheesy Box — Rawalpindi Branch",
        slug: "cheesybox-rawalpindi",
        city: "Rawalpindi",
        address: "Rawalpindi (Dine In, Take Away & Delivery)",
        is_active: true,
      })
      .select("id")
      .single();
    if (error) throw error;
    pindiBranchId = insertedPindi.id;
    console.log("Inserted Rawalpindi branch:", pindiBranchId);
  }

  // 3. Update Restaurant Profile
  console.log("Updating restaurant profile...");
  const { error: profError } = await sb.from("restaurant_profiles").upsert({
    id: "default",
    app_name: "Cheesy Box",
    dashboard_title: "Cheesy Box Management",
    logo_url: "/cheesybox-logo.png",
    brand_color: "#F59E0B",
    brand_hover_color: "#D97706",
    city: "Wah Cantt",
    currency: "Rs.",
    timezone: "Asia/Karachi",
    branch_mode: "multiple",
    default_branch_id: wahBranchId,
    support_phone: "0345 1875536",
    delivery_phone: "0345 1875536",
    dine_in_phone: "0319 5641187",
    ai_personality_default: "Warm & Professional",
    updated_at: new Date().toISOString(),
  });
  if (profError) console.error("Error updating profile:", profError);
  else console.log("Restaurant profile updated to Cheesy Box!");

  // 4. Update Restaurant Settings for both branches
  console.log("Updating branch settings...");
  const branchSettings = [
    {
      branch_id: wahBranchId,
      city: "Wah Cantt",
      phone_delivery: "0345 1875536",
      phone_dine_in: "0345 1875536",
      is_accepting_orders: true,
      delivery_enabled: true,
      opening_time: "11:00 AM",
      closing_time: "02:00 AM",
      min_delivery_amount: 500,
      delivery_fee: 0,
      ai_personality: "Warm & Professional",
      estimated_prep_minutes: 25,
      estimated_delivery_minutes: 40,
    },
    {
      branch_id: pindiBranchId,
      city: "Rawalpindi",
      phone_delivery: "0319 5641187",
      phone_dine_in: "0319 5641187",
      is_accepting_orders: true,
      delivery_enabled: true,
      opening_time: "11:00 AM",
      closing_time: "02:00 AM",
      min_delivery_amount: 500,
      delivery_fee: 0,
      ai_personality: "Warm & Professional",
      estimated_prep_minutes: 25,
      estimated_delivery_minutes: 40,
    },
  ];

  for (const s of branchSettings) {
    const { data: existingS } = await sb.from("restaurant_settings").select("id").eq("branch_id", s.branch_id).maybeSingle();
    if (existingS) {
      await sb.from("restaurant_settings").update({ ...s, updated_at: new Date().toISOString() }).eq("branch_id", s.branch_id);
    } else {
      await sb.from("restaurant_settings").insert(s);
    }
  }
  console.log("Branch settings updated for Wah & Rawalpindi branches.");

  // 5. Populate Menu & Embeddings for each branch
  const branchesToSeed = [
    { id: wahBranchId, name: "Wah Branch" },
    { id: pindiBranchId, name: "Rawalpindi Branch" },
  ];

  for (const branch of branchesToSeed) {
    console.log(`\n--- Seeding menu for ${branch.name} (${branch.id}) ---`);

    // Clean old data for this branch
    await sb.from("menu_item_embeddings").delete().eq("branch_id", branch.id);
    await sb.from("menu_items").delete().eq("branch_id", branch.id);
    await sb.from("menu_categories").delete().eq("branch_id", branch.id);

    // Insert categories
    const categoriesPayload = menuData.categories.map((c) => ({
      branch_id: branch.id,
      name: c.name,
      sort_order: c.sort_order,
    }));
    const { error: catError } = await sb.from("menu_categories").insert(categoriesPayload);
    if (catError) console.error("Error inserting categories:", catError);
    else console.log(`Inserted ${categoriesPayload.length} categories.`);

    // Insert items
    const itemsPayload = menuData.items.map((item, idx) => ({
      branch_id: branch.id,
      name: item.name,
      price: item.price,
      category: item.category,
      description: item.description,
      is_available: true,
      sort_order: idx + 1,
    }));

    const { data: insertedItems, error: itemsError } = await sb
      .from("menu_items")
      .insert(itemsPayload)
      .select("id, name, category, description, price");

    if (itemsError) {
      console.error("Error inserting items:", itemsError);
      continue;
    }
    console.log(`Inserted ${insertedItems.length} menu items.`);

    // Generate and insert vector embeddings
    console.log(`Generating embeddings for ${insertedItems.length} items...`);
    const BATCH_SIZE = 15;
    let embeddedCount = 0;

    for (let i = 0; i < insertedItems.length; i += BATCH_SIZE) {
      const chunk = insertedItems.slice(i, i + BATCH_SIZE);
      const sources = chunk.map((item) =>
        [item.name, item.category, item.description].filter(Boolean).join(" | ")
      );

      try {
        const resp = await openai.embeddings.create({
          model: embeddingModel,
          input: sources,
          dimensions: embeddingDimensions,
        });

        const embeddingRows = chunk.map((item, cIdx) => {
          const vector = resp.data[cIdx].embedding;
          return {
            menu_item_id: item.id,
            branch_id: branch.id,
            embedding: `[${vector.join(",")}]`,
            embedding_model: embeddingModel,
            embedding_source: sources[cIdx],
          };
        });

        const { error: embError } = await sb.from("menu_item_embeddings").insert(embeddingRows);
        if (embError) {
          console.error("Error inserting embedding batch:", embError);
        } else {
          embeddedCount += chunk.length;
          console.log(`Embedded ${embeddedCount}/${insertedItems.length} items...`);
        }
      } catch (embGenError) {
        console.error("Embedding API error for chunk:", embGenError.message);
      }
    }
  }

  console.log("\n=== Cheesy Box Menu & Branding Seeding Complete! ===");
}

run().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
