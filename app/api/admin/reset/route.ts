import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, readLimitedJsonBody } from "@/lib/api-utils";
import { wipeOperationalData } from "@/lib/admin";
import { requireAdminApiSession } from "@/lib/admin-request";

type ResetBody = {
  branch_id?: string | null;
  confirmation?: string | null;
};

const WIPE_ALL_CONFIRMATION = "WIPE ALL OPERATIONAL DATA";
const RESET_BODY_LIMIT_BYTES = 4 * 1024;

function expectedBranchConfirmation(branchId: string) {
  return `WIPE BRANCH ${branchId}`;
}

function validateResetConfirmation(body: ResetBody) {
  const branchId = body.branch_id?.trim() || null;
  const confirmation = body.confirmation?.trim() || "";

  if (!branchId && confirmation !== WIPE_ALL_CONFIRMATION) {
    return "Type the exact confirmation phrase before wiping all operational data.";
  }

  if (branchId && confirmation !== expectedBranchConfirmation(branchId)) {
    return "Type the exact confirmation phrase before wiping branch operational data.";
  }

  return null;
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminApiSession();
  if (auth.response) {
    return auth.response;
  }

  try {
    const body = await readLimitedJsonBody<ResetBody>(req, RESET_BODY_LIMIT_BYTES);
    const confirmationError = validateResetConfirmation(body);
    if (confirmationError) {
      return NextResponse.json({ error: confirmationError }, { status: 400 });
    }

    await wipeOperationalData(auth.session.restaurantId ?? "", { branchId: body.branch_id?.trim() || null });
    return NextResponse.json({ success: true });
  } catch (error) {
    return apiErrorResponse(error, {
      fallback: "Failed to wipe operational data.",
      context: "admin reset POST",
    });
  }
}
