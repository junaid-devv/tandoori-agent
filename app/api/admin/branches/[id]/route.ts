import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, readLimitedJsonBody } from "@/lib/api-utils";
import { deleteBranch, updateBranch } from "@/lib/admin";
import { requireAdminApiSession } from "@/lib/admin-request";

type BranchBody = {
  name?: string;
  slug?: string | null;
  city?: string;
  address?: string;
  is_active?: boolean;
};

const BRANCH_BODY_LIMIT_BYTES = 8 * 1024;

export async function PATCH(req: NextRequest, context: RouteContext<"/api/admin/branches/[id]">) {
  const auth = await requireAdminApiSession();
  if (auth.response) {
    return auth.response;
  }

  try {
    const { id } = await context.params;
    const body = await readLimitedJsonBody<BranchBody>(req, BRANCH_BODY_LIMIT_BYTES);
    const branch = await updateBranch(id, {
      name: body.name ?? "",
      slug: body.slug ?? null,
      city: body.city ?? "",
      address: body.address ?? "",
      isActive: body.is_active ?? true,
    });

    return NextResponse.json(branch);
  } catch (error) {
    const validationMessage = error instanceof Error ? error.message : "Failed to update branch.";
    const status = /required/i.test(validationMessage) ? 400 : 500;
    return status === 400
      ? NextResponse.json({ error: validationMessage }, { status })
      : apiErrorResponse(error, { fallback: "Failed to update branch.", context: "admin branch PATCH" });
  }
}

export async function DELETE(_: NextRequest, context: RouteContext<"/api/admin/branches/[id]">) {
  const auth = await requireAdminApiSession();
  if (auth.response) {
    return auth.response;
  }

  try {
    const { id } = await context.params;
    await deleteBranch(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const validationMessage = error instanceof Error ? error.message : "Failed to delete branch.";
    const status = /not found/i.test(validationMessage) ? 404 : 500;
    return status === 404
      ? NextResponse.json({ error: validationMessage }, { status })
      : apiErrorResponse(error, { fallback: "Failed to delete branch.", context: "admin branch DELETE" });
  }
}
