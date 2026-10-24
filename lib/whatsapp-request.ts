import type { NextRequest } from "next/server";
import type { DashboardSession } from "./auth";
import { ApiRequestError } from "./api-utils";

export function whatsappRestaurantId(req: NextRequest, session: DashboardSession, mutation = false): string {
  if (mutation && session.role === "branch_staff") throw new ApiRequestError("Only administrators can configure WhatsApp", 403);
  const requested = new URL(req.url).searchParams.get("restaurant_id");
  if (session.role !== "super_admin" && requested && requested !== session.restaurantId) {
    throw new ApiRequestError("Forbidden for this restaurant", 403);
  }
  const id = session.role === "super_admin" ? requested || session.restaurantId : session.restaurantId;
  if (!id) throw new ApiRequestError("Select a restaurant first", 400);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new ApiRequestError("Invalid restaurant ID", 400);
  }
  return id;
}
