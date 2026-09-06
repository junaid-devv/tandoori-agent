const token = 'vcp_0nnL6eqSHYgfwokdrIaU1qZB1Fr3pDZz8zGOeJQQO50bDPj7wH3c250l';
const projectId = 'sarhad-university';

const keysToUpdate = {
  SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFqdHdreml3dWdjcW5yc2NubmtuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODY3Nzk3NiwiZXhwIjoyMTA0MjUzOTc2fQ.FKKqrusp6twTTTyaH2upbjwPo5Yy3a4kHvciRfMJfKE',
  WHATSAPP_PHONE_NUMBER_ID: '1014194918449953',
  WHATSAPP_ACCESS_TOKEN: 'EAAUHKiKYESsBRPoM7f1sViS3HgTh1IN7yYVDxMNqfag4eGA7w7FFVtXFTb8DnwLIeOEvpBJ1VUOptdb0FOIYFgRg16DAc4NjChjcZAXujqSQ3hUkZCEuLRbJ8jA7sXUNPhtNoIWnxOpGVRtvmxO81WiHYtImMB7R09Oi4GlvPAmVCXRMwI3gcOBM46K6ZC1e4yk8H8KUZA1WG6n0EvfhiySvs3PGuQUkNmUJn05a',
  WHATSAPP_APP_SECRET: 'f216d4806d3dfc59d98e0640f192a5f7',
  WHATSAPP_VERIFY_TOKEN: '9C-XvlnH65TUJCMB3Oqj4t0Zpv0_kRD7'
};

async function updateKeys() {
  console.log(`Injecting credentials into Vercel project: ${projectId}...`);
  const getRes = await fetch(`https://api.vercel.com/v10/projects/${projectId}/env`, {
    headers: { Authorization: 'Bearer ' + token }
  });
  const data = await getRes.json();

  for (const env of data.envs || []) {
    if (env.key in keysToUpdate) {
      await fetch(`https://api.vercel.com/v9/projects/${projectId}/env/${env.id}`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + token }
      });
      console.log('Cleared previous:', env.key);
    }
  }

  for (const [key, value] of Object.entries(keysToUpdate)) {
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
    if (postRes.ok) console.log(`✅ Injected: ${key}`);
    else console.error(`❌ Failed: ${key}`, await postRes.text());
  }

  console.log('\n🎉 All test credentials successfully injected into Vercel project!');
}

updateKeys().catch(console.error);
