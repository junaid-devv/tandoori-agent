/**
 * lib/agent/cart.ts — Phase 7
 * Pure cart operations on CartItem[]. No IO. Menu resolution is done by the
 * caller (via lib/menu/search) before mutating.
 */
import type { CartItem } from "@/lib/schema.types";

export function cartSubtotal(cart: CartItem[]): number {
  return cart.reduce((sum, i) => sum + i.unit_price * i.qty, 0);
}

/** Resolve edits against the cart, never a different menu dish. */
export function findCartMatches(cart: CartItem[], query: string): CartItem[] {
  if (["item", "cart", "current_item", "__last_item__"].includes(query.trim().toLowerCase())) return cart.slice(-1);
  const norm = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const q = norm(query);
  if (!q) return [];
  const exact = cart.filter((i) => norm(i.name) === q);
  if (exact.length) return exact;
  return cart.filter((i) => ` ${norm(i.name)} `.includes(` ${q} `));
}

function sameLine(a: CartItem, b: CartItem): boolean {
  return a.menu_item_id === b.menu_item_id && (a.size ?? null) === (b.size ?? null)
    && (a.notes?.trim() ?? "") === (b.notes?.trim() ?? "")
    && JSON.stringify([...(a.addons ?? [])].sort()) === JSON.stringify([...(b.addons ?? [])].sort());
}

export function addToCart(
  cart: CartItem[],
  item: Omit<CartItem, "qty"> & { qty: number },
): CartItem[] {
  if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > 50 || !Number.isFinite(item.unit_price) || item.unit_price < 0) {
    throw new Error("Invalid cart quantity or price");
  }
  const next = cart.map((i) => ({ ...i }));
  const existing = next.find((i) => sameLine(i, item));
  if (existing) {
    if (existing.qty + item.qty > 50) throw new Error("Maximum quantity per preparation is 50");
    existing.qty += item.qty;
    return next;
  }
  next.push({ ...item, addons: [...(item.addons ?? [])] });
  return next;
}

export function removeFromCart(
  cart: CartItem[],
  target: { menu_item_id?: string; name?: string; qty: number | "all" },
): CartItem[] {
  const targetLower = target.name?.trim().toLowerCase();
  const match = (i: CartItem) => {
    if (target.menu_item_id) return i.menu_item_id === target.menu_item_id;
    if (!targetLower) return false;
    const itemNameLower = i.name.toLowerCase();
    return itemNameLower === targetLower || itemNameLower.includes(targetLower) || targetLower.includes(itemNameLower);
  };

  const next: CartItem[] = [];
  let remainingToRemove = target.qty;
  for (const i of cart) {
    if (!match(i)) {
      next.push(i);
      continue;
    }
    if (target.qty === "all") continue;
    const removed = Math.min(i.qty, Number(remainingToRemove));
    remainingToRemove = Number(remainingToRemove) - removed;
    const remaining = i.qty - removed;
    if (remaining > 0) next.push({ ...i, qty: remaining });
  }
  return next;
}

export function updateQuantity(
  cart: CartItem[],
  target: { menu_item_id?: string; name?: string; qty: number },
): CartItem[] {
  const targetLower = target.name?.trim().toLowerCase();
  const isGeneric =
    !targetLower ||
    targetLower === "item" ||
    targetLower === "cart" ||
    targetLower === "current_item" ||
    targetLower === "__last_item__";
  return cart
    .map((i, idx) => {
      const itemNameLower = i.name.toLowerCase();
      const match =
        (target.menu_item_id && i.menu_item_id === target.menu_item_id) ||
        (!isGeneric && targetLower && (itemNameLower === targetLower || itemNameLower.includes(targetLower) || targetLower.includes(itemNameLower))) ||
        (isGeneric && (cart.length === 1 || idx === cart.length - 1));
      if (!match) return i;
      return { ...i, qty: Math.max(1, Math.min(target.qty, 50)) };
    })
    .filter(Boolean);
}
