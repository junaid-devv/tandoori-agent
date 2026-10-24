> WhatsApp integration setup: use [EVOLUTION_API_SETUP.md](EVOLUTION_API_SETUP.md) as the current source of truth for multi-tenant Evolution and Meta configuration.

# 📋 ORDERiQ - White-Label Client Handover Guide

This comprehensive guide outlines the end-to-end process for provisioning, configuring, testing, and handing over an **ORDERiQ** restaurant deployment to a new client.

---

## 1. Overview & White-Label Architecture

ORDERiQ is an enterprise-grade AI conversational ordering platform designed for high-volume delivery, takeaway, and dine-in restaurants. Each client deployment consists of:

1. **Frontend & AI Brain (Vercel)**: Next.js 14 application providing the WhatsApp AI ordering engine, customer web interface, and administrative management dashboard.
2. **Database & Storage (Supabase)**: Dedicated or schema-isolated PostgreSQL database with `pgvector` for semantic menu search, row-level security (RLS), real-time order channels, and auth.
3. **WhatsApp Channel**:
   - **Evolution API Gateway (Railway)**: Self-hosted multi-device WhatsApp Web gateway (Baileys) linked via QR code scan.
   - **OR Meta Cloud API**: Official WhatsApp Business Platform webhook integration.

```
+-----------------------------------------------------------------------------------+
|                                 CLIENT ECOSYSTEM                                  |
|                                                                                   |
|  [ Customer WhatsApp ] <=======> [ Evolution API (Railway) OR Meta API ]                 |
|                                                  |                                |
|                                           Webhooks & API                          |
|                                                  v                                |
|                                   [ ORDERiQ Brain (Vercel) ]                      |
|                                     (Next.js App Router)                          |
|                                       /              \                            |
|                                      /                \                           |
|                         [ AI Inference ]            [ Database & Realtime ]       |
|                       (Groq / Whisper / Qwen)          (Supabase Postgres)        |
|                                                               |                   |
|                                                       [ Staff Dashboard ]         |
|                                                      (Live Orders / KDS)          |
+-----------------------------------------------------------------------------------+
```

---

## 2. Pre-Requisites for Client Setup

Before running the onboarding script, assemble the following client details:

| Field | Description | Example |
|---|---|---|
| **Restaurant Name** | Official trade name | `Burger Hub` |
| **URL Slug** | Unique lowercase subdomain identifier | `burger-hub` |
| **City** | Primary operating city | `Islamabad` |
| **Brand Color** | Primary brand hex code | `#E53E3E` |
| **Admin Email** | Initial manager login email | `admin@burgerhub.pk` |
| **Delivery Phone** | Customer care / order dispatch phone | `+923001234567` |
| **Supabase URL** | Client Supabase project endpoint | `https://xyzcompany.supabase.co` |
| **Supabase Service Key** | Service role key for provisioning | `ey...` |
| **WhatsApp Choice** | `evolution` (QR code) or `meta` (Official Cloud API) | `evolution` |
| **Menu Display Mode** | `interactive_list`, `menu_pictures`, or `text_only` | `interactive_list` |

---

## 3. Automated Provisioning (Scaffolding CLI)

The CLI located at `scripts/create-project.ts` automatically configures the database, links staff credentials, provisions the Vercel project, pushes all required encrypted environment variables, and exports Railway configuration.

### Option A: Interactive Wizard
Run the script interactively and answer the terminal prompts:

```bash
npx tsx scripts/create-project.ts
```

### Option B: Fast CLI Flags (Non-Interactive / CI)
Pass flags directly to run fully automated provisioning:

```bash
npx tsx scripts/create-project.ts \
  --name "Burger Hub" \
  --slug "burger-hub" \
  --city "Islamabad" \
  --brand-color "#E53E3E" \
  --admin-email "admin@burgerhub.pk" \
  --admin-password "BurgerHub2026!" \
  --whatsapp-provider "evolution" \
  --menu-display-mode "interactive_list" \
  --supabase-url "https://xyz.supabase.co" \
  --supabase-anon-key "ey..." \
  --supabase-service-key "ey..." \
  --phone-delivery "+923001234567"
```

### What the CLI Handles Automatically:
1. **Supabase Auth**: Provisions the administrator account with the specified email and password.
2. **Branch Setup**: Ensures the primary restaurant branch (`[slug]-main`) is created.
3. **Restaurant Profile**: Sets up `restaurant_profiles` with the brand colors, phone numbers, AI personality, and menu mode.
4. **Staff Roles**: Grants `admin` permissions to the staff profile record.
5. **Vercel Project**: Checks/creates the Vercel project connected to the GitHub repository and deploys all production environment variables with encryption.
6. **Local Backup**: Writes `.env.[slug].production` and `.env.[slug].railway` for quick disaster recovery and auditing.

---

## 4. Database Setup & Initialization

If deploying on a brand new Supabase project:

1. Log in to the client's [Supabase Dashboard](https://supabase.com/dashboard).
2. Open **SQL Editor** -> **New Query**.
3. Paste the contents of `db/schema.sql` (or `supabase-schema.sql`) and run the query.
4. Verify that `branches`, `restaurant_profiles`, `staff_profiles`, `menu_items`, `menu_categories`, `orders`, and `conversation_states` exist.
5. Seed the client's menu items either via:
   - The SQL editor using the client's menu seed file.
   - Or through the dashboard at `https://[slug].vercel.app/dashboard/menu`.

### Generate Semantic Menu Embeddings:
To allow the AI to understand natural customer queries (e.g., *"kuch spicy aur cheesy burger batao"*), generate vector embeddings for their menu:

```bash
# Point to client environment and run embedding generator
npx tsx scripts/generate-embeddings.ts --env .env.[slug].production
```

---

## 5. WhatsApp Gateway Setup

### Path A: Evolution API (WhatsApp linked devices)

Follow [EVOLUTION_API_SETUP.md](EVOLUTION_API_SETUP.md) for the complete Railway/VPS setup.
Use one shared Evolution v2 server and one deterministic instance per restaurant.
Create instances, scan QR codes, pair phones, switch providers, and send tests from
ORDERiQ's existing WhatsApp Integration dashboard. No Evolution Manager dashboard
is required. The provider is selected per restaurant in Supabase; do not configure a
global default session or route webhooks with a caller-supplied tenant ID.

### Path B: Official Meta Cloud API (For Enterprise Registered WABA)

If the client prefers the official Meta Cloud API:

1. **Meta Developer Portal**:
   - Create a Business App under [Meta for Developers](https://developers.facebook.com).
   - Add the **WhatsApp** product.
   - Generate a Permanent System User Access Token with `whatsapp_business_messaging` and `whatsapp_business_management` permissions.
2. **Configure Webhook**:
   - Callback URL: `https://[slug].vercel.app/api/webhook`
   - Verify Token: Enter the `WHATSAPP_VERIFY_TOKEN` generated during project setup.
   - Webhook Fields: Subscribe to `messages`.
3. **Update Vercel Environment Variables**:
   ```env
   WHATSAPP_PROVIDER="meta"
   WHATSAPP_ACCESS_TOKEN="EAA..."
   WHATSAPP_PHONE_NUMBER_ID="1234567890"
   WHATSAPP_BUSINESS_ACCOUNT_ID="1234567890"
   ```

---

## 6. Dashboard Walkthrough & Customization

Direct the client's general manager or administrator to log in at:
`https://[slug].vercel.app/login`

### 1. General Branding (`/dashboard/admin`)
- **Logo & Favicon**: Upload high-resolution square restaurant logo.
- **Brand Colors**: Verify button accents match brand identity.
- **Operating Hours**: Specify delivery & dine-in opening hours.
- **Branch Settings**: Manage branch address, geofences, and active delivery zones.

### 2. Menu Display Configuration
Set the WhatsApp menu format based on client preference:
- **`interactive_list`**: Interactive buttons & sectioned WhatsApp lists (recommended for modern UI).
- **`menu_pictures`**: High-quality visual food cards sent directly to the customer.
- **`text_only`**: Fast, lightweight, data-saving plain text format.

### 3. Menu Management (`/dashboard/menu`)
- Create categories (e.g., *Burgers*, *Deals*, *Sides*, *Beverages*).
- Configure item modifiers and variations (e.g., *Double Patty*, *Extra Cheese*, *Spice Level*).
- Toggle out-of-stock items in real time.

### 4. Kitchen & Live Order Stream (`/dashboard/orders`)
- Real-time sound notification triggers on incoming orders.
- One-click order state advancement:
  `Received` $\rightarrow$ `Preparing` $\rightarrow$ `Out for Delivery` $\rightarrow$ `Delivered`.
- Automated customer WhatsApp updates on each status transition.
- Thermal receipt printing support (58mm / 80mm format).

### 5. Customer Relationship Management (`/dashboard/customers`)
- Automatic capture of customer phone, name, and past addresses.
- Customer order history, lifetime value (LTV), and notes (e.g., *"allergic to onions"*).

---

## 7. Quality Assurance & Acceptance Checklist

Before handing over credentials, complete this testing script:

- [ ] **Greeting Flow**: Send *"Salam"* or *"Hi"* on WhatsApp. Verify warm, branded response received in $< 2$ seconds.
- [ ] **Menu Query**: Request *"Menu dikhao"* or *"Show me burgers"*. Ensure menu format matches the chosen configuration.
- [ ] **Item Customization**: Request an item with add-ons (e.g., *"1 Beef Burger with extra cheese and fries"*). Verify AI accurately computes item price and modifier costs.
- [ ] **Audio Note Handling**: Send a 5-second voice note ordering an item in Urdu or English. Verify transcription and order capture.
- [ ] **Address Collection**: Provide a street address and confirm contact details.
- [ ] **Order Confirmation**: Confirm the order on WhatsApp. Check that:
  - [ ] Customer receives formatted invoice receipt summary.
  - [ ] Order instantly appears on `/dashboard/orders` with audio chime.
- [ ] **Status Transition**: Move order to `Preparing` and `Out for Delivery` in the dashboard. Verify customer receives automated WhatsApp notifications.
- [ ] **Rate Limiting & Fallbacks**: Confirm unauthorized access to `/dashboard` redirects to `/login`.

---

## 8. Client Handover Email / Document Template

Copy and fill out the template below when delivering the project to the client:

```markdown
Subject: Welcome to ORDERiQ - Your AI Restaurant Assistant is Ready! 🎉

Dear [Restaurant Owner/Manager Name],

We are thrilled to announce that the AI Ordering System for [Restaurant Name] is officially live!

Below are your credentials and management access details:

------------------------------------------------------------
1. YOUR MANAGEMENT DASHBOARD
------------------------------------------------------------
URL:        https://[slug].vercel.app/dashboard
Login Page: https://[slug].vercel.app/login
Email:      [admin-email]
Password:   [temporary-password]
(Please change your password upon your first login in Settings).

------------------------------------------------------------
2. YOUR WHATSAPP ORDERING CHANNEL
------------------------------------------------------------
Connected Number: [WhatsApp Number]
Status:           Connected & Active
Menu Mode:        [interactive_list / menu_pictures / text_only]

Customers can now message your WhatsApp number directly to browse menus, 
customize dishes, and place delivery or takeaway orders 24/7.

------------------------------------------------------------
3. QUICK START STEPS FOR STAFF
------------------------------------------------------------
1. Open the Orders Dashboard: Keep https://[slug].vercel.app/dashboard/orders open
   on your kitchen or counter tablet. Ensure speaker volume is ON for order chimes.
2. Review Your Menu: Go to /dashboard/menu to mark any out-of-stock items or update prices.
3. Order Status: When kitchen begins preparing an order, click "Mark Preparing".
   When the rider leaves, click "Out for Delivery" to notify the customer automatically.

------------------------------------------------------------
4. SUPPORT & MAINTENANCE
------------------------------------------------------------
If your WhatsApp device disconnects or needs to be re-linked:
- Go to /dashboard/whatsapp or contact our support desk:
- Support Hotline: +92-XXX-XXXXXXX
- Support Email: support@orderiq.pk

Thank you for choosing ORDERiQ to power your digital orders!
```

---

## 9. Maintenance & Troubleshooting

### Re-linking WhatsApp Device (Evolution API)

Open ORDERiQ → WhatsApp Integration → Evolution API → Start Session and scan the
new QR code. Each restaurant must link its own device. See [the setup guide](EVOLUTION_API_SETUP.md).

### Resetting Administrator Password
If the manager forgets their password:
1. Run the scaffolding CLI with the `--admin-password` flag:
   ```bash
   npx tsx scripts/create-project.ts --slug "[slug]" --admin-password "NewPassword123!"
   ```
2. Or update directly in Supabase Dashboard under **Authentication** -> **Users**.

### Rotating API Keys
- Groq or DeepSeek keys can be updated in Vercel Project Settings without application downtime.
- Run `npx tsx scripts/generate-embeddings.ts` whenever significant menu overhauls occur.
