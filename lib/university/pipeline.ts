import { supabaseAdmin } from "../supabase-admin";
import {
  sendWhatsAppMessage,
  sendWhatsAppReplyButtons,
  type WhatsAppReplyButtonPayload,
} from "../whatsapp";
import { detectUniversityFastPath } from "./intents";
import { askUniversityCounselorAI, type ChatHistoryMessage } from "./counselor-ai";
import { upsertStudentLead, getLeadByPhone } from "./lead-manager";

export async function processUniversityWebhookMessage({
  phone,
  contactName,
  messageContent,
  rawMessageId,
  phoneNumberId,
}: {
  phone: string;
  contactName: string;
  messageContent: string;
  rawMessageId?: string;
  phoneNumberId?: string;
}): Promise<void> {
  const cleanPhone = phone.replace(/[^0-9+]/g, "").replace(/^\+/, "");

  // 1. Ensure conversation exists
  let conversationId: string;
  const { data: existingConv } = await supabaseAdmin
    .from("conversations")
    .select("id, mode")
    .eq("phone", cleanPhone)
    .maybeSingle();

  if (existingConv) {
    conversationId = existingConv.id;
    // Update last message timestamp
    await supabaseAdmin
      .from("conversations")
      .update({
        last_message: messageContent,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId);
  } else {
    const { data: newConv, error: convErr } = await supabaseAdmin
      .from("conversations")
      .insert({
        phone: cleanPhone,
        contact_name: contactName || "Prospective Student",
        mode: "bot",
        last_message: messageContent,
        last_message_at: new Date().toISOString(),
      })
      .select("id, mode")
      .single();

    if (convErr || !newConv) {
      console.error("[university-pipeline] Failed to create conversation:", convErr);
      return;
    }
    conversationId = newConv.id;
  }

  // 2. Persist inbound user message
  await supabaseAdmin.from("messages").insert({
    conversation_id: conversationId,
    role: "user",
    sender_kind: "user",
    content: messageContent,
    whatsapp_msg_id: rawMessageId ?? null,
    delivery_status: "delivered",
  });

  // 3. Ensure student lead record exists in CRM
  let currentLead = await getLeadByPhone(cleanPhone);
  if (!currentLead) {
    await upsertStudentLead({
      phone: cleanPhone,
      fullName: contactName || null,
      source: "meta_ad",
      leadStatus: "new",
    });
    currentLead = await getLeadByPhone(cleanPhone);
  }

  // 4. Check if human takeover is active
  if (existingConv?.mode === "human") {
    console.log(`[university-pipeline] Conversation ${conversationId} is in human mode, skipping bot response`);
    await supabaseAdmin
      .from("conversations")
      .update({ unread_count: (existingConv as unknown as { unread_count: number }).unread_count + 1 || 1 })
      .eq("id", conversationId);
    return;
  }

  // Check if conversation has prior history
  const { count: priorMsgCount } = await supabaseAdmin
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .neq("whatsapp_msg_id", rawMessageId ?? "none");

  const hasPriorMessages = (priorMsgCount ?? 0) > 0;

  // 5. Try 0ms Fast-Path intent matcher (buttons only if prior messages exist)
  const fastPath = detectUniversityFastPath(messageContent, hasPriorMessages);
  if (fastPath) {
    let replyText = fastPath.textReply;
    let buttons = fastPath.replyButtons;

    // Send reply via WhatsApp
    await sendOutboundUniversityMessage(cleanPhone, replyText, buttons, phoneNumberId);

    // Persist outbound AI message
    await supabaseAdmin.from("messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      sender_kind: "ai",
      content: replyText,
      delivery_status: "sent",
    });

    // Update lead data if extracted
    if (fastPath.extractedLeadData) {
      await upsertStudentLead({
        phone: cleanPhone,
        programInterest: fastPath.extractedLeadData.program,
        priorQualification: fastPath.extractedLeadData.qualification,
        percentageMarks: fastPath.extractedLeadData.percentageMarks,
        fullName: fastPath.extractedLeadData.name,
      });
    }

    return;
  }

  // Load prior message history (excluding the current turn just inserted)
  const { data: recentMsgs } = await supabaseAdmin
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .neq("whatsapp_msg_id", rawMessageId ?? "no_match")
    .order("created_at", { ascending: true })
    .limit(8);

  const history: ChatHistoryMessage[] = (recentMsgs ?? []).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const aiResult = await askUniversityCounselorAI(
    messageContent,
    history,
    currentLead
      ? {
          fullName: currentLead.full_name,
          programInterest: currentLead.program_interest,
          priorQualification: currentLead.prior_qualification,
        }
      : undefined
  );

  // Send reply
  await sendOutboundUniversityMessage(cleanPhone, aiResult.replyText, null, phoneNumberId);

  // Persist outbound AI message
  await supabaseAdmin.from("messages").insert({
    conversation_id: conversationId,
    role: "assistant",
    sender_kind: "ai",
    content: aiResult.replyText,
    delivery_status: "sent",
  });

  // Update lead CRM record if new attributes were extracted by LLM
  if (aiResult.leadUpdate) {
    await upsertStudentLead({
      phone: cleanPhone,
      fullName: aiResult.leadUpdate.fullName,
      programInterest: aiResult.leadUpdate.programInterest,
      degreeLevel: aiResult.leadUpdate.degreeLevel,
      priorQualification: aiResult.leadUpdate.priorQualification,
      percentageMarks: aiResult.leadUpdate.percentageMarks,
      leadStatus: aiResult.leadUpdate.leadStatus,
      notes: aiResult.leadUpdate.notes,
    });
  }
}

async function sendOutboundUniversityMessage(
  toPhone: string,
  text: string,
  replyButtons?: WhatsAppReplyButtonPayload | null,
  phoneNumberId?: string
): Promise<void> {
  if (replyButtons && replyButtons.buttons.length > 0) {
    try {
      await sendWhatsAppReplyButtons(
        toPhone,
        {
          ...replyButtons,
          body: text,
        },
        phoneNumberId
      );
      return;
    } catch (error) {
      console.warn("[university-pipeline] Failed to send reply buttons, falling back to text:", error);
    }
  }

  await sendWhatsAppMessage(toPhone, text, phoneNumberId);
}
