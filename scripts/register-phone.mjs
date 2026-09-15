const token = process.argv[2];
const pin = process.argv[3];
const phoneId = process.argv[4] || "1313400865187977";

if (!token || !pin) {
  console.error("Usage: node scripts/register-phone.mjs <YOUR_ACCESS_TOKEN> <6_DIGIT_PIN> [PHONE_NUMBER_ID]");
  console.error("Example: node scripts/register-phone.mjs EAAB... 123456");
  process.exit(1);
}

async function register() {
  const url = `https://graph.facebook.com/v21.0/${phoneId}/register`;
  console.log(`Registering phone ID: ${phoneId} with Meta Cloud API...`);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        pin: String(pin),
      }),
    });

    const data = await res.json();
    console.log("\n--- RESULT ---");
    console.log("HTTP Status:", res.status);
    console.log(JSON.stringify(data, null, 2));

    if (data.success) {
      console.log("\n🎉 SUCCESS: Number registered with Cloud API!");
      console.log("You can now check WhatsApp Manager > Phone numbers to see it status: Connected.");
    }
  } catch (err) {
    console.error("Registration request failed:", err.message);
  }
}

register();
