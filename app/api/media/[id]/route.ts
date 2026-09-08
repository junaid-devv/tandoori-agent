import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/branch-request";
import { getWhatsAppMediaUrl, downloadWhatsAppMedia } from "@/lib/whatsapp";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiSession();
  if (auth.response || !auth.session) {
    return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Media ID required" }, { status: 400 });
  }

  try {
    // 1. Try Supabase Storage first
    const { data: fileData, error: downloadError } = await supabaseAdmin.storage
      .from("voice-notes")
      .download(id);

    if (!downloadError && fileData) {
      const buffer = await fileData.arrayBuffer();
      return new Response(buffer, {
        headers: {
          "Content-Type": fileData.type || "audio/ogg",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    // 2. Fetch from WhatsApp Cloud API
    const mediaUrl = await getWhatsAppMediaUrl(id);
    const audioBuffer = await downloadWhatsAppMedia(mediaUrl);

    // Cache to storage for future instant playback (fire-and-forget)
    void supabaseAdmin.storage
      .from("voice-notes")
      .upload(id, audioBuffer, { contentType: "audio/ogg", upsert: true })
      .catch(() => {});

    return new Response(audioBuffer, {
      headers: {
        "Content-Type": "audio/ogg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (error: any) {
    console.error("[media-proxy] Failed to serve media:", error);
    return NextResponse.json(
      { error: error?.message || "Media not available" },
      { status: 404 }
    );
  }
}
