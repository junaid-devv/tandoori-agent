import type { BranchSummary } from "./branches";
import type { MenuCatalogItem } from "./menu";
import { buildMenuItemRowId } from "./order-menu-replies.ts";
import type { LanguagePreference } from "./schema.types";

type InteractiveListPayload =
  | {
    body: string;
    buttonText: string;
    sectionTitle?: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  }
  | null;

export function buildInteractiveListForPresentedOptions(
  options: MenuCatalogItem[],
  langOrPrefersRomanUrdu: boolean | LanguagePreference,
): InteractiveListPayload {
  if (!Array.isArray(options) || options.length < 1) {
    return null;
  }

  const isUr = langOrPrefersRomanUrdu === "roman_urdu" || langOrPrefersRomanUrdu === true;

  const rows = options.slice(0, 10).map((item) => ({
    id: buildMenuItemRowId(item.id),
    title: item.name,
    description: `Rs. ${item.price}${item.category ? ` - ${item.category}` : ""}`,
  }));

  return {
    body: isUr
      ? "Apni pasand ka item list se select karein."
      : "Please choose your item from the list.",
    buttonText: "Select Item",
    sectionTitle: "Menu Options",
    rows,
  };
}

export function buildInteractiveListForBranches(
  branches: BranchSummary[],
  langOrPrefersRomanUrdu: boolean | LanguagePreference,
  selectedCity?: string,
): InteractiveListPayload {
  if (!Array.isArray(branches) || branches.length < 1) {
    return null;
  }

  const isUr = langOrPrefersRomanUrdu === "roman_urdu" || langOrPrefersRomanUrdu === true;

  const rows = branches.slice(0, 10).map((branch) => ({
    id: branch.id,
    title: branch.name,
    description: branch.address || undefined,
  }));

  return {
    body: isUr
      ? selectedCity
        ? `*${selectedCity}* mein apni branch select karein.`
        : "Order shuru karne se pehle apni branch select karein."
      : selectedCity
        ? `Please choose your branch in *${selectedCity}*.`
        : "Before we start your order, please choose your branch.",
    buttonText: "Select Branch",
    sectionTitle: "Branches",
    rows,
  };
}
