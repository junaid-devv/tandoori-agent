import { supabaseAdmin } from "./supabase-admin";
import type { DashboardSession } from "./auth";
import { ApiRequestError } from "./api-utils";

export async function requireOwnedAdminRecord(session: DashboardSession, table: "branches" | "staff_profiles", id: string) {
  if (!session.restaurantId) throw new ApiRequestError("Select a restaurant first", 400);
  const { data, error } = await supabaseAdmin.from(table)
    .select(table === "staff_profiles" ? "user_id, role" : "id")
    .eq(table === "staff_profiles" ? "user_id" : "id", id)
    .eq("restaurant_id", session.restaurantId).maybeSingle();
  if (error) throw error;
  if (!data || ("role" in data && data.role === "super_admin")) throw new ApiRequestError("Record not found", 404);
}
