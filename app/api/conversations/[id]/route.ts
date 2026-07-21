import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, readLimitedJsonBody, requireTrimmedString } from "@/lib/api-utils";
import { requireApiSession } from "@/lib/branch-request";
import { resumeBotForConversation } from "@/lib/handoff";
import { persistSystemMessage, sendAndPersistOutboundMessage } from "@/lib/messages";
import { canAccessConversation } from "@/lib/record-access";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getOrCreateUserSession, updateUserSession } from "@/lib/user-session";

type ConversationPatchBody = {
  mode?: "agent" | "human";
  has_unread?: boolean;
  customer_notes?: string | null;
  customer_tags?: string[];
};

type ManualMessageBody = {
  message?: string;
};

const CONVERSATION_PATCH_BODY_LIMIT_BYTES = 2 * 1024;
const MANUAL_MESSAGE_BODY_LIMIT_BYTES = 8 * 1024;
const MANUAL_MESSAGE_MAX_CHARS = 3500;

function buildModeChangeNote(mode: "agent" | "human") {
  return mode === "agent"
    ? "AI agent was re-enabled for this conversation."
    : "Conversation was handed over to a human operator.";
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiSession();
  if (auth.response || !auth.session) {
    return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const accessibleConversation = await canAccessConversation(auth.session, id);
  if (!accessibleConversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const { data, error } = await supabaseAdmin
    .from("conversations")
    .select(`
      id,
      branch_id,
      phone,
      name,
      mode,
      has_unread,
      updated_at,
      created_at,
      branches (id, name, slug, address),
      contacts (
        id,
        preferred_language,
        tags,
        notes,
        total_orders,
        last_order_at,
        customer_addresses (
          id,
          label,
          address,
          use_count,
          last_used_at
        )
      ),
      conversation_states (
        workflow_step,
        order_type,
        address,
        guests,
        reservation_time,
        pickup_time,
        cart,
        last_error
      ),
      user_sessions (
        active_node,
        status,
        is_bot_active,
        invalid_step_count,
        escalation_reason,
        escalated_at
      )
    `)
    .eq("id", accessibleConversation.id)
    .single();

  if (error || !data) {
    if (error) {
      return apiErrorResponse(error, { fallback: "Failed to load conversation.", context: "conversation GET" });
    }
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}

// PATCH /api/conversations/[id] — update mode or has_unread
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiSession();
  if (auth.response || !auth.session) {
    return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const accessibleConversation = await canAccessConversation(auth.session, id);
  if (!accessibleConversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  let body: ConversationPatchBody;
  try {
    body = await readLimitedJsonBody<ConversationPatchBody>(req, CONVERSATION_PATCH_BODY_LIMIT_BYTES);
  } catch (error) {
    return apiErrorResponse(error, { fallback: "Invalid conversation update request.", context: "conversation PATCH" });
  }
  const { mode, has_unread } = body;
  let previousMode: "agent" | "human" | null = null;
  const shouldUpdateCustomerProfile =
    "customer_notes" in body || "customer_tags" in body;

  const updates: Record<string, boolean | "agent" | "human"> = {};
  if (mode !== undefined) {
    if (!["agent", "human"].includes(mode)) {
      return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
    }
    const { data: existingConversation } = await supabaseAdmin
      .from("conversations")
      .select("mode")
      .eq("id", accessibleConversation.id)
      .maybeSingle();
    previousMode = existingConversation?.mode ?? null;
    updates.mode = mode;
  }
  
  if (has_unread !== undefined) {
    updates.has_unread = has_unread;
  }

  if (Object.keys(updates).length === 0 && !shouldUpdateCustomerProfile) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data: currentConversation, error: currentConversationError } = shouldUpdateCustomerProfile
    ? await supabaseAdmin
        .from("conversations")
        .select("contact_id")
        .eq("id", accessibleConversation.id)
        .maybeSingle()
    : { data: null, error: null };

  if (currentConversationError) {
    return apiErrorResponse(currentConversationError, { fallback: "Failed to load customer profile.", context: "conversation PATCH contact lookup" });
  }

  if (shouldUpdateCustomerProfile && currentConversation?.contact_id) {
    const customerUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if ("customer_notes" in body) {
      customerUpdates.notes = typeof body.customer_notes === "string" && body.customer_notes.trim()
        ? body.customer_notes.trim().slice(0, 1000)
        : null;
    }
    if ("customer_tags" in body) {
      customerUpdates.tags = Array.isArray(body.customer_tags)
        ? [...new Set(body.customer_tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))].slice(0, 12)
        : [];
    }
    const { error: customerError } = await supabaseAdmin
      .from("contacts")
      .update(customerUpdates)
      .eq("id", currentConversation.contact_id);
    if (customerError) {
      return apiErrorResponse(customerError, { fallback: "Failed to update customer profile.", context: "conversation PATCH customer" });
    }
  }

  let data: unknown = null;
  if (Object.keys(updates).length > 0) {
    const result = await supabaseAdmin
      .from("conversations")
      .update(updates)
      .eq("id", accessibleConversation.id)
      .select()
      .single();
    data = result.data;
    if (result.error) {
      return apiErrorResponse(result.error, { fallback: "Failed to update conversation.", context: "conversation PATCH" });
    }
  } else {
    const result = await supabaseAdmin
      .from("conversations")
      .select()
      .eq("id", accessibleConversation.id)
      .single();
    data = result.data;
    if (result.error) {
      return apiErrorResponse(result.error, { fallback: "Failed to load conversation.", context: "conversation PATCH reload" });
    }
  }

  if (mode !== undefined && previousMode && previousMode !== mode) {
    await persistSystemMessage(accessibleConversation.id, buildModeChangeNote(mode)).catch((persistError) => {
      console.error("[conversation PATCH] Failed to persist mode change note:", persistError);
    });

    if (mode === "agent") {
      await resumeBotForConversation(accessibleConversation.id).catch((sessionError) => {
        console.error("[conversation PATCH] Failed to resume bot session:", sessionError);
      });
    } else {
      const session = await getOrCreateUserSession(accessibleConversation.id).catch(() => null);
      if (session) {
        await updateUserSession(accessibleConversation.id, {
          active_node: "human_handoff",
          return_node: null,
          status: "human_handoff",
          is_bot_active: false,
        }).catch((sessionError) => {
          console.error("[conversation PATCH] Failed to pause bot session:", sessionError);
        });
      }
    }
  }

  return NextResponse.json(data);
}

// POST /api/conversations/[id]/send — manual message from dashboard
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiSession();
  if (auth.response || !auth.session) {
    return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const accessibleConversation = await canAccessConversation(auth.session, id);
  if (!accessibleConversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  let message: string;
  try {
    const body = await readLimitedJsonBody<ManualMessageBody>(req, MANUAL_MESSAGE_BODY_LIMIT_BYTES);
    message = requireTrimmedString(body.message, "Message", MANUAL_MESSAGE_MAX_CHARS);
  } catch (error) {
    return apiErrorResponse(error, { fallback: "Invalid message request.", context: "conversation POST" });
  }

  // Get conversation phone
  const { data: conversation, error: convError } = await supabaseAdmin
    .from("conversations")
    .select("phone")
    .eq("id", accessibleConversation.id)
    .single();

  if (convError || !conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  try {
    const sent = await sendAndPersistOutboundMessage({
      conversationId: accessibleConversation.id,
      phone: conversation.phone,
      content: message.trim(),
      senderKind: "human",
    });

    const { data: msg, error: msgError } = await supabaseAdmin
      .from("messages")
      .select("*")
      .eq("id", sent.id)
      .single();

    if (msgError || !msg) {
      return apiErrorResponse(msgError, {
        fallback: "Message sent but could not be loaded.",
        context: "conversation POST load message",
      });
    }

    return NextResponse.json(msg);
  } catch (error) {
    return apiErrorResponse(error, { fallback: "Failed to send message.", context: "conversation POST" });
  }
}
