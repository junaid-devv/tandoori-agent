import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/branch-request";
import { apiErrorResponse } from "@/lib/api-utils";
import { getWaAkgFullStatus } from "@/lib/wa-akg-client";
import { isWaAkgProvider } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireApiSession();
  if (auth.response) {
    return auth.response;
  }

  try {
    const isWaAkg = isWaAkgProvider();
    const waAkgStatus = await getWaAkgFullStatus();

    const metaConfigured = Boolean(
      process.env.WHATSAPP_PHONE_NUMBER_ID &&
      process.env.WHATSAPP_ACCESS_TOKEN &&
      process.env.WHATSAPP_ACCESS_TOKEN.length > 20
    );

    return NextResponse.json({
      activeProvider: isWaAkg ? "wa_akg" : "meta",
      metaConfig: {
        configured: metaConfigured,
        phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || null,
        verifyTokenSet: Boolean(process.env.WHATSAPP_VERIFY_TOKEN),
      },
      waAkg: waAkgStatus,
    });
  } catch (error) {
    return apiErrorResponse(error, {
      fallback: "Failed to retrieve WhatsApp status.",
      context: "GET /api/dashboard/whatsapp/status",
    });
  }
}
