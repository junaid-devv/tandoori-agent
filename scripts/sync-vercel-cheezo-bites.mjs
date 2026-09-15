import crypto from 'crypto';

const token = 'vcp_0nnL6eqSHYgfwokdrIaU1qZB1Fr3pDZz8zGOeJQQO50bDPj7wH3c250l';
const projectId = 'cheezo-bites';

// Dedicated variables for Cheezo Bites client
const varsToSet = {
  // Supabase (Dedicated Cheezo Bites Project: ohghccpgpzszmajridmn)
  NEXT_PUBLIC_SUPABASE_URL: 'https://ohghccpgpzszmajridmn.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9oZ2hjY3BncHpzem1hanJpZG1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0NzQ0MTQsImV4cCI6MjEwNTA1MDQxNH0.bHSVjAKGF2gowUJDIsD4lD-UEJ0JbkUWwHJQc0kWJO0',
  SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9oZ2hjY3BncHpzem1hanJpZG1uIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4OTQ3NDQxNCwiZXhwIjoyMTA1MDUwNDE0fQ.NEpBfe81Nhy6KjwtaZxSqrfZlsDIutmkYNATetHIO2s',

  // Branding & Configuration for Cheezo Bites
  NEXT_PUBLIC_APP_NAME: 'Cheezo Bites',
  NEXT_PUBLIC_BRAND_COLOR: '#E59819',
  NEXT_PUBLIC_BRAND_HOVER_COLOR: '#C27803',
  NEXT_PUBLIC_LOGO_URL: '/cheezo-bites-logo.jpg',
  NEXT_PUBLIC_APP_CITY: 'Islamabad',
  NEXT_PUBLIC_APP_CURRENCY: 'Rs.',
  RESTAURANT_BRANCH_MODE: 'single',
  RESTAURANT_TIMEZONE: 'Asia/Karachi',
  NEXT_PUBLIC_APP_PHONE_DELIVERY: 'Update delivery phone',
  NEXT_PUBLIC_APP_PHONE_DINE_IN: 'Update dine-in phone',
  NEXT_PUBLIC_AI_PERSONALITY: 'Warm, energetic, and helpful Cheezo Bites ordering assistant',

  // Fresh, unique security secrets (NOT copied from other projects)
  WHATSAPP_VERIFY_TOKEN: `cheezo_bites_${crypto.randomBytes(12).toString('hex')}`,
  RATE_LIMIT_HASH_SECRET: crypto.randomBytes(24).toString('base64url'),
  HEALTHCHECK_SECRET: crypto.randomBytes(24).toString('base64url'),

  // AI Providers (Shared inference backend)
  GROQ_API_KEY: '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',
  GROQ_AUDIO_TRANSCRIPTION_MODEL: 'whisper-large-v3-turbo',
  ORDER_AGENT_NLU_MODEL: 'llama-3.3-70b-versatile',
  GOOGLE_AI_API_KEY: 'AIzaSyDsU6GdegXspaB448VwtVbSrMaTKbIxJgg',
  AI_REQUEST_TIMEOUT_MS: '15000',
  MENU_AI_REQUEST_TIMEOUT_MS: '25000',

  // WhatsApp / Meta Cloud API (Client placeholders)
  WHATSAPP_PHONE_NUMBER_ID: 'replace_with_client_phone_number_id',
  WHATSAPP_ACCESS_TOKEN: 'replace_with_client_access_token',
  WHATSAPP_APP_SECRET: 'replace_with_client_app_secret',
  WHATSAPP_REQUEST_TIMEOUT_MS: '15000',

  // Limits & Defaults
  LOGIN_RATE_LIMIT_ATTEMPTS: '8',
  LOGIN_RATE_LIMIT_WINDOW_SECONDS: '900',
  LOGIN_RATE_LIMIT_BLOCK_SECONDS: '900',
  WHATSAPP_WEBHOOK_RATE_LIMIT_EVENTS: '600',
  WHATSAPP_WEBHOOK_RATE_LIMIT_WINDOW_SECONDS: '60',
  WHATSAPP_WEBHOOK_RATE_LIMIT_BLOCK_SECONDS: '60',
  WEBHOOK_STORE_RAW_BODY: 'false',
  WEBHOOK_RETAIN_PROCESSED_PAYLOAD: 'false',
  ADMIN_RESET_ENABLED: 'false'
};

async function syncFresh() {
  console.log(`Connecting to Vercel project: ${projectId}...`);
  const getRes = await fetch(`https://api.vercel.com/v10/projects/${projectId}/env`, {
    headers: { Authorization: 'Bearer ' + token }
  });
  const data = await getRes.json();
  const currentEnvs = data.envs || [];
  console.log(`Current env count in ${projectId}:`, currentEnvs.length);

  // 1. Delete ALL existing variables for the keys we want to set, to ensure fresh clean encrypted creation
  for (const env of currentEnvs) {
    if (env.key in varsToSet) {
      await fetch(`https://api.vercel.com/v9/projects/${projectId}/env/${env.id}`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + token }
      });
      console.log(`Cleared previous: ${env.key}`);
    }
  }

  // 2. Fresh POST each variable with encrypted value
  let createdCount = 0;
  for (const [key, value] of Object.entries(varsToSet)) {
    const postRes = await fetch(`https://api.vercel.com/v10/projects/${projectId}/env`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key,
        value,
        type: 'encrypted',
        target: ['production', 'preview', 'development']
      })
    });

    if (postRes.ok) {
      createdCount++;
      console.log(`✅ Created: ${key} = ${value.slice(0, 25)}...`);
    } else {
      console.error(`❌ Failed to create ${key}:`, await postRes.text());
    }
  }

  console.log(`\n🎉 Successfully configured ${createdCount} clean, isolated variables on Vercel project ${projectId}!`);
}

syncFresh().catch(console.error);
