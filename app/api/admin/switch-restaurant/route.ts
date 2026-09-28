import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdminSession } from "@/lib/admin-request";
import { apiErrorResponse, readLimitedJsonBody } from "@/lib/api-utils";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

interface SwitchRestaurantBody {
  restaurantId: string | null;
}

/**
 * POST /api/admin/switch-restaurant
 * Allows a Super Admin to switch their active restaurant context.
 * Sets the `dashboard-active-restaurant` cookie.
 */
export async function POST(req: NextRequest) {
  const auth = await requireSuperAdminSession();
  if (auth.response || !auth.session) {
    return auth.response;
  }

  try {
    const body = await readLimitedJsonBody<SwitchRestaurantBody>(req, 8 * 1024);
    const { restaurantId } = body;

    let targetRestaurant = null;

    if (restaurantId) {
      // Verify restaurant actually exists
      const { data, error } = await supabaseAdmin
        .from("restaurant_profiles")
        .select("id, name, slug")
        .eq("id", restaurantId)
        .maybeSingle();

      if (error || !data) {
        return NextResponse.json({ error: "Restaurant not found." }, { status: 404 });
      }

      targetRestaurant = data;
    }

    const response = NextResponse.json({
      success: true,
      activeRestaurant: targetRestaurant,
    });

    if (restaurantId) {
      response.cookies.set("dashboard-active-restaurant", restaurantId, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30, // 30 days
      });
    } else {
      response.cookies.delete("dashboard-active-restaurant");
    }

    return response;
  } catch (error) {
    return apiErrorResponse(error, {
      fallback: "Failed to switch restaurant.",
      context: "POST /api/admin/switch-restaurant",
    });
  }
}
