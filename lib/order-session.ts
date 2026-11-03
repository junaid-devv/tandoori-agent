/** Drafts and AI chat context expire independently of staff order-status updates. */
export const ORDER_SESSION_IDLE_MS = 2 * 60 * 60 * 1000;

export function orderSessionExpired(lastAt: string | null | undefined, incomingAt: string): boolean {
  if (!lastAt) return false;
  const elapsed = Date.parse(incomingAt) - Date.parse(lastAt);
  return Number.isFinite(elapsed) && elapsed >= ORDER_SESSION_IDLE_MS;
}

/** Keep only the current customer session, including the inbound message while
 * finding the boundary. Ignore later queued messages when processing a retry. */
export function currentOrderHistory<T extends { id: string; role: string; created_at?: string }>(history: T[], messageId?: string | null): T[] {
  const current = messageId ? history.findIndex((message) => message.id === messageId) : history.length;
  if (current < 0) return [];
  const throughCurrent = history.slice(0, messageId ? current + 1 : current);
  let start = 0;
  let lastCustomerAt: string | undefined;
  for (let i = 0; i < throughCurrent.length; i++) {
    const message = throughCurrent[i];
    if (message.created_at && orderSessionExpired(throughCurrent[i - 1]?.created_at, message.created_at)) start = i;
    if (message.role !== "user" || !message.created_at) continue;
    if (orderSessionExpired(lastCustomerAt, message.created_at)) start = i;
    lastCustomerAt = message.created_at;
  }
  return throughCurrent.slice(start, messageId ? -1 : undefined);
}
