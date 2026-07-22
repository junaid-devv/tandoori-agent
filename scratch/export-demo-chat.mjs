import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

config({ path: path.join(root, ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase URL or service role key in .env.local.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function cleanText(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

const { data: candidates, error: candidateError } = await supabase
  .from("conversations")
  .select(`
    id,
    branch_id,
    phone,
    name,
    mode,
    has_unread,
    created_at,
    updated_at,
    branches(id, name, slug, address, city),
    conversation_states(workflow_step, order_type, address, guests, reservation_time, pickup_time, cart, last_error),
    user_sessions(active_node, status, is_bot_active, invalid_step_count, escalation_reason, escalated_at),
    contacts(id, preferred_language, tags, notes, total_orders, last_order_at)
  `)
  .order("updated_at", { ascending: false })
  .limit(30);

if (candidateError) {
  throw candidateError;
}

let selected = null;
let selectedMessages = [];

for (const conversation of candidates ?? []) {
  const { data: messages, error: messageError } = await supabase
    .from("messages")
    .select("id, ingest_seq, role, sender_kind, content, created_at, delivery_status, delivery_error, delivery_status_updated_at")
    .eq("conversation_id", conversation.id)
    .order("ingest_seq", { ascending: true })
    .limit(80);

  if (messageError || !messages?.length) continue;

  const cleaned = messages
    .map((message) => ({
      ...message,
      content: cleanText(message.content),
    }))
    .filter((message) => message.content.length > 0);

  const hasCustomer = cleaned.some((message) => message.sender_kind === "user");
  const hasAssistant = cleaned.some((message) => ["ai", "assistant", "bot"].includes(message.sender_kind));
  const orderLike = cleaned.some((message) => /confirm|order|delivery|pickup|address|total|rs\.?|pkr|cart/i.test(message.content));

  if (hasCustomer && hasAssistant && orderLike) {
    selected = conversation;
    selectedMessages = cleaned;
    break;
  }
}

if (!selected) {
  throw new Error("No suitable historical customer conversation found.");
}

const output = {
  exportedAt: new Date().toISOString(),
  conversation: selected,
  messages: selectedMessages,
  orders: [],
};

const { data: orders, error: orderError } = await supabase
  .from("orders")
  .select(`
    id,
    order_number,
    type,
    status,
    subtotal,
    delivery_fee,
    address,
    customer_instructions,
    assigned_to,
    created_at,
    branches(name, slug),
    conversations(phone, name),
    order_items(id, name, qty, price, size, addons, item_instructions)
  `)
  .eq("conversation_id", selected.id)
  .order("created_at", { ascending: false })
  .limit(5);

if (!orderError && orders) {
  output.orders = orders;
}

const outputPath = path.join(root, "scratch", "actual-demo-chat.json");
writeFileSync(outputPath, JSON.stringify(output, null, 2));
writeFileSync(
  path.join(root, "scratch", "actual-demo-chat.js"),
  `window.ACTUAL_DEMO_CHAT = ${JSON.stringify(output, null, 2)};\n`,
);
console.log(outputPath);
console.log(JSON.stringify({
  conversationId: selected.id,
  branch: Array.isArray(selected.branches) ? selected.branches[0]?.name : selected.branches?.name,
  customerName: selected.name,
  phoneTail: selected.phone ? selected.phone.slice(-4) : null,
  messageCount: selectedMessages.length,
  updatedAt: selected.updated_at,
}, null, 2));
