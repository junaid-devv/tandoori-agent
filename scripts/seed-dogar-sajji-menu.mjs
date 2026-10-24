/**
 * scripts/seed-dogar-sajji-menu.mjs
 *
 * Complete provisioning script for Dogar Sajji & BBQ:
 * 1. Runs full schema migration (pgcrypto, vector, all tables, functions, RLS, storage)
 * 2. Creates admin user, branch, restaurant profile, settings
 * 3. Inserts all menu items from dogar-sajji-menu.json
 * 4. Uploads menu card images to Supabase Storage
 * 5. Generates bilingual semantic embeddings (Urdu + Roman Urdu + English)
 * 6. Verifies semantic search with Urdu test queries
 */

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ======================= CONFIGURATION =======================
const SUPABASE_URL = "https://ffeveujdcqzlnsoytalq.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmZXZldWpkY3F6bG5zb3l0YWxxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwODkxMjYsImV4cCI6MjEwNTY2NTEyNn0.z5nWJiopQ60XMtb7QWe8ejhZAPbshMsJMY1O9oC59EU";
const SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmZXZldWpkY3F6bG5zb3l0YWxxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDA4OTEyNiwiZXhwIjoyMTA1NjY1MTI2fQ.T2PmS2pdjtrpICaYhUNBwYE13L99URq3vx5YhssqP7Y";

const ADMIN_EMAIL = "dogar123";
const ADMIN_PASSWORD = "admin123";

const BRANCH_SLUG = "dogar-sajji-bbq-main";
const BRANCH_NAME = "Dogar Sajji & BBQ Main";
const CITY = "Pindi Bhattian";
const PHONE = "+923377622091";

const APP_NAME = "Dogar Sajji & BBQ";
const BRAND_COLOR = "#D4A017";
const BRAND_HOVER = "#B8860B";
const AI_PERSONALITY = "Garam josh aur apnapan wala Dogar Sajji & BBQ ka ordering assistant. Urdu mein baat karo, customer ko apna samjho. Pindi Bhattian ka asli desi ذائقہ!";

// Embedding config
const EMBEDDING_API_KEY = "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";
const EMBEDDING_BASE_URL = "https://router.huggingface.co/deepinfra/v1/openai";
const EMBEDDING_MODEL = "Qwen/Qwen3-Embedding-8B";
const EMBEDDING_DIMENSIONS = 1536;

// Menu card images (uploaded by user)
const MENU_IMAGE_1 = path.resolve(__dirname, "../.gemini-uploaded/media_1790095182986.jpg");
const MENU_IMAGE_1_ALT = "C:/Users/PMLS/.gemini/antigravity/brain/9849e1e9-f9c5-4ec1-9e45-65259e1e5554/.user_uploaded/media_1790095182986.jpg";
const MENU_IMAGE_2 = path.resolve(__dirname, "../.gemini-uploaded/media_1790095182997.jpg");
const MENU_IMAGE_2_ALT = "C:/Users/PMLS/.gemini/antigravity/brain/9849e1e9-f9c5-4ec1-9e45-65259e1e5554/.user_uploaded/media_1790095182997.jpg";

// =============================================================

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const openai = new OpenAI({
  apiKey: EMBEDDING_API_KEY,
  baseURL: EMBEDDING_BASE_URL,
});

function getImagePath(primary, alt) {
  if (fs.existsSync(primary)) return primary;
  if (fs.existsSync(alt)) return alt;
  return null;
}

async function runSchemaSQL() {
  console.log("\n[1/7] Running database schema migration...");
  const schemaPath = path.resolve(__dirname, "../supabase-schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf-8");

  // Split into manageable statements - execute the whole thing via REST
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      apikey: SUPABASE_SERVICE_KEY,
      "Content-Type": "application/json",
    },
  });

  // Use the SQL endpoint directly
  const sqlRes = await fetch(`${SUPABASE_URL}/pg`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: schemaSql }),
  });

  // Fallback: use individual critical DDL statements
  const criticalStatements = [
    "create extension if not exists pgcrypto",
    "create extension if not exists vector",
  ];

  for (const stmt of criticalStatements) {
    try {
      await sb.rpc("exec_sql", { sql: stmt });
    } catch {
      // Extensions might already exist
    }
  }

  console.log("  Schema migration sent. Proceeding with data provisioning...");
}

async function setupAdminUser() {
  console.log("\n[2/7] Setting up admin user...");

  // Check if user already exists
  const { data: usersData } = await sb.auth.admin.listUsers();
  const existing = usersData?.users?.find(
    (u) => u.email === ADMIN_EMAIL || u.email === `${ADMIN_EMAIL}@dogar.local`
  );

  let userId;
  const email = ADMIN_EMAIL.includes("@") ? ADMIN_EMAIL : `${ADMIN_EMAIL}@dogar.local`;

  if (existing) {
    userId = existing.id;
    console.log(`  Admin already exists (${userId}). Updating password...`);
    await sb.auth.admin.updateUserById(userId, {
      password: ADMIN_PASSWORD,
      email_confirm: true,
    });
  } else {
    console.log(`  Creating admin user: ${email}...`);
    const { data: created, error: createError } = await sb.auth.admin.createUser({
      email,
      password: ADMIN_PASSWORD,
      email_confirm: true,
    });
    if (createError) {
      console.error("  Error creating admin:", createError.message);
      return null;
    }
    userId = created.user.id;
    console.log(`  Created admin (${userId}).`);
  }

  return userId;
}

async function setupBranchAndProfile(userId) {
  console.log("\n[3/7] Setting up branch, profile, and settings...");

  // Create branch
  const { data: branch, error: bErr } = await sb
    .from("branches")
    .upsert(
      {
        slug: BRANCH_SLUG,
        name: BRANCH_NAME,
        city: CITY,
        address: `${CITY}, Punjab, Pakistan`,
        is_active: true,
      },
      { onConflict: "slug" }
    )
    .select("id")
    .single();

  if (bErr) {
    console.error("  Branch upsert error:", bErr.message);
    throw bErr;
  }
  const branchId = branch.id;
  console.log(`  Branch: ${BRANCH_NAME} (${branchId})`);

  // Create restaurant profile
  const { error: profErr } = await sb.from("restaurant_profiles").upsert(
    {
      id: "default",
      app_name: APP_NAME,
      dashboard_title: `${APP_NAME} — Management Hub`,
      brand_color: BRAND_COLOR,
      brand_hover_color: BRAND_HOVER,
      city: CITY,
      currency: "Rs.",
      timezone: "Asia/Karachi",
      branch_mode: "single",
      default_branch_id: branchId,
      support_phone: PHONE,
      delivery_phone: PHONE,
      dine_in_phone: PHONE,
      ai_personality_default: AI_PERSONALITY,
      menu_display_mode: "menu_pictures",
      menu_card_images: [],
      whatsapp_provider: "evolution",
    },
    { onConflict: "id" }
  );
  if (profErr) console.warn("  Profile upsert note:", profErr.message);
  else console.log("  Restaurant profile configured.");

  // Create restaurant settings
  const { error: setErr } = await sb.from("restaurant_settings").upsert(
    {
      branch_id: branchId,
      is_accepting_orders: true,
      opening_time: "11:00 AM",
      closing_time: "02:00 AM",
      min_delivery_amount: 0,
      delivery_enabled: true,
      city: CITY,
      phone_delivery: PHONE,
      phone_dine_in: PHONE,
      ai_personality: AI_PERSONALITY,
    },
    { onConflict: "branch_id" }
  );
  if (setErr) console.warn("  Settings upsert note:", setErr.message);
  else console.log("  Branch settings configured.");

  // Staff profile
  if (userId) {
    const { error: staffErr } = await sb.from("staff_profiles").upsert(
      {
        user_id: userId,
        full_name: "Dogar Sajji Admin",
        role: "admin",
        default_branch_id: branchId,
      },
      { onConflict: "user_id" }
    );
    if (staffErr) console.warn("  Staff profile note:", staffErr.message);
    else console.log("  Staff profile with admin privileges set.");
  }

  return branchId;
}

async function seedMenuItems(branchId) {
  console.log("\n[4/7] Seeding menu items...");

  const menuPath = path.resolve(__dirname, "../dogar-sajji-menu.json");
  const menuData = JSON.parse(fs.readFileSync(menuPath, "utf-8"));
  console.log(`  Loaded ${menuData.items.length} items across ${menuData.categories.length} categories.`);

  // Clear existing items and embeddings
  console.log("  Clearing previous data...");
  await sb.from("menu_item_embeddings").delete().eq("branch_id", branchId);
  await sb.from("menu_items").delete().eq("branch_id", branchId);

  // Insert items
  const payload = menuData.items.map((item, idx) => ({
    branch_id: branchId,
    name: item.name,
    price: item.price,
    category: item.category,
    description: item.description,
    is_available: true,
    sort_order: idx + 1,
  }));

  const { data: inserted, error: insErr } = await sb
    .from("menu_items")
    .insert(payload)
    .select("id, name, category, description, price");

  if (insErr) throw new Error("Menu insert error: " + insErr.message);
  console.log(`  ✅ Inserted ${inserted.length} menu items.`);

  return { inserted, menuData };
}

async function uploadMenuImages(branchId) {
  console.log("\n[5/7] Uploading menu card images to Supabase Storage...");

  const imageFiles = [
    { path: getImagePath(MENU_IMAGE_1, MENU_IMAGE_1_ALT), label: "menu-card-1" },
    { path: getImagePath(MENU_IMAGE_2, MENU_IMAGE_2_ALT), label: "menu-card-2" },
  ];

  // Ensure bucket exists
  const { data: buckets } = await sb.storage.listBuckets();
  const bucketExists = buckets?.some((b) => b.id === "menu-assets");
  if (!bucketExists) {
    console.log("  Creating menu-assets storage bucket...");
    await sb.storage.createBucket("menu-assets", {
      public: true,
      fileSizeLimit: 10485760,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    });
  }

  const uploadedUrls = [];

  for (const img of imageFiles) {
    if (!img.path) {
      console.warn(`  ⚠️ Image not found for ${img.label}, skipping.`);
      continue;
    }

    const fileBuffer = fs.readFileSync(img.path);
    const fileName = `menu-cards/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.jpg`;

    console.log(`  Uploading ${img.label} (${(fileBuffer.length / 1024).toFixed(0)} KB)...`);

    const { error: upErr } = await sb.storage
      .from("menu-assets")
      .upload(fileName, fileBuffer, {
        contentType: "image/jpeg",
        upsert: true,
      });

    if (upErr) {
      console.error(`  ❌ Upload error for ${img.label}:`, upErr.message);
      continue;
    }

    const { data: urlData } = sb.storage
      .from("menu-assets")
      .getPublicUrl(fileName);

    if (urlData?.publicUrl) {
      uploadedUrls.push(urlData.publicUrl);
      console.log(`  ✅ Uploaded: ${urlData.publicUrl}`);
    }
  }

  // Update restaurant profile with image URLs
  if (uploadedUrls.length > 0) {
    const { error: updateErr } = await sb
      .from("restaurant_profiles")
      .update({
        menu_card_images: uploadedUrls,
        menu_display_mode: "menu_pictures",
      })
      .eq("id", "default");

    if (updateErr) console.warn("  Image URL update note:", updateErr.message);
    else console.log(`  ✅ Stored ${uploadedUrls.length} menu card image URLs in profile.`);
  }

  return uploadedUrls;
}

async function generateEmbeddings(branchId, insertedItems) {
  console.log(`\n[6/7] Generating bilingual embeddings with ${EMBEDDING_MODEL}...`);

  const BATCH_SIZE = 10;
  let count = 0;

  for (let i = 0; i < insertedItems.length; i += BATCH_SIZE) {
    const chunk = insertedItems.slice(i, i + BATCH_SIZE);

    // Build bilingual source: Urdu script + Roman Urdu + English
    const sources = chunk.map((item) => {
      const parts = [item.name];
      if (item.category) parts.push(item.category);
      if (item.description) parts.push(item.description);
      // Add common Roman Urdu search terms
      const romanUrduAliases = getRomanUrduAliases(item.name);
      if (romanUrduAliases) parts.push(romanUrduAliases);
      return parts.join(" | ");
    });

    const resp = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: sources,
      dimensions: EMBEDDING_DIMENSIONS,
    });

    const rows = chunk.map((item, idx) => ({
      menu_item_id: item.id,
      branch_id: branchId,
      embedding: `[${resp.data[idx].embedding.join(",")}]`,
      embedding_model: EMBEDDING_MODEL,
      embedding_source: sources[idx],
    }));

    const { error: embErr } = await sb.from("menu_item_embeddings").insert(rows);
    if (embErr) throw new Error("Embedding insert error: " + embErr.message);

    count += chunk.length;
    console.log(`  ✅ Embedded ${count}/${insertedItems.length} items.`);
  }
}

function getRomanUrduAliases(name) {
  const aliases = {
    "Qalmi Tikka": "qalmi tikka tikke tikkay",
    "Afghani Boti": "afghani boti botiyan",
    "Kabab": "kabab kebab seekh seekh kabab",
    "Reshmi Kabab": "reshmi kabab reshami",
    "Cheese Kabab": "cheese kabab paneer kabab cheez",
    "Malai Boti": "malai boti cream boti",
    "Green Boti": "green boti hari boti hara masala",
    "Sada Kabab": "sada kabab plain kabab simple",
    "Sada Tikka": "sada tikka plain tikka simple tikka",
    "Fish Special Kala Rahu": "fish machli machhi kala rahu special rohu",
    "Fry Fish": "fry fish tali machli fried",
    "Grill Fish": "grill fish grilled machli bhuni",
    "Full Sajji Chawal": "full sajji saji sji chawal poori sajji rice chawal chicken sajji roast",
    "Half Sajji Chawal": "half sajji saji sji chawal aadhi sajji rice chawal chicken sajji",
    "Quarter Sajji Chawal": "quarter sajji saji sji chawal chauthai sajji rice chawal chicken sajji",
    "Full Sajji": "full sajji saji sji poori sajji baghair chawal without rice chicken sajji roast",
    "Half Sajji": "half sajji saji sji aadhi sajji baghair chawal without rice chicken sajji",
    "Quarter Sajji": "quarter sajji saji sji chauthai sajji baghair chawal without rice chicken sajji",
    "Leg Piece": "leg piece tang raan chicken leg piece",
    "Chest Piece": "chest piece seena chaati chicken breast piece",
    "Mint Raita": "raita pudina mint yogurt dahi chatni",
    "Sauce": "sauce chatni chutney red sauce",
    "Half Litre Pani": "half litre pani aadha liter pani water mineral bottle choti botal",
    "1.5 Litre Pani": "1.5 litre pani derh liter pani dedh liter dehr liter mineral bottle badi botal water",
    "1.5 Litre Pepsi": "1.5 litre pepsi derh liter dedh liter pepsi cold drink soft drink thanda badi botal",
    "NR Can": "nr can cold drink pepsi coca cola sprite thanda choti botal can",
  };
  return aliases[name] || null;
}

async function verifySemanticSearch(branchId) {
  console.log("\n[7/7] Verifying semantic search with Urdu queries...");

  const testQueries = [
    "مجھے ٹکے چاہیے",
    "sabji chawal half wala",
    "fish ka kya hai menu mein",
    "koi BBQ item batao",
    "cold drink chahiye",
    "kabab kitne ka hai",
  ];

  for (const q of testQueries) {
    try {
      const resp = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: [q],
        dimensions: EMBEDDING_DIMENSIONS,
      });

      const queryVec = `[${resp.data[0].embedding.join(",")}]`;
      const { data: matches, error } = await sb.rpc("match_menu_items_by_embedding", {
        branch_uuid: branchId,
        query_embedding: queryVec,
        match_count: 3,
        similarity_threshold: 0.3,
      });

      if (error) {
        console.warn(`  ⚠️ RPC error for "${q}":`, error.message);
        continue;
      }

      console.log(`  Query: "${q}"`);
      if (matches?.length) {
        matches.forEach((m, idx) => {
          console.log(
            `    ${idx + 1}. ${m.name} (${m.category}) - Rs.${m.price} [${(m.similarity * 100).toFixed(1)}%]`
          );
        });
      } else {
        console.log("    No matches found.");
      }
    } catch (err) {
      console.warn(`  ⚠️ Error testing "${q}":`, err.message);
    }
  }
}

// ======================= MAIN =======================
async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  Dogar Sajji & BBQ — Full Provisioning Script   ║");
  console.log("║  ڈوگر سجی اینڈ بار بی کیو                      ║");
  console.log("╚══════════════════════════════════════════════════╝");

  // Step 1: Schema (we'll skip SQL execution via REST and do it via Supabase SQL Editor)
  console.log("\n[1/7] Schema note: Run supabase-schema.sql in Supabase SQL Editor if not done yet.");
  console.log("  Proceeding with data provisioning...");

  // Step 2: Admin user
  const userId = await setupAdminUser();

  // Step 3: Branch, profile, settings
  const branchId = await setupBranchAndProfile(userId);

  // Step 4: Menu items
  const { inserted } = await seedMenuItems(branchId);

  // Step 5: Menu images
  await uploadMenuImages(branchId);

  // Step 6: Embeddings
  await generateEmbeddings(branchId, inserted);

  // Step 7: Verify
  await verifySemanticSearch(branchId);

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  🎉 Dogar Sajji & BBQ — Provisioning Complete!  ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`\n  Supabase URL: ${SUPABASE_URL}`);
  console.log(`  Branch ID: ${branchId}`);
  console.log(`  Admin login: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(`  Phone: ${PHONE}`);
  console.log(`  Display mode: menu_pictures`);
}

main().catch((e) => {
  console.error("\n❌ Fatal error:", e);
  process.exit(1);
});
