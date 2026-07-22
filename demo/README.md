# WhatsApp AI Agent — Automated Product-Demo System

This module provides a production-grade, automated product-demo system for recording video demonstrations using the real WhatsApp AI Agent restaurant web dashboard.

---

## 🌟 Key Features

1. **Real UI & Dashboard Integration**:
   - Uses the actual Next.js dashboard routes (`/dashboard`, `/dashboard/conversations`, `/dashboard/orders`, `/dashboard/menu`, `/dashboard/analytics`, `/dashboard/settings`).
   - No fake static HTML fallbacks or rewritten components.

2. **Isolated & Production-Safe Demo Mode**:
   - Protected via `ENABLE_DEMO_MODE=true` and token verification (`X-Demo-Secret` header / authenticated demo admin session).
   - Public users cannot activate demo mode by appending `?demo=true`.
   - Uses an isolated demo branch (`tandoori-islamabad`) and demo customer (`Tariq Mahmood`), keeping production customer data untouched.

3. **Instant Simulated WhatsApp Conversation**:
   - Predefined natural Pakistani restaurant ordering flow:
     - Customer greeting & delivery request
     - AI welcome & menu recommendations
     - Item selection (Peshawari Chicken Karahi & Roghani Naans)
     - AI upsell suggestion (Mint Raita & Chilled Cokes)
     - Order summary & Total price (Rs. 3,450)
     - Customer confirmation (`CONFIRM`)
     - AI final order confirmation (#1042)
   - Features animated typing indicator (`AI Agent is typing...`), smooth auto-scrolling, delivery status badges, and live draft side drawer cart updates.

4. **Real Order Synchronization**:
   - When customer confirms order in chat, a real order (`#1042`) is persisted to Supabase database.
   - When Playwright switches to `/dashboard/orders`, Order `#1042` appears in the real Order Queue with matching items, prices, address, and total!
   - Staff updates order status from "New Order" -> "Preparing" live on camera.

5. **Cache Pre-warming & Smooth Mouse Movements**:
   - Performs an automated pre-recording pass over all dashboard pages to prime Next.js and browser caches, eliminating visible cold loading spinners during video capture.
   - Injects a smooth glowing custom cursor dot into Playwright for engaging video recording.

---

## 📁 Directory Structure

```text
demo/
├── scenarios/
│   └── restaurant-order.scenario.ts    # Predefined structured scenario data & order specs
├── controllers/
│   └── demo-controller.ts              # Window-level controller (window.__DEMO_CONTROLLER__)
├── seed/
│   └── seed-demo-data.ts               # Idempotent database seeding and cleanup script
├── playwright/
│   ├── record-product-demo.ts          # Automated Playwright video recording script
│   ├── record-product-demo-headed.ts   # Headed mode recording script (visible browser)
│   └── playwright.demo.config.ts       # Playwright 1080p configuration
└── README.md                           # Documentation & execution guide
```

---

## 🔑 Environment Configuration

Add the following environment variables to `.env.local`:

```env
ENABLE_DEMO_MODE=true
DEMO_SECRET_KEY=tandoori-demo-secret-key
DEMO_BASE_URL=http://localhost:3000
DEMO_USER_EMAIL=demo_admin@tandoori.pk
DEMO_USER_PASSWORD=DemoAdmin123!
```

---

## 🛠️ Installation & Commands

### 1. Seed / Reset Demo Data
Resets demo conversations, clears old demo orders, and seeds the demo branch, customer profile, and menu items:

```bash
npm run demo:seed
```

### 2. Generate Recorded Video (Headless)
Runs the complete automated walkthrough in headless Chromium and outputs the recorded video to `output/playwright/product-demo.webm`:

```bash
npm run demo:record
```

### 3. Generate Recorded Video (Headed - Visible Browser)
Runs the demo automation in a visible Chromium browser window:

```bash
npm run demo:record:headed
```

### 4. Debug Automation
Launches Playwright Inspector to step through selectors and timing interactively:

```bash
npm run demo:debug
```

---

## 🎥 Output Video Location

Upon completion, recorded video artifacts are saved in:

```text
output/playwright/product-demo.webm
```

---

## 🛡️ Security & Production Safeguards

- Demo endpoints (`/api/demo/seed` & `/api/demo/order`) return `403 Forbidden` unless `ENABLE_DEMO_MODE=true` or a valid secret header (`X-Demo-Secret`) is supplied.
- All operations are isolated to the demo phone `+923001234567` and demo branch slug `tandoori-islamabad`.
- Non-demo customer orders, real WhatsApp webhooks, and live credentials are never exposed or touched.
