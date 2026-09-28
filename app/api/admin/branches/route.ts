import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, readLimitedJsonBody } from "@/lib/api-utils";
import { createBranch, listBranchesWithStats } from "@/lib/admin";
import { requireAdminApiSession } from "@/lib/admin-request";

type BranchBody = {
  name?: string;
  slug?: string | null;
  city?: string;
  address?: string;
  is_active?: boolean;
};

const BRANCH_BODY_LIMIT_BYTES = 8 * 1024;

export async function GET() {
  const auth = await requireAdminApiSession();
  if (auth.response) {
    return auth.response;
  }

  try {
    if (!auth.session.restaurantId) {
      return NextResponse.json({ error: "No restaurant context." }, { status: 400 });
    }
    const branches = await listBranchesWithStats(auth.session.restaurantId);
    return NextResponse.json(branches);
  } catch (error) {
    return apiErrorResponse(error, { fallback: "Failed to load branches.", context: "admin branches GET" });
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
    const body = await readLimitedJsonBody<BranchBody>(req, BRANCH_BODY_LIMIT_BYTES);
    const branch = await createBranch(auth.session.restaurantId, {
      name: body.name ?? "",
      slug: body.slug ?? null,
      city: body.city ?? "",
      address: body.address ?? "",
      isActive: body.is_active ?? true,
    });

    return NextResponse.json(branch);
  } catch (error) {
    const validationMessage = error instanceof Error ? error.message : "Failed to create branch.";
    const status = /required/i.test(validationMessage) ? 400 : 500;
    return status === 400
      ? NextResponse.json({ error: validationMessage }, { status })
      : apiErrorResponse(error, { fallback: "Failed to create branch.", context: "admin branches POST" });
  }
}
