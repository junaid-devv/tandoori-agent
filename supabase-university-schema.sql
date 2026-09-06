-- =============================================================================
-- SARHAD UNIVERSITY – FALL 2026 ADMISSIONS
-- DISTANCE EDUCATION CENTER (DEC), ALAM PUBLIC SCHOOL & COLLEGE, JUTIAL, GILGIT
-- Database Schema for WhatsApp Admissions AI Agent & Lead Management Portal
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Student Leads CRM Table
CREATE TABLE IF NOT EXISTS student_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL UNIQUE,
  full_name TEXT,
  program_interest TEXT, -- 'Education', 'English', 'Urdu', 'BBA', 'Health & Physical Education', 'B.Ed'
  degree_level TEXT,     -- '2-Year ADP', '4-Year BS', '2.5-Year BS'
  prior_qualification TEXT, -- 'FA/FSc', 'Graduation / BA / BSc', etc.
  percentage_marks NUMERIC,
  eligibility_confirmed BOOLEAN DEFAULT FALSE,
  lead_status TEXT DEFAULT 'new', -- 'new', 'contacted', 'visit_planned', 'visited_dec', 'enrolled', 'lost'
  source TEXT DEFAULT 'meta_ad',  -- 'meta_ad', 'organic_whatsapp', 'referral', 'dec_walkin'
  campaign_id TEXT,
  counselor_notes TEXT,
  last_message_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_leads_phone ON student_leads(phone);
CREATE INDEX IF NOT EXISTS idx_student_leads_status ON student_leads(lead_status);
CREATE INDEX IF NOT EXISTS idx_student_leads_program ON student_leads(program_interest);
CREATE INDEX IF NOT EXISTS idx_student_leads_created_at ON student_leads(created_at DESC);

-- 2. Conversations Table
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL UNIQUE,
  contact_name TEXT,
  mode TEXT DEFAULT 'bot', -- 'bot', 'human'
  unread_count INT DEFAULT 0,
  last_message TEXT,
  last_message_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversations_phone ON conversations(phone);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);

-- 3. Messages Table
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL, -- 'user', 'assistant', 'system'
  sender_kind TEXT DEFAULT 'ai', -- 'user', 'ai', 'human', 'system'
  content TEXT NOT NULL,
  raw_payload JSONB,
  whatsapp_msg_id TEXT,
  delivery_status TEXT DEFAULT 'delivered', -- 'pending', 'sent', 'delivered', 'read', 'failed'
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_whatsapp_msg_id ON messages(whatsapp_msg_id);

-- 4. Conversation States Table (for locking and multi-turn state tracking)
CREATE TABLE IF NOT EXISTS conversation_states (
  conversation_id UUID PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  stage TEXT DEFAULT 'idle',
  student_name TEXT,
  program_interest TEXT,
  prior_qualification TEXT,
  marks_percentage NUMERIC,
  intent_history TEXT[] DEFAULT '{}',
  processing_token TEXT,
  processing_started_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Dynamic Admissions Knowledge Base
CREATE TABLE IF NOT EXISTS admissions_kb (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed Official Knowledge Base Data
INSERT INTO admissions_kb (key, title, content, category)
VALUES
(
  'overview',
  'Sarhad University Fall 2026 Admissions Overview',
  'Sarhad University Fall 2026 Admissions are open at the Distance Education Center (DEC), Alam Public School & College, Jutial, Gilgit. Last date is 10 September 2026.',
  'general'
),
(
  'programs',
  'Programs Offered',
  'Programs available: 1. Education, 2. English, 3. Urdu, 4. BBA, 5. Health & Physical Education, 6. B.Ed.',
  'academics'
),
(
  'program_options',
  'Degree Options by Qualification',
  'After FA/FSc: 2-Year Associate Degree Program (ADP) [equivalent to Graduation] OR 4-Year BS Program. After Graduation: 2.5-Year BS Program.',
  'academics'
),
(
  'eligibility',
  'Eligibility Criteria',
  'Minimum 45% marks required. FA/FSc students can apply for 2-Year ADP or 4-Year BS. Graduation/ADP holders can apply for 2.5-Year BS.',
  'admission'
),
(
  'admission_procedure',
  'Step-by-Step Admission Procedure',
  '1. Select desired program. 2. Visit DEC Alam Public School & College, Jutial, Gilgit for guidance and registration. 3. Submit required educational documents and complete admission. 4. After confirmation, receive LMS ID. 5. Recorded video lectures available through LMS. 6. Study lectures at your own schedule. 7. Receive course outline. 8. Prepare ~25 prescribed topics per subject. 9. Exam paper prepared from course outline. 10. Semester exam 70-mark paper.',
  'admission'
),
(
  'physical_classes',
  'Physical Classes and Distance Learning',
  'Physical classes conducted every Sunday at DEC Alam Public School & College, Jutial, Gilgit. Sunday physical classes are OPTIONAL. Students who cannot attend can study anytime via recorded LMS lectures. Especially suitable for job holders, teachers, and working professionals.',
  'academics'
),
(
  'center_location',
  'Admission Center Location & Deadline',
  'Distance Education Center (DEC), Alam Public School & College, Jutial, Gilgit. Last date for admission: 10 September 2026.',
  'contact'
)
ON CONFLICT (key) DO UPDATE
SET title = EXCLUDED.title, content = EXCLUDED.content, category = EXCLUDED.category, updated_at = now();

-- 6. Webhook Events Table (Idempotency)
CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'pending',
  payload JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_event_id ON webhook_events(event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON webhook_events(status);

-- 7. Rate Limits Table
CREATE TABLE IF NOT EXISTS rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  request_count INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT rate_limits_identifier_window_unique UNIQUE (identifier, window_start)
);

-- 8. Claim Webhook Event RPC (Atomic claiming)
CREATE OR REPLACE FUNCTION claim_webhook_event(p_event_id TEXT, p_payload JSONB DEFAULT NULL)
RETURNS TABLE (claimed BOOLEAN, payload JSONB)
LANGUAGE plpgsql
AS $$
DECLARE
  v_row webhook_events%ROWTYPE;
BEGIN
  INSERT INTO webhook_events (event_id, status, payload)
  VALUES (p_event_id, 'processing', p_payload)
  ON CONFLICT (event_id) DO NOTHING
  RETURNING * INTO v_row;

  IF FOUND THEN
    RETURN QUERY SELECT TRUE, v_row.payload;
    RETURN;
  END IF;

  SELECT * INTO v_row FROM webhook_events WHERE event_id = p_event_id;
  IF v_row.status = 'failed' THEN
    UPDATE webhook_events
    SET status = 'processing', error_message = NULL
    WHERE event_id = p_event_id;
    RETURN QUERY SELECT TRUE, v_row.payload;
    RETURN;
  END IF;

  RETURN QUERY SELECT FALSE, v_row.payload;
END;
$$;

-- 9. Check Rate Limit RPC
CREATE OR REPLACE FUNCTION check_rate_limit(p_key TEXT, p_limit INT, p_window_seconds INT)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_count INT;
BEGIN
  v_window_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  INSERT INTO rate_limits (identifier, window_start, request_count)
  VALUES (p_key, v_window_start, 1)
  ON CONFLICT (identifier, window_start)
  DO UPDATE SET request_count = rate_limits.request_count + 1
  RETURNING request_count INTO v_count;

  RETURN v_count <= p_limit;
END;
$$;

-- 10. Upsert Student Lead RPC
CREATE OR REPLACE FUNCTION upsert_student_lead(
  p_phone TEXT,
  p_full_name TEXT DEFAULT NULL,
  p_program_interest TEXT DEFAULT NULL,
  p_degree_level TEXT DEFAULT NULL,
  p_prior_qualification TEXT DEFAULT NULL,
  p_percentage_marks NUMERIC DEFAULT NULL,
  p_lead_status TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'meta_ad',
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO student_leads (
    phone, full_name, program_interest, degree_level, prior_qualification,
    percentage_marks, lead_status, source, counselor_notes, last_message_at, updated_at
  )
  VALUES (
    p_phone, p_full_name, p_program_interest, p_degree_level, p_prior_qualification,
    p_percentage_marks, COALESCE(p_lead_status, 'new'), COALESCE(p_source, 'meta_ad'), p_notes, now(), now()
  )
  ON CONFLICT (phone) DO UPDATE
  SET
    full_name = COALESCE(EXCLUDED.full_name, student_leads.full_name),
    program_interest = COALESCE(EXCLUDED.program_interest, student_leads.program_interest),
    degree_level = COALESCE(EXCLUDED.degree_level, student_leads.degree_level),
    prior_qualification = COALESCE(EXCLUDED.prior_qualification, student_leads.prior_qualification),
    percentage_marks = COALESCE(EXCLUDED.percentage_marks, student_leads.percentage_marks),
    lead_status = COALESCE(EXCLUDED.lead_status, student_leads.lead_status),
    counselor_notes = CASE
      WHEN EXCLUDED.counselor_notes IS NOT NULL AND student_leads.counselor_notes IS NOT NULL
        THEN student_leads.counselor_notes || E'\n' || EXCLUDED.counselor_notes
      ELSE COALESCE(EXCLUDED.counselor_notes, student_leads.counselor_notes)
    END,
    last_message_at = now(),
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
