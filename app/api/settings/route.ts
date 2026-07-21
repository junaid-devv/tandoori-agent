import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, readLimitedJsonBody } from "@/lib/api-utils";
import { resolveRequestBranch } from "@/lib/branch-request";
import {
  getRestaurantSettings,
  updateRestaurantSettings,
  validateRestaurantSettingsInput,
  type RestaurantSettings,
} from "@/lib/settings";

const SETTINGS_BODY_LIMIT_BYTES = 16 * 1024;

export async function GET(req: NextRequest) {
  try {
    const auth = await resolveRequestBranch(req, { requireBranch: true });
    if (auth.response || !auth.branchId) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const settings = await getRestaurantSettings(auth.branchId);
    return NextResponse.json(settings);
  } catch {
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await resolveRequestBranch(req, { requireBranch: true });
    if (auth.response || !auth.branchId) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await readLimitedJsonBody<Partial<RestaurantSettings>>(req, SETTINGS_BODY_LIMIT_BYTES);
    const validated = validateRestaurantSettingsInput(body);
    await updateRestaurantSettings(auth.branchId, validated);
    return NextResponse.json({ success: true });
  } catch (error) {
    const validationMessage = error instanceof Error ? error.message : "Failed to update settings";
    const status = /valid|must/i.test(validationMessage) ? 400 : 500;
    return status === 400
      ? NextResponse.json({ error: validationMessage }, { status })
      : apiErrorResponse(error, { fallback: "Failed to update settings.", context: "settings route" });
  }
}
