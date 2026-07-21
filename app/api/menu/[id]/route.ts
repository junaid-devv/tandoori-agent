import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, readLimitedJsonBody } from "@/lib/api-utils";
import { requireApiSession } from "@/lib/branch-request";
import { invalidateMenuCache, normalizeMenuCategory } from "@/lib/menu";
import { normalizeAvailabilityDays, normalizeAvailabilityTime } from "@/lib/menu-availability";
import { canAccessMenuItem } from "@/lib/record-access";
import { supabaseAdmin } from "@/lib/supabase-admin";

type Params = { params: Promise<{ id: string }> };
const MENU_ITEM_BODY_LIMIT_BYTES = 8 * 1024;

/** PATCH /api/menu/[id] — update any field of a single menu item */
export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireApiSession();
  if (auth.response || !auth.session) {
    return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const accessibleItem = await canAccessMenuItem(auth.session, id);
  if (!accessibleItem) {
    return NextResponse.json({ error: "Menu item not found" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await readLimitedJsonBody<Record<string, unknown>>(req, MENU_ITEM_BODY_LIMIT_BYTES);
  } catch (error) {
    return apiErrorResponse(error, { fallback: "Invalid menu item update request.", context: "menu item PATCH" });
  }

  const allowed = [
    "name",
    "price",
    "category",
    "description",
    "is_available",
    "available_days",
    "available_start_time",
    "available_end_time",
  ] as const;
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  if ("name" in updates) {
    const name = String(updates.name ?? "").trim();
    if (!name) {
      return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
    }
    updates.name = name;
  }

  if ("price" in updates) {
    const price = Number(updates.price);
    if (!Number.isFinite(price) || price < 0) {
      return NextResponse.json({ error: "Price must be a non-negative number" }, { status: 400 });
    }
    updates.price = price;
  }

  if ("category" in updates) {
    updates.category = normalizeMenuCategory(String(updates.category ?? "")) ?? null;
  }

  if ("description" in updates) {
    updates.description = typeof updates.description === "string" && updates.description.trim()
      ? updates.description.trim().slice(0, 500)
      : null;
  }

  if ("available_days" in updates) {
    updates.available_days = normalizeAvailabilityDays(updates.available_days);
  }

  if ("available_start_time" in updates) {
    updates.available_start_time = normalizeAvailabilityTime(updates.available_start_time);
  }

  if ("available_end_time" in updates) {
    updates.available_end_time = normalizeAvailabilityTime(updates.available_end_time);
  }

  if (Object.keys(updates).length === 0)
    return NextResponse.json({ error: "No valid fields" }, { status: 400 });

  const { error } = await supabaseAdmin
    .from("menu_items")
    .update(updates)
    .eq("id", accessibleItem.id);

  if (error) return apiErrorResponse(error, { fallback: "Failed to update menu item.", context: "menu item PATCH" });

  invalidateMenuCache(accessibleItem.branch_id);

  return NextResponse.json({ success: true });
}

/** DELETE /api/menu/[id] — permanently remove a single menu item */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireApiSession();
  if (auth.response || !auth.session) {
    return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const accessibleItem = await canAccessMenuItem(auth.session, id);
  if (!accessibleItem) {
    return NextResponse.json({ error: "Menu item not found" }, { status: 404 });
  }

  const { error } = await supabaseAdmin
    .from("menu_items")
    .delete()
    .eq("id", accessibleItem.id);

  if (error) return apiErrorResponse(error, { fallback: "Failed to delete menu item.", context: "menu item DELETE" });

  invalidateMenuCache(accessibleItem.branch_id);

  return NextResponse.json({ success: true });
}
