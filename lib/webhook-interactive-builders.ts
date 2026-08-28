import type { BranchSummary } from "./branches";
import type { MenuCatalogItem } from "./order-engine";
import { buildMenuItemRowId } from "./order-menu-replies.ts";

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
  prefersRomanUrdu: boolean,
): InteractiveListPayload {
  if (!Array.isArray(options) || options.length < 1) {
    return null;
  }

  const rows = options.slice(0, 10).map((item) => ({
    id: buildMenuItemRowId(item.id),
    title: item.name,
    description: `Rs. ${item.price}${item.category ? ` - ${item.category}` : ""}`,
  }));

  return {
    body: prefersRomanUrdu
      ? "Apni pasand ka item list se select karein."
      : "Please choose your item from the list.",
    buttonText: prefersRomanUrdu ? "Select Item" : "Select Item",
    sectionTitle: prefersRomanUrdu ? "Menu Options" : "Menu Options",
    rows,
  };
}

export function buildInteractiveListForBranches(
  branches: BranchSummary[],
  prefersRomanUrdu: boolean,
  selectedCity?: string,
): InteractiveListPayload {
  if (!Array.isArray(branches) || branches.length < 1) {
    return null;
  }

  const rows = branches.slice(0, 10).map((branch) => ({
    id: branch.id,
    title: branch.name,
    description: branch.address || undefined,
  }));

  return {
    body: prefersRomanUrdu
      ? selectedCity
        ? `*${selectedCity}* mein apni branch select karein.`
        : "Order shuru karne se pehle apni branch select karein."
      : selectedCity
        ? `Please choose your branch in *${selectedCity}*.`
        : "Before we start your order, please choose your branch.",
    buttonText: prefersRomanUrdu ? "Select Branch" : "Select Branch",
    sectionTitle: prefersRomanUrdu ? "Branches" : "Branches",
    rows,
  };
}
