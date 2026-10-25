import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/branch-request";
import { getWhatsAppMediaUrl, downloadWhatsAppMedia } from "@/lib/whatsapp";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { canAccessConversation } from "@/lib/record-access";
import { withConversationWhatsApp, getWhatsAppTransport, type WhatsAppTransport } from "@/lib/whatsapp-context";
import { evolutionRequest } from "@/lib/evolution-client";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiSession();
  if (auth.response || !auth.session) return auth.response;
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Media ID required" }, { status: 400 });
  try {
    // Authorize the owning conversation before accessing storage or either gateway.
    const { data: candidates, error } = await supabaseAdmin.from("messages")
      .select("conversation_id, metadata").contains("metadata", { mediaId: id }).limit(20);
    if (error) throw error;
    let owned: { conversation_id: string; metadata: Record<string, unknown> } | null = null;
    for (const candidate of candidates || []) {
      if (await canAccessConversation(auth.session, candidate.conversation_id)) { owned = candidate; break; }
    }
    if (!owned) return NextResponse.json({ error: "Media not available" }, { status: 404 });
    const storagePath = owned.conversation_id + "/" + encodeURIComponent(id);
    const stored = await supabaseAdmin.storage.from("voice-notes").download(storagePath);
    const headers = { "Content-Type": "audio/ogg", "Cache-Control": "private, max-age=3600" };
    if (stored.data) return new Response(await stored.data.arrayBuffer(), { headers });
    const message = owned;
    const audio = await withConversationWhatsApp(message.conversation_id, async () => {
      const transport = getWhatsAppTransport();
      if (transport?.provider === "evolution") {
        if (!message.metadata.evolutionMessageKey) throw new Error("Evolution media key unavailable");
        const media = await evolutionRequest("/chat/getBase64FromMediaMessage/" + encodeURIComponent(transport.instanceName), "POST", {
          message: { key: message.metadata.evolutionMessageKey }, convertToMp4: false,
        });
        if (typeof media.base64 !== "string") throw new Error("Media not available");
        return Buffer.from(media.base64.replace(/^data:[^,]+,/, ""), "base64");
      }
      return downloadWhatsAppMedia(await getWhatsAppMediaUrl(id));
    }, { origin: message.metadata.whatsappTransport as WhatsAppTransport | undefined });
    await supabaseAdmin.storage.from("voice-notes").upload(storagePath, audio, { contentType: "audio/ogg", upsert: true });
    return new Response(audio, { headers });
  } catch (error) {
    console.error("[media-proxy] Failed to serve authorized media", error);
    return NextResponse.json({ error: "Media not available" }, { status: 404 });
  }
}
