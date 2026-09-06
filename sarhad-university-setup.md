# 🎓 Sarhad University – Fall 2026 Admissions WhatsApp Agent & Portal Setup

Complete deployment and operations guide for **Sarhad University of Science & Information Technology – Distance Education Center (DEC), Alam Public School & College, Jutial, Gilgit**.

---

## 1. Dedicated Supabase Project (Already Created & Migrated)

A brand new Supabase project has been created and initialized with the dedicated admissions schema:

| Parameter | Value |
|---|---|
| **Project ID** | `ajtwkziwugcqnrscnnkn` |
| **Project Name** | `sarhad-university-admissions` |
| **Region** | `ap-south-1` (Mumbai) |
| **Project URL** (`NEXT_PUBLIC_SUPABASE_URL`) | `https://ajtwkziwugcqnrscnnkn.supabase.co` |
| **Anon Public Key** (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFqdHdreml3dWdjcW5yc2NubmtuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2Nzc5NzYsImV4cCI6MjEwNDI1Mzk3Nn0.sxR2DjSR4OPQQXRZD2i3k0FrC07iAWroT4Jb6eK6VTw` |
| **Service Role Key** | Copy from [Supabase API Settings](https://supabase.com/dashboard/project/ajtwkziwugcqnrscnnkn/settings/api) |

### Tables & Features Installed:
1. `student_leads`: CRM table storing Name, WhatsApp Phone, Program Choice, Prior Qualification, Marks %, Lead Status (`new`, `contacted`, `visit_planned`, `visited_dec`, `enrolled`), and Counselor Notes.
2. `conversations`: Active WhatsApp sessions with status (`bot` vs `human` takeover mode).
3. `messages`: Real-time chat history with timestamps, delivery receipts, and sender kind (`user`, `ai`, `human`).
4. `admissions_kb`: Live knowledge base with official Fall 2026 admission details, programs, eligibility, LMS rules, and DEC Gilgit location.
5. `claim_webhook_event` & `check_rate_limit` RPCs: Webhook idempotency and rate limiting.

---

## 2. Vercel Deployment (Same Repo Architecture)

Just like you did with your previous client, you can deploy a new dedicated instance on Vercel from your **same GitHub repository** (`origin/master`):

1. Go to **[vercel.com/new](https://vercel.com/new)**.
2. Import your GitHub repository: `junaid-devv/tandoori-agent`.
3. Project Name: `sarhad-university-admissions` (or `dec-gilgit-admissions`).
4. In **Environment Variables**, add the following:

```env
# Mode switch (activates Sarhad University Agent & Admissions Dashboard)
APP_MODE=university
NEXT_PUBLIC_APP_MODE=university

# Supabase Credentials (from Step 1)
NEXT_PUBLIC_SUPABASE_URL=https://ajtwkziwugcqnrscnnkn.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFqdHdreml3dWdjcW5yc2NubmtuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2Nzc5NzYsImV4cCI6MjEwNDI1Mzk3Nn0.sxR2DjSR4OPQQXRZD2i3k0FrC07iAWroT4Jb6eK6VTw
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_from_supabase_dashboard

# WhatsApp Meta Cloud API (Client's Number)
WHATSAPP_PHONE_NUMBER_ID=your_client_phone_number_id
WHATSAPP_ACCESS_TOKEN=your_client_meta_graph_token
WHATSAPP_VERIFY_TOKEN=sarhad_dec_gilgit_verify_token_2026
WHATSAPP_APP_SECRET=your_meta_app_secret

# AI Brain (Fastest Roman Urdu Inference)
GROQ_API_KEY=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
ORDER_AGENT_NLU_MODEL=llama-3.3-70b-versatile

# Security
RATE_LIMIT_HASH_SECRET=sarhad-university-gilgit-rate-secret-2026
```

5. Click **Deploy**.

---

## 3. Connect Meta WhatsApp Cloud API Webhook

1. Open **[Meta for Developers](https://developers.facebook.com/)** -> Your WhatsApp Business App -> **Configuration**.
2. **Callback URL**: `https://your-vercel-project.vercel.app/api/webhook`
3. **Verify Token**: `sarhad_dec_gilgit_verify_token_2026` (matching `WHATSAPP_VERIFY_TOKEN`).
4. Click **Verify and Save**.
5. Under **Webhook fields**, click **Manage** and subscribe to:
   - `messages` (inbound messages from students)
   - `message_status` (delivery & read receipts)

---

## 4. University Admissions & Counselor Dashboard

University management and admissions officers can access the dedicated dashboard at:
👉 `https://your-vercel-project.vercel.app/admissions` (or `/dashboard`)

### Key Capabilities:
- **Real-Time Student Leads CRM**: View student name, phone number, program of interest, and prior qualification.
- **Search & Filter**: Filter by Program (BBA, B.Ed, English, Urdu, Education, Health & Phys Ed), Qualification (FA/FSc, Graduation), or Lead Status (`New`, `Contacted`, `Visit Planned`, `Visited DEC`, `Enrolled`).
- **1-Click Excel/CSV Export**: Export all qualified leads with phone numbers for counselors to run calling campaigns.
- **Live WhatsApp Chat Transcript**: Click on any student to review the complete conversation history.
- **Counselor Takeover & Manual Reply**: Send a message directly from the dashboard to the student's WhatsApp.
- **Add Walk-In Student Lead**: Front desk staff at DEC Alam Public School & College Jutial can log walk-in student visits.
- **Countdown to Deadline**: Live countdown to **10 September 2026**.

---

## 5. Official University Knowledge Base Verified

- **University**: Sarhad University of Science & Information Technology
- **Center**: Distance Education Center (DEC), Alam Public School & College, Jutial, Gilgit
- **Last Date for Admission**: 10 September 2026
- **6 Programs Offered**:
  1. Education
  2. English
  3. Urdu
  4. BBA
  5. Health & Physical Education
  6. B.Ed
- **Degree Options**:
  - *After FA/FSc:* 2-Year Associate Degree Program (ADP) [equivalent to Graduation] OR 4-Year BS Program.
  - *After Graduation:* 2.5-Year BS Program.
- **Eligibility**: Minimum 45% marks in previous qualification.
- **Distance Learning & Classes**:
  - LMS ID issued upon admission.
  - 24/7 recorded video lectures accessible on personal schedule.
  - Course outline: ~25 prescribed topics per subject.
  - 70-mark semester exam paper according to university examination system.
  - **Sunday Physical Classes:** Conducted every Sunday at DEC Alam Public School Jutial, but are **100% OPTIONAL**. Ideal for working professionals, school/college teachers, and remote students.
