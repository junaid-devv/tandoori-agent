import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, readLimitedJsonBody } from "@/lib/api-utils";
import { createStaffAccount, listStaffMembers } from "@/lib/admin";
import { requireAdminApiSession } from "@/lib/admin-request";

type StaffBody = {
  email?: string;
  password?: string;
  full_name?: string;
  role?: "admin" | "branch_staff";
  default_branch_id?: string | null;
  branch_ids?: string[];
};

const STAFF_BODY_LIMIT_BYTES = 16 * 1024;

export async function GET() {
  const auth = await requireAdminApiSession();
  if (auth.response) {
    return auth.response;
  }

  try {
    if (!auth.session.restaurantId) {
      return NextResponse.json([]);
    }
    const staff = await listStaffMembers(auth.session.restaurantId);
    return NextResponse.json(staff);
  } catch (error) {
    return apiErrorResponse(error, { fallback: "Failed to load staff.", context: "admin staff GET" });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminApiSession();
  if (auth.response) {
    return auth.response;
  }

  try {
    if (!auth.session.restaurantId) {
      return NextResponse.json({ error: "No restaurant context." }, { status: 400 });
    }
    const body = await readLimitedJsonBody<StaffBody>(req, STAFF_BODY_LIMIT_BYTES);
    const userId = await createStaffAccount(auth.session.restaurantId, {
      email: body.email ?? "",
      password: body.password ?? "",
      fullName: body.full_name ?? "",
      role: body.role ?? "branch_staff",
      defaultBranchId: body.default_branch_id ?? null,
      branchIds: body.branch_ids ?? [],
    });

    return NextResponse.json({ success: true, userId });
  } catch (error) {
    const validationMessage = error instanceof Error ? error.message : "Failed to create staff account.";
    const status = /required|least|must/i.test(validationMessage) ? 400 : 500;
    return status === 400
      ? NextResponse.json({ error: validationMessage }, { status })
      : apiErrorResponse(error, { fallback: "Failed to create staff account.", context: "admin staff POST" });
  }
}
