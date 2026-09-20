/**
 * scripts/test-wa-akg-webhook.mjs
 *
 * Tests the WA-AKG inbound webhook endpoint by sending a sample
 * Baileys message payload to http://localhost:3000/api/webhook/wa-akg.
 *
 * Usage:
 *   node scripts/test-wa-akg-webhook.mjs
 *   node scripts/test-wa-akg-webhook.mjs "1 chicken karahi deliver to DHA phase 5"
 */

const text = process.argv[2] || "Assalam o alaikum, menu dikhao";
const endpoint = process.env.WEBHOOK_URL || "http://localhost:3000/api/webhook/wa-akg";

const payload = {
  event: "message.received",
  sessionId: "default",
  timestamp: new Date().toISOString(),
  data: {
    key: {
      remoteJid: "923001234567@s.whatsapp.net",
      fromMe: false,
      id: `test-wamid-${Date.now()}`,
    },
    from: "923001234567@s.whatsapp.net",
    pushName: "Test Customer",
    message: {
      conversation: text,
    },
  },
};

console.log(`\n📡 Sending test message to WA-AKG webhook: ${endpoint}`);
console.log(`💬 Message: "${text}"`);

try {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json().catch(() => ({}));
  console.log(`\nResponse Status: ${response.status} ${response.statusText}`);
  console.log("Response Body:", JSON.stringify(body, null, 2));

  if (response.ok) {
    console.log("\n✅ Webhook received the message successfully! ORDERiQ is processing the turn.");
  } else {
    console.error("\n❌ Webhook returned an error:", body);
  }
} catch (err) {
  console.error("\n❌ Connection failed. Ensure ORDERiQ dev server is running on http://localhost:3000 (npm run dev)");
  console.error(err.message);
}
