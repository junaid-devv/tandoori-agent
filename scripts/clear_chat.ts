import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials");
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log("Clearing all messages...");
  const { error: msgErr } = await supabaseAdmin.from("messages").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (msgErr) console.error("Error clearing messages:", msgErr);
  else console.log("Messages cleared.");

  console.log("Clearing all conversations...");
  const { error: convErr } = await supabaseAdmin.from("conversations").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (convErr) console.error("Error clearing conversations:", convErr);
  else console.log("Conversations cleared.");
}

main().catch(console.error);
