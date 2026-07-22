import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");
const dotenv = require("dotenv");

// Load env variables
dotenv.config({ path: ".env.local" });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outputDir = "C:/Users/PMLS/.gemini/antigravity-ide/brain/4dc8a48a-633b-4825-af21-d822f82408b0";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function cleanPreviousConversations(phone) {
  console.log(`🧹 Cleaning up previous database entries for phone: ${phone}...`);
  const { data: convs } = await supabaseAdmin
    .from("conversations")
    .select("id")
    .eq("phone", phone);

  if (convs && convs.length > 0) {
    const ids = convs.map((c) => c.id);
    await supabaseAdmin.from("messages").delete().in("conversation_id", ids);
    await supabaseAdmin.from("orders").delete().in("conversation_id", ids);
    await supabaseAdmin.from("conversations").delete().in("id", ids);
  }
}

async function postWebhookMessage(phone, body, name = "Customer Demo") {
  console.log(`💬 Simulated User [${phone}]: "${body}"`);
  const payload = {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  from: phone,
                  id: `wamid.mockInbound${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
                  timestamp: Math.floor(Date.now() / 1000).toString(),
                  type: "text",
                  text: {
                    body: body,
                  },
                },
              ],
              contacts: [
                {
                  profile: {
                    name: name,
                  },
                },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  };

  const response = await fetch("http://localhost:3000/api/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Webhook simulation failed: ${response.statusText}`);
  }
}

async function main() {
  const testPhone = "923005551234";
  const testName = "Zahid Hussain";

  await cleanPreviousConversations(testPhone);

  console.log("🚀 Launching Playwright browser...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: {
      dir: outputDir,
      size: { width: 1440, height: 900 },
    },
  });

  const page = await context.newPage();

  console.log("🔑 Logging in to actual dashboard...");
  await page.goto("http://localhost:3000/login");
  await page.fill('input[type="email"]', "demo_admin@tandoori.pk");
  await page.fill('input[type="password"]', "DemoAdmin123!");
  await page.click('button[type="submit"]');

  // Wait for redirect to dashboard
  await page.waitForURL("**/dashboard", { timeout: 15000 });
  console.log("✅ Logged in! Redirected to Dashboard.");
  await page.waitForTimeout(3000);

  // Navigate to conversations
  console.log("📂 Opening conversations tab...");
  await page.goto("http://localhost:3000/dashboard/conversations");
  await page.waitForTimeout(4000);

  // Start simulated conversation
  console.log("💬 Starting simulated WhatsApp flow...");

  // Msg 1: Say Hi
  await postWebhookMessage(testPhone, "Hello, mujhe order krna hai", testName);
  await page.waitForTimeout(6000);

  // Msg 2: Choose branch (Tandoori New City ID)
  // We send the ID of Tandoori New City
  await postWebhookMessage(testPhone, "71868596-1bf2-4d1c-a6a0-27fe3e387d7f", testName);
  await page.waitForTimeout(6000);

  // Click on the conversation in the list
  console.log("🖱️ Clicking on active conversation in sidebar...");
  const convItem = page.locator(`text=${testName}`).first();
  await convItem.click();
  await page.waitForTimeout(3000);

  // Msg 3: Order Chicken Biryani
  await postWebhookMessage(testPhone, "Chicken Biryani chahiye", testName);
  await page.waitForTimeout(6000);

  // Msg 4: Quantity
  await postWebhookMessage(testPhone, "2 plate", testName);
  await page.waitForTimeout(6000);

  // Msg 5: Proceed to delivery
  await postWebhookMessage(testPhone, "delivery krwa dain", testName);
  await page.waitForTimeout(6000);

  // Msg 6: Address
  await postWebhookMessage(testPhone, "New City Phase 2, House 12-C", testName);
  await page.waitForTimeout(6000);

  // Msg 7: Yes to confirm address/order
  await postWebhookMessage(testPhone, "Yes", testName);
  await page.waitForTimeout(8000);

  // Go to orders
  console.log("📦 Navigating to Orders view...");
  await page.goto("http://localhost:3000/dashboard/orders");
  await page.waitForTimeout(5000);

  // Click the new order card to expand details
  console.log("🖱️ Expanding the newly received order...");
  const orderCard = page.locator(`text=${testName}`).first();
  await orderCard.click();
  await page.waitForTimeout(4000);

  // Scroll down in order details
  await page.evaluate(() => window.scrollBy(0, 300));
  await page.waitForTimeout(3000);

  // Select "preparing" in status select
  console.log("⚙️ Simulating staff changing order status to Preparing...");
  const orderRow = page.locator("div.rounded-2xl", { hasText: testName }).first();
  const selectStatus = orderRow.locator("select");
  await selectStatus.selectOption("preparing");
  await page.waitForTimeout(5000);

  // Go to settings
  console.log("⚙️ Showing Settings configurations...");
  await page.goto("http://localhost:3000/dashboard/settings");
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.scrollBy(0, 400));
  await page.waitForTimeout(3000);

  // Return to Dashboard home
  console.log("🏡 Returning to main Dashboard Overview...");
  await page.goto("http://localhost:3000/dashboard");
  await page.waitForTimeout(4000);

  // Wrap up
  console.log("🎬 Closing browser and finalising recording...");
  const video = page.video();
  await context.close();
  await browser.close();

  const videoPath = await video?.path();
  console.log(`🎉 Demo video successfully recorded: ${videoPath}`);
}

main().catch(console.error);
