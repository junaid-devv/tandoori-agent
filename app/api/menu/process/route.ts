import { NextRequest, NextResponse } from "next/server";
import { ApiRequestError, apiErrorResponse, readLimitedJsonBody, requireTrimmedString } from "@/lib/api-utils";
import { resolveRequestBranch } from "@/lib/branch-request";
import { processMenuImage } from "@/lib/ai";
import { createMenuUpload, updateMenuUploadStatus } from "@/lib/menu";
import { getRestaurantProfile } from "@/lib/restaurant-profile";

type MenuProcessBody = {
  imageUrl?: string;
  savedCards?: boolean;
};

const MENU_PROCESS_BODY_LIMIT_BYTES = 10 * 1024 * 1024; // 10 MB limit for camera photos
const MAX_IMAGE_URL_LENGTH = 10 * 1024 * 1024;
const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

function validateMenuImageUrl(value: unknown): string {
  const imageUrl = requireTrimmedString(value, "Image URL", MAX_IMAGE_URL_LENGTH);

  // Accept direct data URL uploads (e.g. data:image/jpeg;base64,...)
  if (imageUrl.startsWith("data:image/")) {
    if (!/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(imageUrl)) {
      throw new ApiRequestError("Invalid image data format.", 400);
    }
    return imageUrl;
  }

  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    throw new ApiRequestError("Image URL must be a valid HTTPS URL or image upload.", 400);
  }

  if (parsed.protocol !== "https:") {
    throw new ApiRequestError("Image URL must use HTTPS.", 400);
  }

  if (BLOCKED_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new ApiRequestError("Image URL host is not allowed.", 400);
  }

  return parsed.toString();
}

export async function POST(req: NextRequest) {
  try {
    const auth = await resolveRequestBranch(req, { requireBranch: true });
    if (auth.response || !auth.branchId) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await readLimitedJsonBody<MenuProcessBody>(req, MENU_PROCESS_BODY_LIMIT_BYTES);
    if (body.savedCards === true) {
      const profile = await getRestaurantProfile(auth.session?.restaurantId ?? undefined);
      const cards = profile.menu_card_images;
      if (!cards.length) return NextResponse.json({ error: "No saved menu pictures were found." }, { status: 422 });
      if (cards.length > 8) return NextResponse.json({ error: "Import at most 8 menu pictures at a time." }, { status: 422 });
      const items: unknown[] = [];
      // Bound vision concurrency; this is an onboarding operation, never a
      // customer-turn dependency. Extraction only prepares a review preview.
      for (let index = 0; index < cards.length; index += 2) {
        const pages = await Promise.all(cards.slice(index, index + 2).map((url) => processMenuImage(validateMenuImageUrl(url))));
        items.push(...pages.flat());
      }
      if (!items.length) return NextResponse.json({ error: "No priced items were extracted. Check the pictures." }, { status: 422 });
      return NextResponse.json({ items, source: "saved_menu_cards", requiresReview: true });
    }
    const imageUrl = validateMenuImageUrl(body.imageUrl);

    // Save upload record with truncated URL reference if base64 to conserve database space
    const uploadRef = imageUrl.startsWith("data:image/")
      ? `data:image/upload;${Date.now()}`
      : imageUrl;
    const upload = await createMenuUpload(auth.branchId, uploadRef);
    await updateMenuUploadStatus(upload.id, "processing");

    const items = await processMenuImage(imageUrl);
    if (!Array.isArray(items) || items.length === 0) {
      await updateMenuUploadStatus(upload.id, "error", "No items found in image");
      return NextResponse.json({ error: "Could not extract menu items from the image." }, { status: 422 });
    }

    await updateMenuUploadStatus(upload.id, "completed");
    return NextResponse.json({ items });
  } catch (error) {
    return apiErrorResponse(error, { fallback: "Menu processing failed.", context: "menu/process" });
  }
}
