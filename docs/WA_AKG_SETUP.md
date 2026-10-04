# 🚀 WA-AKG Gateway Integration & Setup Guide

This guide walks you through setting up and running **WA-AKG** (a self-hosted WhatsApp Web/Baileys gateway) with **ORDERiQ**, using your existing **Supabase database** and enabling instant switching between the official Meta Cloud API and WA-AKG.

---

## 1. Overview & Architecture

```
                                    +---------------------------------------------------+
                                    |                   SUPABASE                        |
                                    |  Schema: wa_akg       |  Schema: public           |
                                    |  (Sessions, QR, auth) |  (Orders, Menu, CRM, Chat)|
                                    +-----------+-------------------------+-------------+
                                                ^                         ^
                                                | Prisma                  | Supabase JS
                                                v                         v
[Customer WhatsApp] <=== WebSocket ===> [WA-AKG Gateway]                [ORDERiQ Brain]
                                          (Port 3001)                     (Port 3000)
                                                |                             ^
                                                |--- POST /webhook/wa-akg ----|  (Inbound)
                                                |<-- POST /messages/.../send -|  (Outbound)
```

- **ORDERiQ**: Your Next.js AI ordering agent.
- **WA-AKG**: Your self-hosted WhatsApp Web multi-device gateway powered by Baileys.
- **Shared Supabase Database**: Both services use the **same Supabase project**, cleanly separated by PostgreSQL schemas (`wa_akg` vs `public`).

---

## 2. Supabase Database Configuration (Schema Isolation)

WA-AKG uses **Prisma ORM**. To prevent WA-AKG's internal tables (`Contact`, `Message`, `Session`, `User`) from colliding with ORDERiQ's `public.contacts` and `public.messages`, isolate WA-AKG in its own schema:

1. In WA-AKG's `prisma/schema.prisma`, ensure the provider is `postgresql`:
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```

2. In WA-AKG's `.env`, configure the connection string to your Supabase project with `?schema=wa_akg`:
   ```env
   # From Supabase Dashboard > Project Settings > Database > Connection Pooling (Transaction / Session mode)
   DATABASE_URL="postgresql://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?schema=wa_akg"
   DIRECT_URL="postgresql://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres?schema=wa_akg"
   ```

3. Push the schema from the WA-AKG directory:
   ```bash
   npx prisma db push
   ```
   *Prisma will create the `wa_akg` schema and all gateway tables inside your Supabase project without touching any of your restaurant tables.*

---

## 3. Local Development Setup

### Step A: Start WA-AKG on Port 3001

1. Clone WA-AKG into a neighboring directory:
   ```bash
   git clone https://github.com/mrifqidaffaaditya/WA-AKG.git wa-akg
   cd wa-akg
   npm install
   ```

2. Create `wa-akg/.env`:
   ```env
   PORT=3001
   NEXTAUTH_URL="http://localhost:3001"
   AUTH_SECRET="super-secret-random-key-at-least-32-chars-long"
   DATABASE_URL="postgresql://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?schema=wa_akg"
   DIRECT_URL="postgresql://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres?schema=wa_akg"
   ```

3. Start WA-AKG on port 3001:
   ```bash
   npm run dev -- -p 3001
   ```

4. Connect WhatsApp:
   - Open `http://localhost:3001` in your browser.
   - Go to **Sessions** → **Add Session** (give it an ID like `default` or `main-branch`).
   - Scan the QR code using WhatsApp on your phone (**Settings > Linked Devices > Link a Device**).
   - Once connected, go to **Settings > API Keys** and generate an API key (e.g., `wag_xxxxxxxx`).

5. Configure Webhook in WA-AKG:
   - Go to **Webhooks** in the WA-AKG dashboard.
   - Click **Add Webhook**:
     - **URL**: `http://localhost:3000/api/webhook/wa-akg`
     - **Events**: Select `message.received`
     - **Session**: Select the session you just created (`default`).

---

### Step B: Configure ORDERiQ (`tandoori-agent`)

1. In your `.env.local`:
   ```env
   # Switch provider to WA-AKG
   WHATSAPP_PROVIDER=wa_akg

   # WA-AKG Gateway connection
   WA_AKG_BASE_URL=http://localhost:3001
   WA_AKG_API_KEY=wag_your_api_key_from_dashboard
   WA_AKG_SESSION_ID=default
   ```

2. Start ORDERiQ on port 3000:
   ```bash
   npm run dev
   ```

3. Send a WhatsApp message to the scanned phone number from another phone:
   - *"Salam, menu dikhao"*
   - WA-AKG receives it and forwards to `http://localhost:3000/api/webhook/wa-akg`.
   - ORDERiQ processes the order turn with AI and replies back through WA-AKG!

---

## 4. How to Switch Between Meta Cloud API and WA-AKG

You can switch anytime in `.env.local` or via `/dashboard/whatsapp`:

- **To use WA-AKG (QR Code / WhatsApp Web)**:
  ```env
  WHATSAPP_PROVIDER=wa_akg
  ```
- **To use Official Meta Cloud API**:
  ```env
  WHATSAPP_PROVIDER=meta
  ```

No code changes or database migrations required.

---

## 5. Deploying to Railway (Production)

1. Create a new project in [Railway](https://railway.app).
2. Deploy WA-AKG from your GitHub fork or via Dockerfile.
3. In Railway service variables, set:
   - `PORT=3000`
   - `AUTH_SECRET=...`
   - `DATABASE_URL=postgresql://...supabase.co:6543/postgres?schema=wa_akg`
   - `NEXTAUTH_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}`
4. In WA-AKG Dashboard on Railway:
   - Scan your WhatsApp QR code.
   - Create an API key.
   - Set the Webhook URL to:
     `https://tandoori-agent.vercel.app/api/webhook/wa-akg`
5. In ORDERiQ's production environment variables on Vercel:
   - `WA_AKG_BASE_URL=https://your-wa-akg-domain.railway.app`
   - `WA_AKG_API_KEY=wag_...`
   - `WA_AKG_SESSION_ID=default`
