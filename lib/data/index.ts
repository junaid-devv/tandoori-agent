/**
 * lib/data — repository layer (Phase 3).
 * Typed, single-responsibility wrappers over supabaseAdmin so DB access is not
 * scattered across routes/order-engine. Order placement remains in the
 * `place_order_from_payload` RPC (via orderRepo.place).
 *
 * Deferred to later phases (migrated atomically with their call sites):
 *   - menu/search + catalog repos -> Phase 6
 */
export { contactRepo, type ContactRow } from "./contact.repo";
export { conversationRepo, type ConversationRow } from "./conversation.repo";
export { messageRepo, type MessageRow } from "./message.repo";
export {
  stateRepo,
  getDefaultState,
  parseState,
  deriveSessionView,
  type LegacySessionView,
  type LegacySessionNode,
} from "./state.repo";
export {
  orderRepo,
  type OrderRow,
  type OrderItemRow,
  type PlaceOrderPayload,
} from "./order.repo";
