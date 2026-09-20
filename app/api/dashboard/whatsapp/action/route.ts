import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/branch-request";
import { apiErrorResponse, readLimitedJsonBody } from "@/lib/api-utils";
import { performWaAkgAction } from "@/lib/wa-akg-client";

export const dynamic = "force-dynamic";

type WhatsAppActionBody = {
  action: "start" | "stop" | "restart" | "logout" | "pair" | "create_session" | "auto_webhook";
  phoneNumber?: string;
  webhookUrl?: string;
};

export async function POST(req: NextRequest) {
  const auth = await requireApiSession();
  if (auth.response) {
    return auth.response;
  }

  try {
    const body = await readLimitedJsonBody<WhatsAppActionBody>(req, 64 * 1024);
    const { action, phoneNumber, webhookUrl } = body;

    const validActions = ["start", "stop", "restart", "logout", "pair", "create_session", "auto_webhook"];
    if (!action || !validActions.includes(action)) {
      return NextResponse.json(
        { error: `Invalid action. Must be one of: ${validActions.join(", ")}` },
        { status: 400 }
      );
    }

    const result = await performWaAkgAction(action, { phoneNumber, webhookUrl });
    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error, {
      fallback: "Failed to execute WhatsApp gateway action.",
      context: "POST /api/dashboard/whatsapp/action",
    });
  }
}
