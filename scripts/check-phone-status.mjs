const token = process.argv[2] || process.env.WHATSAPP_ACCESS_TOKEN;
const phoneId = process.argv[3] || "1313400865187977";
const fields = "id,display_phone_number,verified_name,code_verification_status,platform_type,quality_rating";

if (!token) {
  console.error("Usage: node scripts/check-phone-status.mjs <YOUR_ACCESS_TOKEN> [PHONE_NUMBER_ID]");
  process.exit(1);
}

async function check() {
  const url = `https://graph.facebook.com/v21.0/${phoneId}?fields=${fields}`;
  console.log(`Querying Meta Graph API for Phone ID: ${phoneId}...`);

  try {
    const res = await fetch(url, {
      headers: { Authorization: "Bearer " + token },
    });
    const data = await res.json();
    console.log("\n--- RESULT ---");
    console.log("HTTP Status:", res.status);
    console.log(JSON.stringify(data, null, 2));

    if (data.platform_type) {
      console.log("\n==========================================");
      console.log("PLATFORM TYPE:", data.platform_type);
      console.log("VERIFICATION STATUS:", data.code_verification_status);
      console.log("QUALITY RATING:", data.quality_rating);
      console.log("==========================================");
    }
  } catch (err) {
    console.error("Request failed:", err.message);
  }
}

check();
