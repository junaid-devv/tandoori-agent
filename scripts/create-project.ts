/**
 * scripts/create-project.ts
 *
 * Automated Scaffolding CLI for creating fresh white-label restaurant client deployments.
 *
 * Usage:
 *   npx tsx scripts/create-project.ts
 *
 * Or with flags:
 *   npx tsx scripts/create-project.ts \
 *     --name "Burger Hub" \
 *     --slug "burger-hub" \
 *     --city "Islamabad" \
 *     --brand-color "#E53E3E" \
 *     --admin-email "admin@burgerhub.pk" \
 *     --admin-password "BurgerHub2026!" \
 *     --whatsapp-provider "evolution" \
 *     --supabase-url "https://xyz.supabase.co" \
 *     --supabase-anon-key "ey..." \
 *     --supabase-service-key "ey..."
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import readline from "readline";
import { createClient } from "@supabase/supabase-js";

// Vercel default credentials (configurable via env)
const VERCEL_TOKEN = process.env.VERCEL_TOKEN || "vcp_0nnL6eqSHYgfwokdrIaU1qZB1Fr3pDZz8zGOeJQQO50bDPj7wH3c250l";
const VERCEL_TEAM = process.env.VERCEL_TEAM_ID || "junaidxd786s-projects";
const GITHUB_REPO = "junaid-devv/tandoori-agent";

// Shared platform defaults for AI and search
const SHARED_DEFAULTS = {
  GROQ_API_KEY: "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",
  GROQ_AUDIO_TRANSCRIPTION_MODEL: "whisper-large-v3-turbo",
  ORDER_AGENT_NLU_BASE_URL: "https://api.groq.com/openai/v1",
  ORDER_AGENT_NLU_MODEL: "qwen/qwen3.8-27b",
  ORDER_AGENT_NLU_MAX_TOKENS: "256",
  DEEPSEEK_API_KEY: "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",
  GOOGLE_AI_API_KEY: "AIzaSyDsU6GdegXspaB448VwtVbSrMaTKbIxJgg",
  AI_REQUEST_TIMEOUT_MS: "15000",
  MENU_AI_REQUEST_TIMEOUT_MS: "25000",
  MENU_EMBEDDING_API_KEY: "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",
  MENU_EMBEDDING_BASE_URL: "https://router.huggingface.co/deepinfra/v1/openai",
  MENU_EMBEDDING_MODEL: "Qwen/Qwen3-Embedding-8B",
  MENU_EMBEDDING_DIMENSIONS: "1536",
  HUGGINGFACE_API_KEY: "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",
  LOGIN_RATE_LIMIT_ATTEMPTS: "8",
  LOGIN_RATE_LIMIT_WINDOW_SECONDS: "900",
  LOGIN_RATE_LIMIT_BLOCK_SECONDS: "900",
  WHATSAPP_WEBHOOK_RATE_LIMIT_EVENTS: "600",
  WHATSAPP_WEBHOOK_RATE_LIMIT_WINDOW_SECONDS: "60",
  WHATSAPP_WEBHOOK_RATE_LIMIT_BLOCK_SECONDS: "60",
  WEBHOOK_STORE_RAW_BODY: "false",
  WEBHOOK_RETAIN_PROCESSED_PAYLOAD: "false",
  RESTAURANT_BRANCH_MODE: "single",
  RESTAURANT_TIMEZONE: "Asia/Karachi",
};

interface ProjectConfig {
  name: string;
  slug: string;
  city: string;
  brandColor: string;
  brandHoverColor: string;
  adminEmail: string;
  adminPassword: string;
  whatsappProvider: "evolution" | "meta" | "none";
  menuDisplayMode: "interactive_list" | "menu_pictures" | "text_only";
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceKey: string;
  phoneDelivery: string;
}

function parseCliArgs(): Partial<ProjectConfig> {
  const args = process.argv.slice(2);
  const config: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true";
      config[key] = val;
    }
  }

  return {
    name: config.name,
    slug: config.slug,
    city: config.city,
    brandColor: config["brand-color"],
    adminEmail: config["admin-email"],
    adminPassword: config["admin-password"],
    whatsappProvider: config["whatsapp-provider"] as ProjectConfig["whatsappProvider"],
    menuDisplayMode: config["menu-display-mode"] as ProjectConfig["menuDisplayMode"],
    supabaseUrl: config["supabase-url"],
    supabaseAnonKey: config["supabase-anon-key"],
    supabaseServiceKey: config["supabase-service-key"],
    phoneDelivery: config["phone-delivery"],
  };
}

async function prompt(rl: readline.Interface, question: string, defaultVal?: string): Promise<string> {
  const q = defaultVal ? `${question} [${defaultVal}]: ` : `${question}: `;
  return new Promise((resolve) => {
    rl.question(q, (answer) => {
      resolve(answer.trim() || defaultVal || "");
    });
  });
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

async function gatherConfig(): Promise<ProjectConfig> {
  const cli = parseCliArgs();

  // If sufficient flags passed, avoid interactive prompts
  if (cli.name && cli.supabaseUrl && cli.supabaseAnonKey && cli.supabaseServiceKey) {
    const slug = cli.slug || slugify(cli.name);
    return {
      name: cli.name,
      slug,
      city: cli.city || "Islamabad",
      brandColor: cli.brandColor || "#EA580C",
      brandHoverColor: "#C2410C",
      adminEmail: cli.adminEmail || `admin@${slug}.local`,
      adminPassword: cli.adminPassword || crypto.randomBytes(6).toString("hex") + "A1!",
      whatsappProvider: cli.whatsappProvider || "evolution",
      menuDisplayMode: cli.menuDisplayMode || "interactive_list",
      supabaseUrl: cli.supabaseUrl,
      supabaseAnonKey: cli.supabaseAnonKey,
      supabaseServiceKey: cli.supabaseServiceKey,
      phoneDelivery: cli.phoneDelivery || "+923001234567",
    };
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("\n=======================================================");
  console.log("  ORDERiQ - Client Project Scaffolding CLI");
  console.log("=======================================================");

  try {
    const name = cli.name || (await prompt(rl, "1. Restaurant Name", "Burger Hub"));
    const slug = cli.slug || (await prompt(rl, "2. URL Slug", slugify(name)));
    const city = cli.city || (await prompt(rl, "3. City", "Islamabad"));
    const brandColor = cli.brandColor || (await prompt(rl, "4. Brand Color (Hex)", "#EA580C"));
    const adminEmail = cli.adminEmail || (await prompt(rl, "5. Admin Email", `admin@${slug}.local`));
    const adminPassword =
      cli.adminPassword || (await prompt(rl, "6. Admin Password", crypto.randomBytes(6).toString("hex") + "A1!"));
    const whatsappProvider = (cli.whatsappProvider ||
      (await prompt(rl, "7. WhatsApp Provider (evolution | meta | none)", "evolution"))) as ProjectConfig["whatsappProvider"];
    const menuDisplayMode = (cli.menuDisplayMode ||
      (await prompt(
        rl,
        "8. Menu Display Mode (interactive_list | menu_pictures | text_only)",
        "interactive_list",
      ))) as ProjectConfig["menuDisplayMode"];

    console.log("\n--- Supabase Database Credentials ---");
    const supabaseUrl = cli.supabaseUrl || (await prompt(rl, "9. Supabase URL (e.g. https://xxx.supabase.co)"));
    const supabaseAnonKey = cli.supabaseAnonKey || (await prompt(rl, "10. Supabase Anon Key"));
    const supabaseServiceKey = cli.supabaseServiceKey || (await prompt(rl, "11. Supabase Service Role Key"));
    const phoneDelivery = cli.phoneDelivery || (await prompt(rl, "12. Support / Delivery Phone", "+923001234567"));

    return {
      name,
      slug,
      city,
      brandColor,
      brandHoverColor: "#C2410C",
      adminEmail,
      adminPassword,
      whatsappProvider,
      menuDisplayMode,
      supabaseUrl,
      supabaseAnonKey,
      supabaseServiceKey,
      phoneDelivery,
    };
  } finally {
    rl.close();
  }
}

async function setupSupabase(config: ProjectConfig) {
  console.log("\n[1/3] Connecting to Supabase and setting up admin account...");

  const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey, {
    auth: { persistSession: false },
  });

  // 1. Create or get Admin user
  let userId: string | null = null;
  const { data: usersData, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) {
    console.warn("  Warning: could not list existing users:", listError.message);
  }

  const existingUser = usersData?.users.find((u) => u.email === config.adminEmail);
  if (existingUser) {
    userId = existingUser.id;
    console.log(`  Admin user already exists in Supabase Auth (id: ${userId}). Updating password...`);
    await supabase.auth.admin.updateUserById(userId, {
      password: config.adminPassword,
      email_confirm: true,
    });
  } else {
    console.log(`  Creating admin user: ${config.adminEmail}...`);
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email: config.adminEmail,
      password: config.adminPassword,
      email_confirm: true,
    });
    if (createError) {
      console.error("  Error creating admin user:", createError.message);
    } else if (created.user) {
      userId = created.user.id;
      console.log(`  Created admin user (id: ${userId}).`);
    }
  }

  // 2. Initialize default branch
  console.log("  Ensuring default branch exists...");
  const branchSlug = `${config.slug}-main`;
  const { data: branchData, error: branchError } = await supabase
    .from("branches")
    .upsert(
      {
        slug: branchSlug,
        name: `${config.name} Main Branch`,
        city: config.city,
        address: `${config.city}, Pakistan`,
        is_active: true,
      },
      { onConflict: "slug" },
    )
    .select("id")
    .single();

  const branchId = branchData?.id;
  if (branchError) {
    console.warn("  Note on branches table:", branchError.message);
  }

  // 3. Initialize restaurant profile
  console.log("  Configuring restaurant profile in database...");
  const { error: profileError } = await supabase.from("restaurant_profiles").upsert(
    {
      id: "default",
      app_name: config.name,
      dashboard_title: `${config.name} Management`,
      brand_color: config.brandColor,
      brand_hover_color: config.brandHoverColor,
      city: config.city,
      currency: "Rs.",
      timezone: "Asia/Karachi",
      branch_mode: "single",
      default_branch_id: branchId || null,
      support_phone: config.phoneDelivery,
      delivery_phone: config.phoneDelivery,
      dine_in_phone: config.phoneDelivery,
      ai_personality_default: `Warm, energetic, and professional ${config.name} ordering assistant`,
      menu_display_mode: config.menuDisplayMode,
      whatsapp_provider: config.whatsappProvider,
      menu_card_images: [],
    },
    { onConflict: "id" },
  );

  if (profileError) {
    console.warn("  Note on restaurant_profiles table:", profileError.message);
  }

  // 4. Link staff profile
  if (userId) {
    console.log("  Setting up staff profile with admin privileges...");
    const { error: staffError } = await supabase.from("staff_profiles").upsert(
      {
        user_id: userId,
        full_name: `${config.name} Administrator`,
        role: "admin",
        default_branch_id: branchId || null,
      },
      { onConflict: "user_id" },
    );
    if (staffError) {
      console.warn("  Note on staff_profiles table:", staffError.message);
    }
  }

  console.log("  Supabase configuration complete.");
}

async function setupVercel(config: ProjectConfig): Promise<string> {
  console.log("\n[2/3] Setting up Vercel project deployment...");

  const teamParam = VERCEL_TEAM ? `?teamId=${VERCEL_TEAM}` : "";

  // 1. Check if Vercel project already exists or create it
  let vercelProjectName = config.slug;
  const projectCheckRes = await fetch(`https://api.vercel.com/v9/projects/${vercelProjectName}${teamParam}`, {
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}` },
  });

  if (!projectCheckRes.ok) {
    console.log(`  Creating new Vercel project: ${vercelProjectName}...`);
    const createRes = await fetch(`https://api.vercel.com/v10/projects${teamParam}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VERCEL_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: vercelProjectName,
        framework: "nextjs",
        gitRepository: {
          type: "github",
          repo: GITHUB_REPO,
        },
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.text();
      console.warn("  Vercel project creation returned:", err);
      console.log("  Continuing to push environment variables...");
    } else {
      console.log("  Vercel project created successfully.");
    }
  } else {
    console.log(`  Vercel project ${vercelProjectName} already exists.`);
  }

  // 2. Prepare environment variables
  const envVars: Record<string, string> = {
    // Supabase
    NEXT_PUBLIC_SUPABASE_URL: config.supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: config.supabaseAnonKey,
    SUPABASE_SERVICE_ROLE_KEY: config.supabaseServiceKey,

    // Branding
    NEXT_PUBLIC_APP_NAME: config.name,
    NEXT_PUBLIC_BRAND_COLOR: config.brandColor,
    NEXT_PUBLIC_BRAND_HOVER_COLOR: config.brandHoverColor,
    NEXT_PUBLIC_APP_CITY: config.city,
    NEXT_PUBLIC_APP_CURRENCY: "Rs.",
    NEXT_PUBLIC_APP_PHONE_DELIVERY: config.phoneDelivery,
    NEXT_PUBLIC_APP_PHONE_DINE_IN: config.phoneDelivery,
    NEXT_PUBLIC_APP_PHONE_DINEIN: config.phoneDelivery,
    NEXT_PUBLIC_AI_PERSONALITY: `Warm, energetic, and professional ${config.name} ordering assistant`,
    MENU_DISPLAY_MODE: config.menuDisplayMode,
    WHATSAPP_PROVIDER: config.whatsappProvider,

    // Admin Auth
    ADMIN_EMAIL: config.adminEmail,

    // Security Tokens (Unique per client)
    WHATSAPP_VERIFY_TOKEN: `${config.slug}_${crypto.randomBytes(12).toString("hex")}`,
    RATE_LIMIT_HASH_SECRET: crypto.randomBytes(24).toString("base64url"),
    HEALTHCHECK_SECRET: crypto.randomBytes(24).toString("base64url"),

    // Shared Platform Defaults (Groq, embeddings, timeout)
    ...SHARED_DEFAULTS,
  };

  // 3. Clear existing variables and push fresh
  console.log("  Pushing encrypted environment variables to Vercel...");
  const envListRes = await fetch(`https://api.vercel.com/v10/projects/${vercelProjectName}/env${teamParam}`, {
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}` },
  });

  if (envListRes.ok) {
    const existingEnvs = ((await envListRes.json()) as { envs?: Array<{ id: string; key: string }> }).envs || [];
    for (const env of existingEnvs) {
      if (env.key in envVars) {
        await fetch(`https://api.vercel.com/v9/projects/${vercelProjectName}/env/${env.id}${teamParam}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${VERCEL_TOKEN}` },
        });
      }
    }
  }

  let createdCount = 0;
  for (const [key, value] of Object.entries(envVars)) {
    const postRes = await fetch(`https://api.vercel.com/v10/projects/${vercelProjectName}/env${teamParam}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VERCEL_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        key,
        value,
        type: "encrypted",
        target: ["production", "preview", "development"],
      }),
    });

    if (postRes.ok) createdCount++;
  }

  console.log(`  Pushed ${createdCount} environment variables to Vercel.`);

  // Write local backup .env file
  const localEnvPath = path.join(process.cwd(), `.env.${config.slug}.production`);
  const envFileContent = Object.entries(envVars)
    .map(([k, v]) => `${k}="${v}"`)
    .join("\n");
  fs.writeFileSync(localEnvPath, envFileContent, "utf8");
  console.log(`  Saved local backup: .env.${config.slug}.production`);

  return `https://${vercelProjectName}.vercel.app`;
}

function generateRailwayConfig(config: ProjectConfig, deploymentUrl: string) {
  console.log("\n[3/3] Generating Railway Evolution API configuration...");

  const railwayEnv = `# Evolution API v2 server for ${config.name}
# Use the shared Evolution server for all tenants; do not create a global default session.
SERVER_TYPE=http
SERVER_PORT=8080
SERVER_URL=https://YOUR-EVOLUTION-SERVER
AUTHENTICATION_API_KEY=${crypto.randomBytes(32).toString("hex")}
AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=false
DATABASE_ENABLED=true
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=postgresql://USER:PASSWORD@HOST:5432/evolution?schema=evolution_api
DATABASE_CONNECTION_CLIENT_NAME=orderiq_evolution
CACHE_REDIS_ENABLED=true
CACHE_REDIS_URI=redis://REDIS_HOST:6379/0
CACHE_REDIS_PREFIX_KEY=orderiq_evolution
CACHE_REDIS_SAVE_INSTANCES=false
CACHE_LOCAL_ENABLED=false
WEBHOOK_GLOBAL_ENABLED=false
# In your dashboard app: APP_URL=${deploymentUrl}
# Set EVOLUTION_API_BASE_URL, EVOLUTION_API_KEY, and EVOLUTION_WEBHOOK_SECRET there.
# Tenant-specific instance webhooks are configured automatically by the dashboard.
`;

  const railwayPath = path.join(process.cwd(), `.env.${config.slug}.railway`);
  fs.writeFileSync(railwayPath, railwayEnv, "utf8");
  console.log(`  Generated Railway Evolution API config: .env.${config.slug}.railway`);
}

async function main() {
  const config = await gatherConfig();

  // 1. Supabase setup
  await setupSupabase(config);

  // 2. Vercel deployment
  const deploymentUrl = await setupVercel(config);

  // 3. Railway Evolution API config (if needed)
  if (config.whatsappProvider === "evolution") {
    generateRailwayConfig(config, deploymentUrl);
  }

  // 4. Output complete handover summary
  console.log("\n=======================================================");
  console.log("  Client Project Setup Complete! 🎉");
  console.log("=======================================================");
  console.log(`  Restaurant:        ${config.name}`);
  console.log(`  Dashboard URL:     ${deploymentUrl}/dashboard`);
  console.log(`  Login Page:        ${deploymentUrl}/login`);
  console.log(`  Admin Email:       ${config.adminEmail}`);
  console.log(`  Admin Password:    ${config.adminPassword}`);
  console.log(`  WhatsApp Provider: ${config.whatsappProvider.toUpperCase()}`);
  console.log(`  Menu Mode:         ${config.menuDisplayMode}`);
  console.log("\n--- WhatsApp Webhook Configuration ---");
  if (config.whatsappProvider === "evolution") {
    console.log(`  Evolution API Webhook URL:  ${deploymentUrl}/api/webhook/evolution`);
    console.log(`  Railway Config:      .env.${config.slug}.railway`);
  } else if (config.whatsappProvider === "meta") {
    console.log(`  Meta Callback URL:   ${deploymentUrl}/api/webhook`);
    console.log(`  Meta Verify Token:   Check Vercel env WHATSAPP_VERIFY_TOKEN`);
  }
  console.log("\n--- Next Steps for Handover ---");
  console.log(`  1. If running for the first time on a fresh Supabase DB,`);
  console.log(`     run 'supabase-schema.sql' in the Supabase SQL editor.`);
  console.log(`  2. Log in at ${deploymentUrl}/login with the admin credentials above.`);
  console.log(`  3. Go to /dashboard/admin to customize branding or menu display.`);
  console.log(`  4. Go to /dashboard/whatsapp to connect WhatsApp number.\n`);
}

main().catch((err) => {
  console.error("\nSetup failed:", err);
  process.exit(1);
});
