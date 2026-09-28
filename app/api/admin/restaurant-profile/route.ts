import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, readLimitedJsonBody } from "@/lib/api-utils";
import { getRestaurantProfile, updateRestaurantProfile } from "@/lib/restaurant-profile";
import type { RestaurantProfile } from "@/lib/restaurant-profile-types";
import { requireAdminApiSession } from "@/lib/admin-request";

const PROFILE_BODY_LIMIT_BYTES = 16 * 1024;

export async function GET() {
  const auth = await requireAdminApiSession();
  if (auth.response) {
    return auth.response;
  }

  try {
    const profile = await getRestaurantProfile(auth.session.restaurantId ?? undefined);
    return NextResponse.json(profile);
  } catch (error) {
    return apiErrorResponse(error, {
      fallback: "Failed to load restaurant profile.",
      context: "restaurant profile GET",
    });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdminApiSession();
  if (auth.response) {
    return auth.response;
  }

  try {
    const body = await readLimitedJsonBody<Partial<RestaurantProfile>>(req, PROFILE_BODY_LIMIT_BYTES);
    const profile = await updateRestaurantProfile(auth.session.restaurantId ?? "", body);
    return NextResponse.json(profile);
  } catch (error) {
    return apiErrorResponse(error, {
      fallback: "Failed to update restaurant profile.",
      context: "restaurant profile PATCH",
    });
  }
}
