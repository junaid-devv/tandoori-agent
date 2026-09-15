import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabaseUrl = "https://ohghccpgpzszmajridmn.supabase.co";
const supabaseServiceKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9oZ2hjY3BncHpzem1hanJpZG1uIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4OTQ3NDQxNCwiZXhwIjoyMTA1MDUwNDE0fQ.NEpBfe81Nhy6KjwtaZxSqrfZlsDIutmkYNATetHIO2s";

const sb = createClient(supabaseUrl, supabaseServiceKey);

const embeddingApiKey = "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";
const embeddingBaseUrl = "https://router.huggingface.co/deepinfra/v1/openai";
const embeddingModel = "Qwen/Qwen3-Embedding-8B";
const embeddingDimensions = 1536;

const openai = new OpenAI({
  apiKey: embeddingApiKey,
  baseURL: embeddingBaseUrl,
});

async function run() {
  console.log("=== Seeding Cheezo Bites Menu & Vector Embeddings ===");

  // 1. Load Cheezo Bites Menu
  const menuPath = path.resolve(__dirname, "../cheezo-bites-menu.json");
  const menuData = JSON.parse(fs.readFileSync(menuPath, "utf-8"));
  console.log(`Loaded ${menuData.items.length} menu items across ${menuData.categories.length} categories.`);

  // 2. Fetch Cheezo Bites Branch
  const { data: branch, error: bError } = await sb
    .from("branches")
    .select("id, name")
    .eq("slug", "cheezo-bites-main")
    .single();

  if (bError || !branch) {
    throw new Error("Could not find Cheezo Bites main branch: " + (bError?.message || "Not found"));
  }
  const branchId = branch.id;
  console.log(`Target branch: ${branch.name} (${branchId})`);

  // 3. Update Contact & Profile Phone Numbers
  const clientPhone = "+923175437133";
  await sb.from("restaurant_profiles").update({
    support_phone: clientPhone,
    delivery_phone: clientPhone,
    dine_in_phone: clientPhone,
    updated_at: new Date().toISOString(),
  }).eq("id", "default");

  await sb.from("restaurant_settings").upsert({
    branch_id: branchId,
    is_accepting_orders: true,
    opening_time: "11:00 AM",
    closing_time: "02:00 AM",
    min_delivery_amount: 0,
    delivery_enabled: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: "branch_id" });

  console.log("Updated restaurant profile and branch settings with phone:", clientPhone);

  // 4. Clear existing items and embeddings for this branch
  console.log("Clearing previous menu items & embeddings...");
  await sb.from("menu_item_embeddings").delete().eq("branch_id", branchId);
  await sb.from("menu_items").delete().eq("branch_id", branchId);

  // 5. Insert Menu Items
  console.log("Inserting menu items...");
  const itemsPayload = menuData.items.map((item, idx) => ({
    branch_id: branchId,
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
    throw new Error("Error inserting menu items: " + itemsError.message);
  }
  console.log(`✅ Successfully inserted ${insertedItems.length} menu items.`);

  // 6. Generate Embeddings and Insert
  console.log(`\nGenerating embeddings with ${embeddingModel} (dimensions: ${embeddingDimensions})...`);
  const BATCH_SIZE = 10;
  let embeddedCount = 0;

  for (let i = 0; i < insertedItems.length; i += BATCH_SIZE) {
    const chunk = insertedItems.slice(i, i + BATCH_SIZE);
    const sources = chunk.map((item) =>
      [item.name, item.category, item.description].filter(Boolean).join(" | ")
    );

    const resp = await openai.embeddings.create({
      model: embeddingModel,
      input: sources,
      dimensions: embeddingDimensions,
    });

    const embeddingRows = chunk.map((item, cIdx) => {
      const vector = resp.data[cIdx].embedding;
      return {
        menu_item_id: item.id,
        branch_id: branchId,
        embedding: `[${vector.join(",")}]`,
        embedding_model: embeddingModel,
        embedding_source: sources[cIdx],
      };
    });

    const { error: embError } = await sb.from("menu_item_embeddings").insert(embeddingRows);
    if (embError) {
      throw new Error("Error inserting embeddings: " + embError.message);
    }
    embeddedCount += chunk.length;
    console.log(`✅ Embedded & saved ${embeddedCount}/${insertedItems.length} items.`);
  }

  // 7. Verify via Semantic RPC Match Query
  console.log("\n--- Verifying Semantic Search Query ---");
  const testQuery = "spicy beef burger with cheese";
  const queryResp = await openai.embeddings.create({
    model: embeddingModel,
    input: [testQuery],
    dimensions: embeddingDimensions,
  });
  const queryVector = `[${queryResp.data[0].embedding.join(",")}]`;

  const { data: matches, error: rpcError } = await sb.rpc("match_menu_items_by_embedding", {
    branch_uuid: branchId,
    query_embedding: queryVector,
    match_count: 3,
    similarity_threshold: 0.3,
  });

  if (rpcError) {
    console.warn("RPC query notice:", rpcError.message);
  } else {
    console.log(`Test query: "${testQuery}"`);
    console.log("Top semantic matches:");
    matches.forEach((m, idx) => {
      console.log(`  ${idx + 1}. ${m.name} (${m.category}) - Rs. ${m.price} [similarity: ${(m.similarity * 100).toFixed(1)}%]`);
    });
  }

  console.log("\n🎉 Cheezo Bites Menu & Vector Embeddings Seeding Complete!");
}

run().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
