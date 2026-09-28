import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession, requireSuperAdminSession } from "@/lib/admin-request";
import { apiErrorResponse, readLimitedJsonBody } from "@/lib/api-utils";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

interface CreateRestaurantBody {
  name: string;
  slug?: string;
  city?: string;
  brandColor?: string;
  primaryBranchName?: string;
  primaryBranchAddress?: string;
  adminEmail: string;
  adminPassword: string;
  adminFullName: string;
}

function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * GET /api/admin/restaurants
 * Lists all tenant restaurants with branch & WhatsApp status.
 * Accessible by super_admin (or scopes to session.restaurantId for admin).
 */
export async function GET() {
  const auth = await requireAdminApiSession();
  if (auth.response || !auth.session) {
    return auth.response;
  }

  try {
    let query = supabaseAdmin
      .from("restaurant_profiles")
      .select(`
        id,
        name,
        slug,
        city,
        brand_color,
        currency,
        timezone,
        branch_mode,
        is_active,
        created_at,
        whatsapp_configs (
          id,
          phone_number_id,
          waba_id,
          display_phone_number,
          verified_name,
          is_active
        ),
        branches (
          id,
          name,
          slug,
          city,
          is_active
        )
      `)
      .order("created_at", { ascending: false });

    // Admins only see their own restaurant
    if (auth.session.role !== "super_admin" && auth.session.restaurantId) {
      query = query.eq("id", auth.session.restaurantId);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json(data ?? []);
  } catch (error) {
    return apiErrorResponse(error, {
      fallback: "Failed to list restaurants.",
      context: "GET /api/admin/restaurants",
    });
  }
}

/**
 * POST /api/admin/restaurants
 * Provisions a new tenant restaurant:
 * 1. Creates restaurant_profiles row
 * 2. Creates initial default branch & settings
 * 3. Creates admin login credentials in auth.users + staff_profiles
 *
 * Gated to super_admin.
 */
export async function POST(req: NextRequest) {
  const auth = await requireSuperAdminSession();
  if (auth.response || !auth.session) {
    return auth.response;
  }

  try {
    const body = await readLimitedJsonBody<CreateRestaurantBody>(req, 32 * 1024);

    const name = body.name?.trim();
    if (!name) {
      return NextResponse.json({ error: "Restaurant name is required." }, { status: 400 });
    }

    const adminEmail = body.adminEmail?.trim().toLowerCase();
    const adminPassword = body.adminPassword?.trim();
    const adminFullName = body.adminFullName?.trim() || `${name} Admin`;

    if (!adminEmail) {
      return NextResponse.json({ error: "Admin email is required." }, { status: 400 });
    }
    if (!adminPassword || adminPassword.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
    }

    const slug = body.slug?.trim() || generateSlug(name) || `restaurant-${Date.now()}`;
    const city = body.city?.trim() || "Islamabad";
    const brandColor = body.brandColor?.trim() || "#EA580C";
    const primaryBranchName = body.primaryBranchName?.trim() || "Main Branch";
    const primaryBranchAddress = body.primaryBranchAddress?.trim() || "";

    // 1) Create restaurant profile
    const { data: restaurant, error: restaurantError } = await supabaseAdmin
      .from("restaurant_profiles")
      .insert({
        name,
        slug,
        city,
        brand_color: brandColor,
        dashboard_title: `${name} Dashboard`,
        is_active: true,
      })
      .select("*")
      .single();

    if (restaurantError || !restaurant) {
      console.error("[restaurants] Failed to create restaurant_profile:", restaurantError);
      throw restaurantError ?? new Error("Failed to create restaurant profile.");
    }

    // 2) Create initial branch
    const branchSlug = generateSlug(primaryBranchName) || "main";
    const { data: branch, error: branchError } = await supabaseAdmin
      .from("branches")
      .insert({
        restaurant_id: restaurant.id,
        name: primaryBranchName,
        slug: branchSlug,
        city,
        address: primaryBranchAddress,
        is_active: true,
      })
      .select("*")
      .single();

    if (branchError || !branch) {
      console.error("[restaurants] Failed to create branch:", branchError);
      throw branchError ?? new Error("Failed to create branch.");
    }

    // 3) Create restaurant settings for branch
    const { error: settingsError } = await supabaseAdmin
      .from("restaurant_settings")
      .insert({
        branch_id: branch.id,
        city,
        is_accepting_orders: true,
      });

    if (settingsError) {
      console.warn("[restaurants] Warning: Failed to seed restaurant_settings:", settingsError);
    }

    // 4) Create admin user in Supabase Auth
    const authResult = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: {
        full_name: adminFullName,
        restaurant_id: restaurant.id,
      },
    });

    if (authResult.error || !authResult.data.user) {
      console.error("[restaurants] Failed to create auth user:", authResult.error);
      throw authResult.error ?? new Error("Failed to create admin user.");
    }

    const userId = authResult.data.user.id;

    // 5) Link user to restaurant in staff_profiles as 'admin'
    const { error: staffError } = await supabaseAdmin
      .from("staff_profiles")
      .insert({
        user_id: userId,
        restaurant_id: restaurant.id,
        full_name: adminFullName,
        role: "admin",
        default_branch_id: branch.id,
      });

    if (staffError) {
      console.error("[restaurants] Failed to create staff_profile:", staffError);
      throw staffError;
    }

    // 6) Grant access to primary branch
    await supabaseAdmin
      .from("staff_branch_access")
      .insert({
        user_id: userId,
        branch_id: branch.id,
      });

    return NextResponse.json({
      success: true,
      message: `Restaurant "${name}" created successfully! 🎉`,
      restaurant: {
        id: restaurant.id,
        name: restaurant.name,
        slug: restaurant.slug,
      },
      branch: {
        id: branch.id,
        name: branch.name,
        slug: branch.slug,
      },
      admin: {
        userId,
        email: adminEmail,
        fullName: adminFullName,
        role: "admin",
      },
    });
  } catch (error) {
    return apiErrorResponse(error, {
      fallback: "Failed to create restaurant client.",
      context: "POST /api/admin/restaurants",
    });
  }
}
