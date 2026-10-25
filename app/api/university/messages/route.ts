import { requireUniversityAdmin } from "@/lib/legacy-api-access";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendWhatsAppMessage } from "@/lib/whatsapp";

export async function GET(request: NextRequest) {
  const denied = await requireUniversityAdmin();
  if (denied) return denied;
  try {
    const { searchParams } = new URL(request.url);
    const phone = searchParams.get("phone");

    if (!phone) {
      return NextResponse.json({ error: "Phone is required" }, { status: 400 });
    }

    const cleanPhone = phone.replace(/[^0-9+]/g, "").replace(/^\+/, "");

    const { data: conv } = await supabaseAdmin
      .from("conversations")
      .select("id, mode, contact_name")
      .eq("phone", cleanPhone)
      .maybeSingle();

    if (!conv) {
      return NextResponse.json({ messages: [], mode: "bot" });
    }

    const { data: messages, error } = await supabaseAdmin
      .from("messages")
      .select("id, role, sender_kind, content, delivery_status, created_at")
      .eq("conversation_id", conv.id)
      .order("created_at", { ascending: true })
      .limit(100);

    if (error) {
      console.error("[api/university/messages] GET error:", error);
      return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
    }

    return NextResponse.json({
      conversationId: conv.id,
      mode: conv.mode,
      contactName: conv.contact_name,
      messages: messages || [],
    });
  } catch (error) {
    console.error("[api/university/messages] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireUniversityAdmin();
  if (denied) return denied;
  try {
    const body = await request.json();
    const { phone, content, toggleMode } = body;

    if (!phone) {
      return NextResponse.json({ error: "Phone is required" }, { status: 400 });
    }

    const cleanPhone = phone.replace(/[^0-9+]/g, "").replace(/^\+/, "");

    const { data: conv } = await supabaseAdmin
      .from("conversations")
      .select("id, mode")
      .eq("phone", cleanPhone)
      .maybeSingle();

    if (!conv) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    // Toggle human takeover vs bot mode
    if (toggleMode) {
      const nextMode = conv.mode === "human" ? "bot" : "human";
      await supabaseAdmin
        .from("conversations")
        .update({ mode: nextMode, updated_at: new Date().toISOString() })
        .eq("id", conv.id);

      return NextResponse.json({ success: true, mode: nextMode });
    }

    // Send manual counselor message
    if (!content || !content.trim()) {
      return NextResponse.json({ error: "Content is required" }, { status: 400 });
    }

    // 1. Send via WhatsApp
    await sendWhatsAppMessage(cleanPhone, content.trim());

    // 2. Persist in messages table
    await supabaseAdmin.from("messages").insert({
      conversation_id: conv.id,
      role: "assistant",
      sender_kind: "human",
      content: content.trim(),
      delivery_status: "sent",
    });

    // 3. Update conversation last message
    await supabaseAdmin
      .from("conversations")
      .update({
        last_message: content.trim(),
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", conv.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[api/university/messages] POST error:", error);
    return NextResponse.json({ error: "Failed to send counselor message" }, { status: 500 });
  }
}
