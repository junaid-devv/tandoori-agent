/**
 * lib/agent/cart.ts — Phase 7
 * Pure cart operations on CartItem[]. No IO. Menu resolution is done by the
 * caller (via lib/menu/search) before mutating.
 */
import type { CartItem } from "@/lib/schema.types";

export function cartSubtotal(cart: CartItem[]): number {
  return cart.reduce((sum, i) => sum + i.unit_price * i.qty, 0);
}

function sameLine(a: CartItem, b: { menu_item_id: string; size: string | null }): boolean {
  return a.menu_item_id === b.menu_item_id && (a.size ?? null) === (b.size ?? null);
}

export function addToCart(
  cart: CartItem[],
  item: Omit<CartItem, "qty"> & { qty: number },
): CartItem[] {
  const next = cart.map((i) => ({ ...i }));
  const existing = next.find((i) => sameLine(i, item));
  if (existing) {
    existing.qty = Math.min(existing.qty + item.qty, 50);
    if (item.notes) existing.notes = item.notes;
    if (item.addons?.length) existing.addons = item.addons;
    return next;
  }
  next.push({ ...item, qty: Math.min(item.qty, 50) });
  return next;
}

export function removeFromCart(
  cart: CartItem[],
  target: { menu_item_id?: string; name?: string; qty: number | "all" },
): CartItem[] {
  const match = (i: CartItem) =>
    (target.menu_item_id && i.menu_item_id === target.menu_item_id) ||
    (target.name && i.name.toLowerCase() === target.name.toLowerCase());

  const next: CartItem[] = [];
  for (const i of cart) {
    if (!match(i)) {
      next.push(i);
      continue;
    }
    if (target.qty === "all") continue;
    const remaining = i.qty - target.qty;
    if (remaining > 0) next.push({ ...i, qty: remaining });
  }
  return next;
}

export function updateQuantity(
  cart: CartItem[],
  target: { menu_item_id?: string; name?: string; qty: number },
): CartItem[] {
  return cart
    .map((i) => {
      const match =
        (target.menu_item_id && i.menu_item_id === target.menu_item_id) ||
        (target.name && i.name.toLowerCase() === target.name.toLowerCase());
      if (!match) return i;
      return { ...i, qty: Math.max(1, Math.min(target.qty, 50)) };
    })
    .filter(Boolean);
}
