import { requireOwnedAdminRecord } from "@/lib/admin-access";
import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, readLimitedJsonBody } from "@/lib/api-utils";
import { deleteStaffAccount, updateStaffAccount } from "@/lib/admin";
import { requireAdminApiSession } from "@/lib/admin-request";

type StaffBody = {
  full_name?: string;
  role?: "admin" | "branch_staff";
  default_branch_id?: string | null;
  branch_ids?: string[];
  password?: string | null;
};

type Params = { params: Promise<{ id: string }> };

const STAFF_BODY_LIMIT_BYTES = 16 * 1024;

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireAdminApiSession();
  if (auth.response || !auth.session) {
    return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    await requireOwnedAdminRecord(auth.session, "staff_profiles", id);
    const body = await readLimitedJsonBody<StaffBody>(req, STAFF_BODY_LIMIT_BYTES);
    await updateStaffAccount(id, {
      fullName: body.full_name ?? "",
      role: body.role ?? "branch_staff",
      defaultBranchId: body.default_branch_id ?? null,
      branchIds: body.branch_ids ?? [],
      password: body.password ?? null,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const validationMessage = error instanceof Error ? error.message : "Failed to update staff account.";
    const status = /required|least|must/i.test(validationMessage) ? 400 : 500;
    return status === 400
      ? NextResponse.json({ error: validationMessage }, { status })
      : apiErrorResponse(error, { fallback: "Failed to update staff account.", context: "admin staff PATCH" });
  }
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const auth = await requireAdminApiSession();
  if (auth.response || !auth.session) {
    return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    await requireOwnedAdminRecord(auth.session, "staff_profiles", id);
    if (id === auth.session.userId) {
      return NextResponse.json({ error: "You cannot delete your own admin account." }, { status: 400 });
    }

    await deleteStaffAccount(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return apiErrorResponse(error, { fallback: "Failed to delete staff account.", context: "admin staff DELETE" });
  }
}
