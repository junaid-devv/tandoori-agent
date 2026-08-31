import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, readLimitedJsonBody } from "@/lib/api-utils";
import { resolveRequestBranch } from "@/lib/branch-request";
import { applyMenuCatalog, invalidateMenuCache, sanitizeMenuItems } from "@/lib/menu";
import type { WeekdayKey } from "@/lib/menu-availability";
import { supabaseAdmin } from "@/lib/supabase-admin";

type IncomingMenuItem = {
  name: string;
  price: number;
  category?: string | null;
  description?: string | null;
  is_available?: boolean;
  available_days?: WeekdayKey[] | null;
  available_start_time?: string | null;
  available_end_time?: string | null;
};

type MenuPutBody = {
  items?: IncomingMenuItem[];
  replaceAll?: boolean;
};

const MENU_BODY_LIMIT_BYTES = 256 * 1024;

export async function GET(req: NextRequest) {
  const auth = await resolveRequestBranch(req, { requireBranch: true });
  if (auth.response || !auth.branchId) {
    return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from("menu_items")
    .select("*")
    .eq("branch_id", auth.branchId)
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    return apiErrorResponse(error, { fallback: "Failed to load menu.", context: "menu route GET" });
  }

  return NextResponse.json(data ?? []);
}

export async function PUT(req: NextRequest) {
  try {
    const auth = await resolveRequestBranch(req, { requireBranch: true });
    if (auth.response || !auth.branchId) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await readLimitedJsonBody<MenuPutBody | IncomingMenuItem[]>(req, MENU_BODY_LIMIT_BYTES);
    const replaceAll = !Array.isArray(body) && body.replaceAll === true;
    const items = Array.isArray(body) ? body : body.items ?? [];

    if (!Array.isArray(items)) {
      return NextResponse.json({ error: "Invalid data format" }, { status: 400 });
    }

    const sanitized = sanitizeMenuItems(items);
    if (sanitized.issues.length > 0) {
      return NextResponse.json(
        {
          error: "Menu validation failed",
          issues: sanitized.issues,
        },
        { status: 400 },
      );
    }

    await applyMenuCatalog(auth.branchId, sanitized.items, replaceAll);
    return NextResponse.json({
      success: true,
      branch_id: auth.branchId,
      replaceAll,
      applied: sanitized.items.length,
    });
  } catch (error) {
    return apiErrorResponse(error, { fallback: "Menu update failed.", context: "menu route PUT" });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = await resolveRequestBranch(req, { requireBranch: true });
    if (auth.response || !auth.branchId) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await supabaseAdmin.from("menu_item_embeddings").delete().eq("branch_id", auth.branchId);
    await supabaseAdmin.from("menu_items").delete().eq("branch_id", auth.branchId);
    await supabaseAdmin.from("menu_categories").delete().eq("branch_id", auth.branchId);

    invalidateMenuCache(auth.branchId);

    return NextResponse.json({
      success: true,
      branch_id: auth.branchId,
      message: "All menu items, categories, and embeddings cleared successfully.",
    });
  } catch (error) {
    return apiErrorResponse(error, { fallback: "Failed to clear menu.", context: "menu route DELETE" });
  }
}

