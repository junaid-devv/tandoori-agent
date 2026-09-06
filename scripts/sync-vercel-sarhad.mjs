const token = 'vcp_0nnL6eqSHYgfwokdrIaU1qZB1Fr3pDZz8zGOeJQQO50bDPj7wH3c250l';
const projectId = 'sarhad-university';

// The exact clean variables for Sarhad University
const varsToSet = {
  APP_MODE: 'university',
  NEXT_PUBLIC_APP_MODE: 'university',
  NEXT_PUBLIC_APP_NAME: 'Sarhad University of Science & IT (DEC Gilgit)',
  NEXT_PUBLIC_SUPABASE_URL: 'https://ajtwkziwugcqnrscnnkn.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFqdHdreml3dWdjcW5yc2NubmtuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2Nzc5NzYsImV4cCI6MjEwNDI1Mzk3Nn0.sxR2DjSR4OPQQXRZD2i3k0FrC07iAWroT4Jb6eK6VTw',
  WHATSAPP_VERIFY_TOKEN: 'sarhad_dec_gilgit_verify_token_2026',
  GROQ_API_KEY: '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',
  ORDER_AGENT_NLU_MODEL: 'llama-3.3-70b-versatile',
  RATE_LIMIT_HASH_SECRET: 'sarhad-university-gilgit-rate-secret-2026',
  WEBHOOK_STORE_RAW_BODY: 'false',
  WEBHOOK_RETAIN_PROCESSED_PAYLOAD: 'false',
  WHATSAPP_REQUEST_TIMEOUT_MS: '15000',
  WHATSAPP_WEBHOOK_RATE_LIMIT_EVENTS: '600',
  WHATSAPP_WEBHOOK_RATE_LIMIT_WINDOW_SECONDS: '60',
  WHATSAPP_WEBHOOK_RATE_LIMIT_BLOCK_SECONDS: '60'
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
      console.log(`✅ Created: ${key} = ${value.slice(0, 30)}...`);
    } else {
      console.error(`❌ Failed to create ${key}:`, await postRes.text());
    }
  }

  console.log(`\n🎉 Successfully configured ${createdCount} clean variables on Vercel project ${projectId}!`);
}

syncFresh().catch(console.error);
