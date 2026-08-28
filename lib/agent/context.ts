/**
 * lib/agent/context.ts — Phase 5
 *
 * Loads everything ONE turn needs, in parallel, with caching. This is the single
 * place that sequences per-turn IO (the old god-route did this ad hoc with many
 * sequential awaits). Latency-first: menu + settings are cached; state + history
 * are fetched concurrently.
 *
 * The pipeline (Phase 7) calls loadTurnContext() then feeds it to nlu + state-machine.
 */
import { cache } from "@/lib/core/cache";
import { stateRepo } from "@/lib/data/state.repo";
import { getMenuCatalog } from "@/lib/menu";
import { getRestaurantSettings, isWithinOperatingHours } from "@/lib/settings";
import { getLatestSavedAddress, type SavedAddress } from "@/lib/customer-crm";
import type { MenuCatalogItem } from "@/lib/menu";
import type { RestaurantSettings } from "@/lib/settings";
import type { ConversationStateRow } from "@/lib/schema.types";
import type { StateView } from "./state-machine";

const MENU_TTL_MS = Number(process.env.MENU_CACHE_TTL_MS) || 5 * 60_000;
const SETTINGS_TTL_MS = Number(process.env.SETTINGS_CACHE_TTL_MS) || 60_000;

export interface TurnContext {
  state: ConversationStateRow;
  menu: MenuCatalogItem[];
  settings: RestaurantSettings;
  isOpenNow: boolean;
  /** Pre-loaded saved delivery address for this conversation (avoids a DB call in executor). */
  savedAddress: SavedAddress | null;
  view: StateView;
}

export interface LoadContextInput {
  conversationId: string;
  branchId: string;
  /** Skip menu load for trivial turns (greeting/ack) to save latency. */
  needsMenu?: boolean;
  /** Skip saved-address pre-load when we know it won't be needed (e.g. pickup/dine-in). */
  needsSavedAddress?: boolean;
}

async function loadMenuCached(branchId: string): Promise<MenuCatalogItem[]> {
  return cache.getOrSet(`menu:${branchId}`, MENU_TTL_MS, () => getMenuCatalog(branchId));
}

async function loadSettingsCached(branchId: string): Promise<RestaurantSettings> {
  return cache.getOrSet(`settings:${branchId}`, SETTINGS_TTL_MS, () => getRestaurantSettings(branchId));
}

/** Build the pure FSM view from the persisted state row. */
export function buildStateView(state: ConversationStateRow): StateView {
  const recentlyShown =
    state.last_shown_options.length > 0 &&
    state.last_shown_options_at !== null &&
    Date.now() - new Date(state.last_shown_options_at).getTime() < 10 * 60_000;

  return {
    stage: state.stage,
    cart: state.cart,
    order_type: state.order_type,
    has_address: Boolean(state.address),
    has_dinein_details: state.guests !== null && state.reservation_time !== null,
    has_pickup_time: state.pickup_time !== null,
    upsell_offered: state.upsell_offered,
    awaiting_selection: recentlyShown,
  };
}

export async function loadTurnContext(input: LoadContextInput): Promise<TurnContext> {
  const needsMenu = input.needsMenu !== false;
  // Pre-load saved address in parallel — only skip when we already know the order type
  // won't be delivery (determined by state after load, so we load it speculatively).
  const needsSavedAddress = input.needsSavedAddress !== false;

  const [state, menu, settings] = await Promise.all([
    stateRepo.ensure(input.conversationId),
    needsMenu ? loadMenuCached(input.branchId) : Promise.resolve<MenuCatalogItem[]>([]),
    loadSettingsCached(input.branchId),
  ]);

  // Load saved address in parallel only if delivery is plausible (order type not set or delivery)
  const savedAddress = needsSavedAddress && (state.order_type === null || state.order_type === "delivery")
    ? await getLatestSavedAddress(input.conversationId).catch(() => null)
    : null;

  const isOpenNow =
    settings.is_accepting_orders &&
    isWithinOperatingHours(settings.opening_time, settings.closing_time, settings.timezone);

  return { state, menu, settings, isOpenNow, savedAddress, view: buildStateView(state) };
}

/** Invalidate cached menu after a menu edit (call from menu save path). */
export async function invalidateMenuContext(branchId: string): Promise<void> {
  await cache.del(`menu:${branchId}`);
}
export async function invalidateSettingsContext(branchId: string): Promise<void> {
  await cache.del(`settings:${branchId}`);
}
