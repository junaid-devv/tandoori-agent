import { chromium, type Page } from "playwright";
import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const rootDir = process.cwd();
const outputDir = path.join(rootDir, "output", "playwright");

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Injects an authentic OS Mouse Arrow cursor icon for clean video recordings
async function injectCustomCursor(page: Page) {
  await page.addInitScript(() => {
    window.addEventListener("DOMContentLoaded", () => {
      const cursor = document.createElement("div");
      cursor.id = "__demo_cursor__";
      cursor.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M5.5 3.5L18.5 11.5L12.5 13.5L9.5 19.5L5.5 3.5Z" fill="#0f172a" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
      cursor.style.position = "fixed";
      cursor.style.top = "0px";
      cursor.style.left = "0px";
      cursor.style.pointerEvents = "none";
      cursor.style.zIndex = "999999";
      cursor.style.filter = "drop-shadow(0px 2px 4px rgba(0,0,0,0.4))";
      cursor.style.transition = "transform 0.08s ease-out";
      document.body.appendChild(cursor);

      document.addEventListener("mousemove", (e) => {
        cursor.style.left = `${e.clientX}px`;
        cursor.style.top = `${e.clientY}px`;
      });

      document.addEventListener("mousedown", () => {
        cursor.style.transform = "scale(0.85)";
      });

      document.addEventListener("mouseup", () => {
        cursor.style.transform = "scale(1)";
      });
    });
  });
}

// Smooth mouse movement helper
async function smoothMoveAndClick(page: Page, selector: string, options?: { click?: boolean; delayMs?: number }) {
  const element = page.locator(selector).first();
  await element.waitFor({ state: "visible", timeout: 10000 });
  const box = await element.boundingBox();
  if (box) {
    const targetX = box.x + box.width / 2;
    const targetY = box.y + box.height / 2;
    await page.mouse.move(targetX, targetY, { steps: 12 });
    await page.waitForTimeout(options?.delayMs ?? 250);
    if (options?.click !== false) {
      await element.click();
    }
  } else {
    if (options?.click !== false) {
      await element.click();
    }
  }
}

export async function runProductDemoRecording(options?: { headless?: boolean }) {
  const baseUrl = process.env.DEMO_BASE_URL || "http://localhost:3000";
  const demoEmail = process.env.DEMO_USER_EMAIL || "demo_admin@tandoori.pk";
  const demoPassword = process.env.DEMO_USER_PASSWORD || "DemoAdmin123!";

  console.log("🚀 [DEMO RECORDING] Launching Playwright Chromium browser...");
  const browser = await chromium.launch({
    headless: options?.headless ?? true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  // 1. WARMUP CONTEXT (primes cache, logs in, pre-fetches all dashboard routes)
  console.log("🔥 [DEMO RECORDING] Performing pre-recording warmup pass for instant page loads...");
  const warmupContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const warmupPage = await warmupContext.newPage();

  await warmupPage.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
  await warmupPage.fill('input[type="email"]', demoEmail);
  await warmupPage.fill('input[type="password"]', demoPassword);
  await warmupPage.click('button[type="submit"]');
  await warmupPage.waitForURL("**/dashboard", { timeout: 15000 });

  // Prime all 7 routes into Next.js router & browser memory
  const routesToWarm = [
    "/dashboard",
    "/dashboard/conversations",
    "/dashboard/orders",
    "/dashboard/analytics",
    "/dashboard/menu",
    "/dashboard/settings",
    "/dashboard/admin",
  ];
  for (const route of routesToWarm) {
    await warmupPage.goto(`${baseUrl}${route}`, { waitUntil: "networkidle" });
    await warmupPage.waitForTimeout(300);
  }

  // Save auth storage state so the recording context reuses session cleanly
  const storageStatePath = path.join(outputDir, "demo-auth-state.json");
  await warmupContext.storageState({ path: storageStatePath });
  await warmupContext.close();

  // 2. MAIN RECORDING CONTEXT
  console.log("📹 [DEMO RECORDING] Starting official video recording context (1920x1080)...");
  const recordingContext = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    storageState: storageStatePath,
    recordVideo: {
      dir: outputDir,
      size: { width: 1920, height: 1080 },
    },
  });

  const page = await recordingContext.newPage();
  await injectCustomCursor(page);

  // PAGE 1: Overview Dashboard
  console.log("📊 [PAGE 1/7] Displaying Dashboard Overview & KPI Metrics...");
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);

  // PAGE 2: Conversations
  console.log("💬 [PAGE 2/7] Navigating to Conversations Page...");
  await smoothMoveAndClick(page, '[data-testid="nav-conversations"]');
  await page.waitForTimeout(1800);

  console.log("👤 Selecting Demo Customer (Tariq Mahmood)...");
  const demoConvSelector = '[data-testid="conversation-item-923001234567"]';
  await page.locator(demoConvSelector).waitFor({ state: "visible", timeout: 10000 });
  await smoothMoveAndClick(page, demoConvSelector);
  await page.waitForTimeout(1800);

  console.log("🤖 Playing full simulated WhatsApp AI conversation scenario...");
  await page.evaluate(() => window.__DEMO_CONTROLLER__?.resetScenario());
  await page.waitForTimeout(1000);

  // Msg 1: Customer Greeting
  console.log("  💬 Customer: Greeting & Delivery Request...");
  await page.evaluate(() => window.__DEMO_CONTROLLER__?.showNextMessage());
  await page.waitForTimeout(2000);

  // Msg 2: AI Prompt for Delivery Address
  console.log("  🤖 AI: Welcome & Request for Delivery Address...");
  await page.evaluate(() => window.__DEMO_CONTROLLER__?.showNextMessage());
  await page.waitForTimeout(2500);

  // Msg 3: Customer Address Input
  console.log("  💬 Customer: Provides Sector F-6/2 Address...");
  await page.evaluate(() => window.__DEMO_CONTROLLER__?.showNextMessage());
  await page.waitForTimeout(2000);

  // Msg 4: AI Address Confirmation & Menu Inquiry
  console.log("  🤖 AI: Validates Address & Offers Menu Items...");
  await page.evaluate(() => window.__DEMO_CONTROLLER__?.showNextMessage());
  await page.waitForTimeout(2500);

  // Msg 5: Customer Karahi & Naan Order
  console.log("  💬 Customer: Orders Peshawari Karahi & Roghani Naans...");
  await page.evaluate(() => window.__DEMO_CONTROLLER__?.showNextMessage());
  await page.waitForTimeout(2000);

  // Msg 6: AI Item Confirmation & Upsell Offer
  console.log("  🤖 AI: Confirms Karahi & Naans, Upsells Mint Raita & Cokes...");
  await page.evaluate(() => window.__DEMO_CONTROLLER__?.showNextMessage());
  await page.waitForTimeout(2800);

  // Msg 7: Customer Additions
  console.log("  💬 Customer: Adds Mint Raita & Cokes...");
  await page.evaluate(() => window.__DEMO_CONTROLLER__?.showNextMessage());
  await page.waitForTimeout(2000);

  // Msg 8: AI Summary & Total Amount
  console.log("  🤖 AI: Itemized Summary, Address & Rs. 3,450 Total...");
  await page.evaluate(() => window.__DEMO_CONTROLLER__?.showNextMessage());
  await page.waitForTimeout(3000);

  // Msg 9: Customer Confirmation ("CONFIRM") -> Syncs Order #1042
  console.log("  💬 Customer: Sends 'CONFIRM'...");
  await page.evaluate(() => window.__DEMO_CONTROLLER__?.showNextMessage());
  await page.waitForTimeout(2000);

  // Msg 10: AI Final Order Confirmation
  console.log("  🤖 AI: Order Confirmation #1042 & Delivery ETA...");
  await page.evaluate(() => window.__DEMO_CONTROLLER__?.showNextMessage());
  await page.waitForTimeout(3200);

  // AFTER CHAT COMPLETE: Click View Draft Button to highlight slide-over cart drawer
  console.log("🛒 [POST-CHAT] Opening View Draft panel to showcase live cart items...");
  await smoothMoveAndClick(page, '[data-testid="view-draft-button"]');
  await page.waitForTimeout(3000);

  // PAGE 3: Orders Queue
  console.log("📦 [PAGE 3/7] Navigating to Order Queue...");
  await smoothMoveAndClick(page, '[data-testid="nav-orders"]');
  await page.waitForTimeout(2200);

  console.log("🔍 Locating and expanding Order #1042...");
  const orderCardSelector = '[data-testid="order-card-1042"]';
  await page.locator(orderCardSelector).waitFor({ state: "visible", timeout: 10000 });
  await smoothMoveAndClick(page, '[data-testid="order-expand-1042"]');
  await page.waitForTimeout(2500);

  console.log("⚙️ Updating Order #1042 status to 'Preparing'...");
  const statusSelect = page.locator('[data-testid="order-status-select-1042"]');
  await statusSelect.selectOption("preparing");
  await page.waitForTimeout(3500);

  // PAGE 4: Analytics
  console.log("📈 [PAGE 4/7] Navigating to Analytics...");
  await smoothMoveAndClick(page, '[data-testid="nav-analytics"]');
  await page.waitForTimeout(3800);

  // PAGE 5: Menu Editor
  console.log("🍽️ [PAGE 5/7] Navigating to Menu Editor...");
  await smoothMoveAndClick(page, '[data-testid="nav-menu"]');
  await page.waitForTimeout(3800);

  // PAGE 6: Settings
  console.log("⚙️ [PAGE 6/7] Navigating to Settings...");
  await smoothMoveAndClick(page, '[data-testid="nav-settings"]');
  await page.waitForTimeout(3800);

  // PAGE 7: Admin Console (Branch & Staff Management)
  console.log("👑 [PAGE 7/7] Navigating to Admin Console (Branch & Staff Management)...");
  await smoothMoveAndClick(page, '[data-testid="nav-admin"]');
  await page.waitForTimeout(4000);

  // CLOSING SHOT: Return to Dashboard Overview
  console.log("🏁 Returning to Dashboard Overview for final closing shot...");
  await smoothMoveAndClick(page, '[data-testid="nav-overview"]');
  await page.waitForTimeout(3500);

  // Finalize video recording
  console.log("🎬 [DEMO RECORDING] Finalizing video recording...");
  const video = page.video();
  await recordingContext.close();
  await browser.close();

  const rawVideoPath = await video?.path();
  if (rawVideoPath) {
    const finalVideoPath = path.join(outputDir, "product-demo.webm");
    if (fs.existsSync(rawVideoPath)) {
      fs.copyFileSync(rawVideoPath, finalVideoPath);
    }
    console.log(`🎉 [DEMO RECORDING] Product Demo video successfully generated!`);
    console.log(`📁 Video Path: ${finalVideoPath}`);
    return finalVideoPath;
  }

  return null;
}

runProductDemoRecording({ headless: true })
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
