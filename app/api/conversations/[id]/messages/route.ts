import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-utils";
import { requireApiSession } from "@/lib/branch-request";
import { canAccessConversation } from "@/lib/record-access";
import { supabaseAdmin } from "@/lib/supabase-admin";

// GET /api/conversations/[id]/messages
export async function GET(
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

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(Number.parseInt(searchParams.get("limit") ?? "50", 10) || 50, 1), 100);
  const beforeSeq = Number.parseInt(searchParams.get("before_seq") ?? "", 10);

  let query = supabaseAdmin
    .from("messages")
    .select("id, ingest_seq, conversation_id, role, sender_kind, content, whatsapp_msg_id, created_at, delivery_status, delivery_error, delivery_status_updated_at, metadata")
    .eq("conversation_id", accessibleConversation.id)
    .order("ingest_seq", { ascending: false })
    .limit(limit + 1);

  if (Number.isFinite(beforeSeq)) {
    query = query.lt("ingest_seq", beforeSeq);
  }

  const { data, error } = await query;

  if (error) {
    return apiErrorResponse(error, { fallback: "Failed to load messages.", context: "conversation messages GET" });
  }

  const rows = (data ?? []) as Array<any>;
  const hasMore = rows.length > limit;
  const slicedRows = hasMore ? rows.slice(0, limit) : rows;

  const messages = slicedRows
    .map((row) => {
      const meta = (row.metadata || {}) as Record<string, any>;
      let replyButtons = meta.replyButtons as Array<{ id: string; title: string }> | undefined;
      let listSelector = meta.listSelector as { title: string; buttonText: string; rows: Array<{ id: string; title: string; description?: string }> } | undefined;
      const isUserMessage = row.role === "user" || row.sender_kind === "user";
      const isVoiceNote = Boolean(
        isUserMessage && (
          meta.isVoiceNote ||
          meta.audioUrl ||
          meta.mediaId ||
          row.content?.startsWith("🎤") ||
          row.content?.includes("[Voice note")
        )
      );
      const audioUrl = isVoiceNote ? (meta.audioUrl || (meta.mediaId ? `/api/media/${meta.mediaId}` : null)) : null;
      const transcript = isVoiceNote
        ? (meta.transcript || (row.content?.startsWith("🎤") ? row.content.replace(/^🎤\s*/, "").trim() : null))
        : null;

      // Clean assistant content so older fallback messages don't display a misleading microphone emoji
      const content = !isUserMessage && typeof row.content === "string" && row.content.startsWith("🎤 ")
        ? row.content.replace(/^🎤\s*/, "")
        : row.content;

      // Intelligent reconstruction for older assistant messages that had interactive options sent
      if (!replyButtons && !listSelector && row.role === "assistant") {
        const c = row.content || "";
        if (/order\s+confirm\s+karein|confirm\s+your\s+order|order\s+confirm\s+kaway|confirm.*add\s+more/i.test(c)) {
          replyButtons = [
            { id: "confirm:yes", title: "Confirm ✓" },
            { id: "action:add_more", title: "Add More" },
          ];
        } else if (/order\s+kaise\s+chahiye|how\s+would\s+you\s+like|order\s+tsanga\s+ghwaaray/i.test(c)) {
          replyButtons = [
            { id: "ordertype:delivery", title: "Delivery" },
            { id: "ordertype:pickup", title: "Pickup" },
            { id: "ordertype:dine-in", title: "Dine-in" },
          ];
        } else if (/delivery\s+address\?|pichla\s+address|pakhwanay\s+address/i.test(c)) {
          replyButtons = [
            { id: "addr:saved", title: "Use Saved" },
            { id: "addr:new", title: "New Address" },
          ];
        } else if (/menu\s+categories|kuma\s+category|kaunsi\s+category|what\s+would\s+you\s+like|nan\s+tse\s+order/i.test(c)) {
          const bulletItems: string[] = [];
          for (const line of c.split("\n")) {
            const trimmed = line.trim();
            if (trimmed.startsWith("•") || trimmed.startsWith("-")) {
              bulletItems.push(trimmed.replace(/^[•\-]\s*/, "").trim());
            }
          }
          if (bulletItems.length > 0) {
            listSelector = {
              title: "Menu Categories",
              buttonText: "View Categories",
              rows: bulletItems.map((cat, idx) => ({ id: `cat:${idx}`, title: cat })),
            };
          }
        }
      }

      return {
        id: row.id,
        ingest_seq: row.ingest_seq,
        conversation_id: row.conversation_id,
        role: row.role,
        sender_kind: row.sender_kind,
        content,
        whatsapp_msg_id: row.whatsapp_msg_id,
        created_at: row.created_at,
        delivery_status: row.delivery_status,
        delivery_error: row.delivery_error,
        delivery_status_updated_at: row.delivery_status_updated_at,
        replyButtons,
        listSelector,
        audioUrl,
        isVoiceNote,
        transcript,
      };
    })
    .sort((left, right) => {
      const leftTime = new Date(left.created_at).getTime();
      const rightTime = new Date(right.created_at).getTime();
      const leftValid = Number.isFinite(leftTime);
      const rightValid = Number.isFinite(rightTime);

      if (leftValid && rightValid && leftTime !== rightTime) {
        return leftTime - rightTime;
      }
      if (leftValid && !rightValid) return -1;
      if (!leftValid && rightValid) return 1;

      return left.ingest_seq - right.ingest_seq;
    });

  return NextResponse.json({
    messages,
    hasMore,
    nextBeforeSeq: messages[0]?.ingest_seq ?? null,
  });
}

// DELETE /api/conversations/[id]/messages — clear message history and reset state (keeps contact & conversation)
export async function DELETE(
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

  // 1. Delete all messages for this conversation
  const { error: deleteError } = await supabaseAdmin
    .from("messages")
    .delete()
    .eq("conversation_id", accessibleConversation.id);

  if (deleteError) {
    return apiErrorResponse(deleteError, { fallback: "Failed to delete messages.", context: "conversation messages DELETE" });
  }

  // 2. Reset conversation_states to fresh greeting state and clean cart/address
  try {
    const { stateRepo } = await import("@/lib/data/state.repo");
    await stateRepo.patch(accessibleConversation.id, {
      stage: "greeting",
      resume_stage: null,
      cart: [],
      order_type: null,
      address: null,
      guests: null,
      reservation_time: null,
      pickup_time: null,
      customer_instructions: null,
      last_shown_options: [],
      last_shown_options_at: null,
      last_shown_category: null,
      pending_clarification: null,
      upsell_item_name: null,
      upsell_item_price: null,
      upsell_offered: false,
      declined_upsells: [],
      summary_sent_at: null,
      last_error: null,
      is_bot_active: true,
      invalid_step_count: 0,
      consecutive_tool_failures: 0,
      anger_level: 0,
      last_intent: null,
      escalation_reason: null,
      escalated_at: null,
    });
  } catch (err) {
    console.error("[conversation messages DELETE] Failed to reset conversation state:", err);
  }

  // 3. Mark conversation unread false and reset mode to agent
  await supabaseAdmin
    .from("conversations")
    .update({
      has_unread: false,
      mode: "agent",
      updated_at: new Date().toISOString(),
    })
    .eq("id", accessibleConversation.id);

  return NextResponse.json({ success: true, message: "Chat messages cleared and state reset." });
}
