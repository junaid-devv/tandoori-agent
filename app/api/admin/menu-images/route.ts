import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requireAdminApiSession } from "@/lib/admin-request";
import { apiErrorResponse, readLimitedJsonBody } from "@/lib/api-utils";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getRestaurantProfile } from "@/lib/restaurant-profile";
import { invalidateCache } from "@/lib/cache";

const BUCKET_NAME = "menu-assets";
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/jpg",
]);
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per image

async function ensureBucketExists() {
  try {
    const { data: buckets } = await supabaseAdmin.storage.listBuckets();
    const exists = buckets?.some((b) => b.name === BUCKET_NAME);
    if (!exists) {
      await supabaseAdmin.storage.createBucket(BUCKET_NAME, {
        public: true,
        fileSizeLimit: MAX_FILE_SIZE,
      });
    }
  } catch (err) {
    console.warn("[menu-images] ensureBucketExists error:", err);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminApiSession();
  if (auth.response) return auth.response;

  try {
    await ensureBucketExists();

    const formData = await req.formData();
    const files = formData.getAll("files") as File[];
    const singleFile = formData.get("file") as File | null;

    const filesToUpload = files.length > 0 ? files : singleFile ? [singleFile] : [];

    if (filesToUpload.length === 0) {
      return NextResponse.json({ error: "No image files provided." }, { status: 400 });
    }

    const uploadedUrls: string[] = [];

    for (const file of filesToUpload) {
      if (!file || typeof file.arrayBuffer !== "function") continue;

      if (!ALLOWED_MIME_TYPES.has(file.type.toLowerCase())) {
        return NextResponse.json(
          { error: `File "${file.name}" has unsupported type (${file.type}). Use JPG, PNG, or WebP.` },
          { status: 400 }
        );
      }

      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: `File "${file.name}" exceeds maximum allowed size (10MB).` },
          { status: 400 }
        );
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const fileName = `menu-cards/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;

      const { error: uploadError } = await supabaseAdmin.storage
        .from(BUCKET_NAME)
        .upload(fileName, buffer, {
          contentType: file.type,
          upsert: true,
        });

      if (uploadError) {
        console.error("[menu-images] Storage upload error:", uploadError);
        throw new Error(`Failed to upload "${file.name}": ${uploadError.message}`);
      }

      const { data: publicData } = supabaseAdmin.storage
        .from(BUCKET_NAME)
        .getPublicUrl(fileName);

      uploadedUrls.push(publicData.publicUrl);
    }

    // Read current profile and append new image URLs
    const currentProfile = await getRestaurantProfile();
    const existingImages = Array.isArray(currentProfile.menu_card_images) ? currentProfile.menu_card_images : [];
    const updatedImages = [...existingImages, ...uploadedUrls];

    // Persist to database
    const { error: dbError } = await supabaseAdmin
      .from("restaurant_profiles")
      .update({
        menu_card_images: updatedImages,
        menu_display_mode: "menu_pictures",
        updated_at: new Date().toISOString(),
      })
      .eq("id", "default");

    if (dbError) {
      console.error("[menu-images] DB update error:", dbError);
      throw new Error(`Failed to update restaurant profile: ${dbError.message}`);
    }

    invalidateCache("restaurant_profile:default");

    return NextResponse.json({
      success: true,
      uploadedCount: uploadedUrls.length,
      uploadedUrls,
      allImages: updatedImages,
    });
  } catch (error) {
    return apiErrorResponse(error, {
      fallback: "Failed to upload menu images.",
      context: "menu images upload",
      status: 500,
    });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdminApiSession();
  if (auth.response) return auth.response;

  try {
    const body = await readLimitedJsonBody<{ imageUrl?: string }>(req, 16 * 1024);
    const { imageUrl } = body;

    if (!imageUrl) {
      return NextResponse.json({ error: "Image URL is required." }, { status: 400 });
    }

    const currentProfile = await getRestaurantProfile();
    const existingImages = Array.isArray(currentProfile.menu_card_images) ? currentProfile.menu_card_images : [];
    const updatedImages = existingImages.filter((img) => img !== imageUrl);

    // Persist to database
    const { error: dbError } = await supabaseAdmin
      .from("restaurant_profiles")
      .update({
        menu_card_images: updatedImages,
        updated_at: new Date().toISOString(),
      })
      .eq("id", "default");

    if (dbError) {
      throw new Error(`Failed to update restaurant profile: ${dbError.message}`);
    }

    // Best-effort cleanup from storage if bucket matches
    if (imageUrl.includes(`/${BUCKET_NAME}/`)) {
      const parts = imageUrl.split(`/${BUCKET_NAME}/`);
      if (parts[1]) {
        void supabaseAdmin.storage.from(BUCKET_NAME).remove([parts[1]]).catch(() => {});
      }
    }

    invalidateCache("restaurant_profile:default");

    return NextResponse.json({
      success: true,
      allImages: updatedImages,
    });
  } catch (error) {
    return apiErrorResponse(error, {
      fallback: "Failed to delete menu image.",
      context: "menu image delete",
      status: 500,
    });
  }
}
