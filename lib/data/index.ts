/**
 * lib/data — repository layer (Phase 3).
 * Typed, single-responsibility wrappers over supabaseAdmin so DB access is not
 * scattered across routes/order-engine. Order placement remains in the
 * `place_order_from_payload` RPC (via orderRepo.place).
 *
 * Deferred to later phases (migrated atomically with their call sites):
 *   - state.repo.ts (conversation_states + user_sessions merge) -> Phase 5
 *   - menu/search + catalog repos -> Phase 6
 */
export { contactRepo, type ContactRow } from "./contact.repo";
export { conversationRepo, type ConversationRow } from "./conversation.repo";
export { messageRepo, type MessageRow } from "./message.repo";
export {
  orderRepo,
  type OrderRow,
  type OrderItemRow,
  type PlaceOrderPayload,
} from "./order.repo";
