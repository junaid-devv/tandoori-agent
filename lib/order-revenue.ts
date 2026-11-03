/** A persisted order is confirmed. Count it once immediately; cancellation
 * removes it on the next dashboard refresh. Delivery fees are part of total. */
export const REVENUE_ORDER_STATUSES = ["received", "preparing", "out_for_delivery", "delivered"] as const;

export function countsTowardRevenue(status: string): boolean {
  return (REVENUE_ORDER_STATUSES as readonly string[]).includes(status);
}

export function confirmedOrderRevenue(orders: ReadonlyArray<{ status: string; total?: number | string | null; subtotal?: number | string | null; delivery_fee?: number | string | null }>): number {
  return orders.reduce((sum, order) => {
    if (!countsTowardRevenue(order.status)) return sum;
    const amount = Number(order.total ?? (Number(order.subtotal ?? 0) + Number(order.delivery_fee ?? 0)));
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
}
