import type { OrderTurnInterpretation } from "./ai";
import { parseAddress, parseGuestCount, parseReservationTime, extractAnyQuantity } from "./order-input-parsers.ts";
import { normalizeText } from "./order-text-utils.ts";
import type {
  ConversationState,
  DraftCartItem,
  LanguagePreference,
  MenuCatalogItem,
  OrderType,
  TurnContext,
  TurnDecision,
  TurnTrace,
} from "./order-engine";

type MatchedItemsResult = {
  matched: DraftCartItem[];
  unknown: string[];
  ambiguous: Array<{ query: string; options: MenuCatalogItem[] }>;
};

type CartRemovalRequest = {
  name: string;
  qty: number | "all";
};

type CartQtyUpdate = {
  name: string;
  qty: number;
};

type ValidationResult =
  | {
    ok: true;
    order: {
      items: DraftCartItem[];
      type: "delivery" | "pickup" | "dine-in";
      subtotal: number;
      delivery_fee: number;
      address: string | null;
      guests: number | null;
      reservation_time: string | null;
      pickup_time: string | null;
      customer_instructions: string | null;
    };
  }
  | {
    ok: false;
    reply: (romanUrdu: boolean) => string;
    statePatch: Partial<ConversationState>;
  };

type SharedHelpers = {
  extractOrderInstructionCandidate: (rawText: string) => string | null;
  buildSummaryReply: (
    params: {
      state: ConversationState;
      settings: TurnContext["settings"];
    },
    trace?: TurnTrace,
  ) => TurnDecision;
  replyDecision: (
    reply: string,
    statePatch: Partial<ConversationState>,
    trace?: TurnTrace,
    interactiveList?: {
      body: string;
      buttonText: string;
      sectionTitle?: string;
      rows: Array<{ id: string; title: string; description?: string }>;
    } | null,
    replyButtons?: {
      body: string;
      buttons: Array<{ id: string; title: string }>;
    } | null,
  ) => TurnDecision;
  withPreferredLanguage: (
    patch: Partial<ConversationState>,
    preferredLanguage: LanguagePreference,
  ) => Partial<ConversationState>;
  shouldDeferToContextSwitchFallback: (
    rawText: string,
    normalizedText: string,
    interpretation: OrderTurnInterpretation,
  ) => boolean;
  buildUnknownItemReplyData: (
    unknown: string[],
    menuItems: MenuCatalogItem[],
    romanUrdu: boolean,
    semanticMatches?: TurnContext["semanticMatches"],
  ) => { text: string; selectableItems: MenuCatalogItem[]; autoAdd: boolean };
  mergeCartItems: (current: DraftCartItem[], additions: DraftCartItem[]) => DraftCartItem[];
};

type AwaitingConfirmationHelpers = SharedHelpers & {
  isExplicitYes: (text: string) => boolean;
  validateDraftForPlacement: (state: ConversationState, settings: TurnContext["settings"]) => ValidationResult;
  buildOrderPlacedReply: (settings: TurnContext["settings"], orderType: OrderType, romanUrdu: boolean) => string;
  resetDraftState: () => Partial<ConversationState>;
  isExplicitNo: (text: string) => boolean;
  mutateCart: (
    currentCart: DraftCartItem[],
    additions: DraftCartItem[],
    removals: CartRemovalRequest[],
  ) => {
    cart: DraftCartItem[];
    removed: Array<{ name: string; removedQty: number }>;
  };
  applyCartQtyUpdates: (currentCart: DraftCartItem[], updates: CartQtyUpdate[]) => DraftCartItem[];
  applyCheckoutSignalsToState: (params: {
    state: ConversationState;
    interpretation: OrderTurnInterpretation;
    rawText: string;
    settings: TurnContext["settings"];
  }) => ConversationState;
  buildLogisticsOrSummaryReply: (
    params: {
      state: ConversationState;
      settings: TurnContext["settings"];
      matchedAdds: MatchedItemsResult;
      removedItemsText: string;
      menuItems?: MenuCatalogItem[];
    },
    trace?: TurnTrace,
  ) => TurnDecision;
  buildRemovedItemsMessage: (removed: Array<{ name: string; removedQty: number }>) => string;
  buildQtyUpdatedItemsMessage: (updates: CartQtyUpdate[]) => string;
};

type LogisticsHelpers = SharedHelpers & {
  isUpsellYes: (normalizedText: string) => boolean;
  isUpsellNo: (normalizedText: string) => boolean;
  shouldPromptForQuantityPicker: (item: MenuCatalogItem) => boolean;
  buildQuantityPickerReply: (
    item: MenuCatalogItem,
    romanUrdu: boolean,
  ) => {
    text: string;
    interactiveList: {
      body: string;
      buttonText: string;
      sectionTitle?: string;
      rows: Array<{ id: string; title: string; description?: string }>;
    };
  };
  buildQuantityPickerCategoryKey: (itemId: string) => string;
  mergeCartItems: (current: DraftCartItem[], additions: DraftCartItem[]) => DraftCartItem[];
  buildOrderTypePrompt: (deliveryEnabled: boolean, romanUrdu: boolean) => string;
  buildOrderTypeReplyButtons: (
    romanUrdu: boolean,
    deliveryEnabled: boolean,
  ) =>
    | {
      body: string;
      buttons: Array<{ id: string; title: string }>;
    }
    | null;
  buildQuickOrderTypeReplyButtons: (
    romanUrdu: boolean,
    deliveryEnabled: boolean,
  ) =>
    | {
      body: string;
      buttons: Array<{ id: string; title: string }>;
    }
    | null;
  buildUpsellReplyButtons: (
    romanUrdu: boolean,
    itemName?: string,
    itemPrice?: number,
  ) => {
    body: string;
    buttons: Array<{ id: string; title: string }>;
  };
  handleOrderTypeSelection: (
    context: TurnContext,
    state: ConversationState,
    preferredLanguage: LanguagePreference,
    orderType: OrderType,
    trace?: TurnTrace,
  ) => TurnDecision;
  inferGeneralQtyOverride: (normalizedText: string, state: ConversationState) => { name: string; qty: number } | null;
  applyQtyOverride: (cart: DraftCartItem[], name: string, qty: number) => DraftCartItem[];
  buildClosedReply: (settings: TurnContext["settings"], romanUrdu: boolean, hasDraft: boolean) => string;
  inferLastItemQtyOverride: (normalizedText: string, state: ConversationState) => number | null;
  applyLastItemQtyOverride: (cart: DraftCartItem[], qty: number) => DraftCartItem[];
  parseOrderTypeShortcut: (normalizedText: string) => OrderType | null;
  buildPersistedStatePatch: (state: ConversationState) => Partial<ConversationState>;
  clampQty: (qty: number) => number;
};

function isCheckoutRequest(normalizedText: string, interpretation: OrderTurnInterpretation): boolean {
  if (interpretation.order_type != null) return true;
  if (interpretation.wants_confirmation === true) return true;
  if (interpretation.intent === "confirm_order") return true;

  return /\b(checkout|place order|finalize|done|thats all|that's all|no more|ready to order|confirm)\b/.test(
    normalizedText,
  );
}

export function handleAwaitingConfirmationFlow(params: {
  context: TurnContext;
  interpretation: OrderTurnInterpretation;
  matchedAdds: MatchedItemsResult;
  removeRequests: CartRemovalRequest[];
  qtyUpdates: CartQtyUpdate[];
  preferredLanguage: LanguagePreference;
  trace: TurnTrace;
  helpers: AwaitingConfirmationHelpers;
}): TurnDecision {
  const { context, interpretation, matchedAdds, removeRequests, qtyUpdates, preferredLanguage, trace, helpers } = params;
  const state = context.state;
  const normalizedText = normalizeText(context.messageText);
  const prefersRomanUrdu = preferredLanguage === "roman_urdu";
  const instructionCandidate = helpers.extractOrderInstructionCandidate(context.messageText);

  if (instructionCandidate) {
    return helpers.buildSummaryReply(
      {
        state: {
          ...state,
          preferred_language: preferredLanguage,
          customer_instructions: instructionCandidate,
        },
        settings: context.settings,
      },
      trace,
    );
  }

  if (interpretation.wants_confirmation === true || helpers.isExplicitYes(normalizedText)) {
    const validation = helpers.validateDraftForPlacement(state, context.settings);
    if (validation.ok === false) {
      return helpers.replyDecision(
        validation.reply(prefersRomanUrdu),
        helpers.withPreferredLanguage(validation.statePatch, preferredLanguage),
        trace,
      );
    }

    return {
      kind: "place_order",
      reply: helpers.buildOrderPlacedReply(context.settings, validation.order.type, prefersRomanUrdu),
      statePatch: helpers.withPreferredLanguage(
        {
          ...helpers.resetDraftState(),
          summary_sent_at: new Date().toISOString(),
        },
        preferredLanguage,
      ),
      order: validation.order,
      trace,
    };
  }

  if (
    interpretation.wants_confirmation === false ||
    interpretation.intent === "modify_order" ||
    interpretation.intent === "add_items" ||
    matchedAdds.matched.length > 0 ||
    removeRequests.length > 0 ||
    qtyUpdates.length > 0 ||
    helpers.isExplicitNo(normalizedText)
  ) {
    const mutated = helpers.mutateCart(state.cart, matchedAdds.matched, removeRequests);
    const cartWithQtyUpdates = helpers.applyCartQtyUpdates(mutated.cart, qtyUpdates);
    if (cartWithQtyUpdates.length === 0) {
      return helpers.replyDecision(
        prefersRomanUrdu
          ? "Theek hai, cart empty ho gayi. Naya item bhej dein."
          : "Done, your cart is now empty. Send an item to start again.",
        helpers.withPreferredLanguage(helpers.resetDraftState(), preferredLanguage),
        trace,
      );
    }

    const nextStateBase: ConversationState = {
      ...state,
      cart: cartWithQtyUpdates,
      workflow_step: "collecting_items",
      summary_sent_at: null,
      preferred_language: preferredLanguage,
    };
    const nextState = helpers.applyCheckoutSignalsToState({
      state: nextStateBase,
      interpretation,
      rawText: context.messageText,
      settings: context.settings,
    });

    return helpers.buildLogisticsOrSummaryReply(
      {
        state: nextState,
        settings: context.settings,
        matchedAdds,
        removedItemsText: [helpers.buildRemovedItemsMessage(mutated.removed), helpers.buildQtyUpdatedItemsMessage(qtyUpdates)]
          .filter(Boolean)
          .join("\n"),
        menuItems: context.menuItems,
      },
      trace,
    );
  }

  const askedForEditsWithoutResolvedItems =
    interpretation.add_items.length > 0 ||
    /(?:\badd\b|\baur\b|\bbhi\b|\bplus\b|kar do|kr do|remove|delete|minus|kam kr|kam kar)/.test(normalizedText);
  if (askedForEditsWithoutResolvedItems) {
    const unresolvedUnknown = [
      ...matchedAdds.unknown,
      ...interpretation.unknown_items,
      ...interpretation.add_items.map((item) => item.name),
    ]
      .map((value) => value.trim())
      .filter(Boolean);
    const uniqueUnknown = [...new Set(unresolvedUnknown)].slice(0, 3);
    const unknownReply = helpers.buildUnknownItemReplyData(
      uniqueUnknown.length > 0 ? uniqueUnknown : [context.messageText],
      context.menuItems,
      prefersRomanUrdu,
      context.semanticMatches,
    );

    if (unknownReply.autoAdd && unknownReply.selectableItems.length === 1) {
      const autoItem = unknownReply.selectableItems[0];
      const autoQty = Math.max(1, Math.min(50, extractAnyQuantity(context.messageText) ?? 1));
      const newCart = helpers.mergeCartItems(state.cart, [
        { name: autoItem.name, qty: autoQty, price: autoItem.price, category: autoItem.category, size: null, addons: [], item_instructions: null },
      ]);
      return helpers.replyDecision(
        unknownReply.text,
        helpers.withPreferredLanguage({ cart: newCart, workflow_step: "collecting_items", last_presented_options: null, last_presented_options_at: null, summary_sent_at: null }, preferredLanguage),
        trace,
      );
    }

    return helpers.replyDecision(
      unknownReply.text,
      helpers.withPreferredLanguage(
        {
          workflow_step: "collecting_items",
          summary_sent_at: null,
          last_presented_options: unknownReply.selectableItems,
          last_presented_options_at: unknownReply.selectableItems.length > 0 ? new Date().toISOString() : null,
        },
        preferredLanguage,
      ),
      trace,
    );
  }

  if (helpers.shouldDeferToContextSwitchFallback(context.messageText, normalizedText, interpretation)) {
    return {
      kind: "fallback",
      statePatch: helpers.withPreferredLanguage({ workflow_step: "awaiting_confirmation" }, preferredLanguage),
      trace,
    };
  }

  return helpers.replyDecision(
    prefersRomanUrdu
      ? "Order confirm karne ke liye *Haan* likhein, ya changes batayein."
      : "Reply *Yes* to confirm your order, or tell me what to change.",
    helpers.withPreferredLanguage({}, preferredLanguage),
    trace,
  );
}

export function handleLogisticsAndFallbackFlow(params: {
  context: TurnContext;
  interpretation: OrderTurnInterpretation;
  matchedAdds: MatchedItemsResult;
  preferredLanguage: LanguagePreference;
  trace: TurnTrace;
  helpers: LogisticsHelpers;
}): TurnDecision {
  const { context, interpretation, matchedAdds, preferredLanguage, trace, helpers } = params;
  const state = context.state;
  const prefersRomanUrdu = preferredLanguage === "roman_urdu";
  const normalizedText = normalizeText(context.messageText);
  const instructionCandidate = helpers.extractOrderInstructionCandidate(context.messageText);

  if (
    (state.workflow_step === "awaiting_order_type" ||
      state.workflow_step === "awaiting_delivery_address" ||
      state.workflow_step === "awaiting_dine_in_details" ||
      state.workflow_step === "awaiting_pickup_time" ||
      state.workflow_step === "awaiting_confirmation") &&
    state.cart.length === 0
  ) {
    return helpers.replyDecision(
      prefersRomanUrdu
        ? "Cart empty hai. Please pehle item add karein."
        : "Your cart is empty. Please add an item first.",
      helpers.withPreferredLanguage(
        {
          workflow_step: "collecting_items",
          order_type: null,
          address: null,
          guests: null,
          reservation_time: null,
        },
        preferredLanguage,
      ),
      trace,
    );
  }

  if (state.workflow_step === "awaiting_upsell_reply") {
    const isYesReply = helpers.isUpsellYes(normalizedText);
    const isNoReply = helpers.isUpsellNo(normalizedText);

    if (isYesReply && state.upsell_item_name && state.upsell_item_price != null) {
      const sourceItem = context.menuItems.find(
        (item) => normalizeText(item.name) === normalizeText(state.upsell_item_name ?? ""),
      );

      const upsellMenuItem: MenuCatalogItem = sourceItem ?? {
        id: `upsell_${normalizeText(state.upsell_item_name).replace(/\s+/g, "_") || "item"}`,
        name: state.upsell_item_name,
        price: state.upsell_item_price,
        category: null,
        is_available: true,
      };

      if (helpers.shouldPromptForQuantityPicker(upsellMenuItem)) {
        const quantityPrompt = helpers.buildQuantityPickerReply(upsellMenuItem, prefersRomanUrdu);

        return helpers.replyDecision(
          quantityPrompt.text,
          helpers.withPreferredLanguage(
            {
              workflow_step: "collecting_items",
              upsell_item_name: null,
              upsell_item_price: null,
              last_presented_category: helpers.buildQuantityPickerCategoryKey(upsellMenuItem.id),
              last_presented_options: [upsellMenuItem],
              last_presented_options_at: new Date().toISOString(),
            },
            preferredLanguage,
          ),
          trace,
          quantityPrompt.interactiveList,
        );
      }

      const upsellItem: DraftCartItem = {
        name: state.upsell_item_name,
        qty: 1,
        price: state.upsell_item_price,
        category: sourceItem?.category ?? null,
        size: null,
        addons: [],
        item_instructions: null,
      };
      const nextCart = helpers.mergeCartItems(state.cart, [upsellItem]);

      return helpers.replyDecision(
        prefersRomanUrdu
          ? `Theek hai, ${upsellItem.name} add kar diya. Aap aur items add kar sakte hain.`
          : `Great, I added ${upsellItem.name}. You can keep adding items.`,
        helpers.withPreferredLanguage(
          {
            cart: nextCart,
            workflow_step: "collecting_items",
            upsell_item_name: null,
            upsell_item_price: null,
          },
          preferredLanguage,
        ),
        trace,
        null,
        helpers.buildQuickOrderTypeReplyButtons(prefersRomanUrdu, context.settings.delivery_enabled),
      );
    }

    if (isNoReply || !state.upsell_item_name) {
      const declined = state.upsell_item_name
        ? [...new Set([...state.declined_upsells, state.upsell_item_name])]
        : state.declined_upsells;

      return helpers.replyDecision(
        prefersRomanUrdu
          ? "Theek hai, upsell skip kar diya. Aap aur items add kar sakte hain."
          : "No problem, skipped. You can keep adding items.",
        helpers.withPreferredLanguage(
          {
            workflow_step: "collecting_items",
            upsell_item_name: null,
            upsell_item_price: null,
            declined_upsells: declined,
          },
          preferredLanguage,
        ),
        trace,
        null,
        helpers.buildQuickOrderTypeReplyButtons(prefersRomanUrdu, context.settings.delivery_enabled),
      );
    }

    if (helpers.shouldDeferToContextSwitchFallback(context.messageText, normalizedText, interpretation)) {
      return {
        kind: "fallback",
        statePatch: helpers.withPreferredLanguage({ workflow_step: "awaiting_upsell_reply" }, preferredLanguage),
        trace,
      };
    }

    const upsellInteractive = helpers.buildUpsellReplyButtons(
      prefersRomanUrdu,
      state.upsell_item_name || undefined,
      state.upsell_item_price || undefined,
    );
    return helpers.replyDecision(
      prefersRomanUrdu
        ? `*${state.upsell_item_name}* add karna chahenge?`
        : `Would you like to add *${state.upsell_item_name}*?`,
      helpers.withPreferredLanguage({ workflow_step: "awaiting_upsell_reply" }, preferredLanguage),
      trace,
      null,
      upsellInteractive,
    );
  }

  if (state.workflow_step === "awaiting_order_type") {
    const quickOrderType = helpers.parseOrderTypeShortcut(normalizedText);
    if (quickOrderType) {
      return helpers.handleOrderTypeSelection(context, state, preferredLanguage, quickOrderType, trace);
    }

    const generalQtyOverride = helpers.inferGeneralQtyOverride(normalizedText, state);
    if (generalQtyOverride) {
      const updatedCart = helpers.applyQtyOverride(state.cart, generalQtyOverride.name, generalQtyOverride.qty);
      return helpers.replyDecision(
        [
          prefersRomanUrdu
            ? `Theek hai, maine quantity update kar di: ${generalQtyOverride.name} x${generalQtyOverride.qty}.`
            : `Done, quantity updated: ${generalQtyOverride.name} x${generalQtyOverride.qty}.`,
          !context.isOpenNow
            ? helpers.buildClosedReply(context.settings, prefersRomanUrdu, true)
            : prefersRomanUrdu
              ? "Aap aur items add kar sakte hain."
              : "You can keep adding items.",
        ].join("\n\n"),
        helpers.withPreferredLanguage(
          {
            cart: updatedCart,
            workflow_step: "collecting_items",
          },
          preferredLanguage,
        ),
        trace,
        null,
        context.isOpenNow
          ? helpers.buildQuickOrderTypeReplyButtons(prefersRomanUrdu, context.settings.delivery_enabled)
          : null,
      );
    }

    const lastItemOverrideQty = helpers.inferLastItemQtyOverride(normalizedText, state);
    if (lastItemOverrideQty != null) {
      const updatedCart = helpers.applyLastItemQtyOverride(state.cart, lastItemOverrideQty);
      return helpers.replyDecision(
        [
          prefersRomanUrdu
            ? `Theek hai, maine quantity update kar di: ${updatedCart[updatedCart.length - 1].name} x${lastItemOverrideQty}.`
            : `Done, quantity updated: ${updatedCart[updatedCart.length - 1].name} x${lastItemOverrideQty}.`,
          !context.isOpenNow
            ? helpers.buildClosedReply(context.settings, prefersRomanUrdu, true)
            : prefersRomanUrdu
              ? "Aap aur items add kar sakte hain."
              : "You can keep adding items.",
        ].join("\n\n"),
        helpers.withPreferredLanguage(
          {
            cart: updatedCart,
            workflow_step: "collecting_items",
          },
          preferredLanguage,
        ),
        trace,
        null,
        context.isOpenNow
          ? helpers.buildQuickOrderTypeReplyButtons(prefersRomanUrdu, context.settings.delivery_enabled)
          : null,
      );
    }

    if (interpretation.order_type) {
      return helpers.handleOrderTypeSelection(context, state, preferredLanguage, interpretation.order_type, trace);
    }

    if (helpers.shouldDeferToContextSwitchFallback(context.messageText, normalizedText, interpretation)) {
      return {
        kind: "fallback",
        statePatch: helpers.withPreferredLanguage({ workflow_step: "awaiting_order_type" }, preferredLanguage),
        trace,
      };
    }

    return helpers.replyDecision(
      prefersRomanUrdu
        ? `${helpers.buildOrderTypePrompt(context.settings.delivery_enabled, prefersRomanUrdu)} Agar quantity ya item remove karna ho to bhi likh dein.`
        : `${helpers.buildOrderTypePrompt(context.settings.delivery_enabled, prefersRomanUrdu)} You can also ask to remove items or change quantity.`,
      helpers.withPreferredLanguage({ workflow_step: "awaiting_order_type" }, preferredLanguage),
      trace,
      null,
      helpers.buildOrderTypeReplyButtons(prefersRomanUrdu, context.settings.delivery_enabled),
    );
  }

  if (state.workflow_step === "awaiting_delivery_address") {
    if (interpretation.order_type === "dine-in") {
      return helpers.handleOrderTypeSelection(context, state, preferredLanguage, "dine-in", trace);
    }
    if (interpretation.order_type === "pickup") {
      return helpers.handleOrderTypeSelection(context, state, preferredLanguage, "pickup", trace);
    }

    const address = interpretation.address ?? parseAddress(context.messageText);
    if (!address) {
      if (helpers.shouldDeferToContextSwitchFallback(context.messageText, normalizedText, interpretation)) {
        return {
          kind: "fallback",
          statePatch: helpers.withPreferredLanguage({ workflow_step: "awaiting_delivery_address" }, preferredLanguage),
          trace,
        };
      }

      const isRetrying = context.session.invalid_step_count > 0;
      return helpers.replyDecision(
        prefersRomanUrdu
          ? isRetrying
            ? "Mujhe address samajh nahi aaya. Please apna mukammal (full) delivery address clearly type karein. Agar masla ho to 'human' type karein."
            : "Please apna poora delivery address bhej dein."
          : isRetrying
            ? "I couldn't quite understand the address. Could you please type your full delivery address clearly? If you're stuck, type 'human'."
            : "Please send your full delivery address.",
        helpers.withPreferredLanguage({ workflow_step: "awaiting_delivery_address" }, preferredLanguage),
        trace,
      );
    }

    return helpers.buildSummaryReply(
      {
        state: {
          ...state,
          preferred_language: preferredLanguage,
          address,
          order_type: "delivery",
        },
        settings: context.settings,
      },
      trace,
    );
  }

  if (state.workflow_step === "awaiting_dine_in_details") {
    if (interpretation.order_type === "delivery") {
      return helpers.handleOrderTypeSelection(context, state, preferredLanguage, "delivery", trace);
    }
    if (interpretation.order_type === "pickup") {
      return helpers.handleOrderTypeSelection(context, state, preferredLanguage, "pickup", trace);
    }

    const guests = interpretation.guests ?? parseGuestCount(normalizedText, helpers.clampQty) ?? state.guests;
    const reservationTime =
      parseReservationTime(interpretation.reservation_time ?? context.messageText, {
        opening_time: context.settings.opening_time,
        closing_time: context.settings.closing_time,
      }) ??
      state.reservation_time;

    if (!guests || !reservationTime) {
      if (helpers.shouldDeferToContextSwitchFallback(context.messageText, normalizedText, interpretation)) {
        return {
          kind: "fallback",
          statePatch: helpers.withPreferredLanguage(
            {
              workflow_step: "awaiting_dine_in_details",
              guests: guests ?? null,
              reservation_time: reservationTime ?? null,
            },
            preferredLanguage,
          ),
          trace,
        };
      }

      const isRetrying = context.session.invalid_step_count > 0;
      return helpers.replyDecision(
        prefersRomanUrdu
          ? isRetrying
            ? "Mujhe details samajh nahi aayin. Please clearly batayein: Kitne guests honge aur kis time aana hai? Misal: *4 guests at 8 PM*."
            : "Kitne guests honge aur kis time aana hai? Misal: *4 guests at 8 PM*."
          : isRetrying
            ? "I didn't catch the details. Please clearly state how many guests and what time? Example: *4 guests at 8 PM*."
            : "How many guests and what time? Example: *4 guests at 8 PM*.",
        helpers.withPreferredLanguage(
          {
            workflow_step: "awaiting_dine_in_details",
            guests: guests ?? null,
            reservation_time: reservationTime ?? null,
          },
          preferredLanguage,
        ),
        trace,
      );
    }

    return helpers.buildSummaryReply(
      {
        state: {
          ...state,
          preferred_language: preferredLanguage,
          order_type: "dine-in",
          guests,
          reservation_time: reservationTime,
          address: null,
        },
        settings: context.settings,
      },
      trace,
    );
  }

  if (state.workflow_step === "awaiting_pickup_time") {
    if (interpretation.order_type === "delivery") {
      return helpers.handleOrderTypeSelection(context, state, preferredLanguage, "delivery", trace);
    }
    if (interpretation.order_type === "dine-in") {
      return helpers.handleOrderTypeSelection(context, state, preferredLanguage, "dine-in", trace);
    }

    const pickupTime =
      parseReservationTime(interpretation.reservation_time ?? context.messageText, {
        opening_time: context.settings.opening_time,
        closing_time: context.settings.closing_time,
      }) ?? state.pickup_time;

    if (!pickupTime) {
      if (helpers.shouldDeferToContextSwitchFallback(context.messageText, normalizedText, interpretation)) {
        return {
          kind: "fallback",
          statePatch: helpers.withPreferredLanguage(
            {
              workflow_step: "awaiting_pickup_time",
              pickup_time: pickupTime ?? null,
            },
            preferredLanguage,
          ),
          trace,
        };
      }

      const isRetrying = context.session.invalid_step_count > 0;
      return helpers.replyDecision(
        prefersRomanUrdu
          ? isRetrying
            ? "Pickup time samajh nahi aaya. Please clearly time bhej dein. Misal: *8 PM* ya *in 30 minutes*."
            : "Pickup ke liye kis time aana hai? Misal: *8 PM* ya *in 30 minutes*."
          : isRetrying
            ? "I didn't catch the pickup time. Please send it clearly, for example: *8 PM* or *in 30 minutes*."
            : "What time would you like to pick it up? Example: *8 PM* or *in 30 minutes*.",
        helpers.withPreferredLanguage(
          {
            workflow_step: "awaiting_pickup_time",
            pickup_time: pickupTime ?? null,
          },
          preferredLanguage,
        ),
        trace,
      );
    }

    return helpers.buildSummaryReply(
      {
        state: {
          ...state,
          preferred_language: preferredLanguage,
          order_type: "pickup",
          pickup_time: pickupTime,
          address: null,
          guests: null,
          reservation_time: null,
        },
        settings: context.settings,
      },
      trace,
    );
  }

  if (state.cart.length > 0) {
    if (instructionCandidate) {
      return helpers.replyDecision(
        prefersRomanUrdu
          ? `Theek hai, order instructions update kar di: ${instructionCandidate}`
          : `Sure, I updated your order instructions: ${instructionCandidate}`,
        helpers.withPreferredLanguage(
          {
            ...helpers.buildPersistedStatePatch({
              ...state,
              customer_instructions: instructionCandidate,
              preferred_language: preferredLanguage,
            }),
            workflow_step: "collecting_items",
          },
          preferredLanguage,
        ),
        trace,
        null,
        helpers.buildQuickOrderTypeReplyButtons(prefersRomanUrdu, context.settings.delivery_enabled),
      );
    }

    if (interpretation.order_type) {
      return helpers.handleOrderTypeSelection(context, state, preferredLanguage, interpretation.order_type, trace);
    }

    if (isCheckoutRequest(normalizedText, interpretation)) {
      return helpers.replyDecision(
        prefersRomanUrdu
          ? `${helpers.buildOrderTypePrompt(context.settings.delivery_enabled, prefersRomanUrdu)}`
          : `${helpers.buildOrderTypePrompt(context.settings.delivery_enabled, prefersRomanUrdu)}`,
        helpers.withPreferredLanguage({ workflow_step: "awaiting_order_type" }, preferredLanguage),
        trace,
        null,
        helpers.buildOrderTypeReplyButtons(prefersRomanUrdu, context.settings.delivery_enabled),
      );
    }

    return helpers.replyDecision(
      prefersRomanUrdu
        ? "Aap aur items add kar sakte hain."
        : "You can keep adding items.",
      helpers.withPreferredLanguage({ workflow_step: "collecting_items" }, preferredLanguage),
      trace,
      null,
      helpers.buildQuickOrderTypeReplyButtons(prefersRomanUrdu, context.settings.delivery_enabled),
    );
  }

  if (matchedAdds.unknown.length > 0 || interpretation.unknown_items.length > 0) {
    const unknown = [...new Set([...matchedAdds.unknown, ...interpretation.unknown_items])].slice(0, 3);
    const unknownReply = helpers.buildUnknownItemReplyData(unknown, context.menuItems, prefersRomanUrdu, context.semanticMatches);
    if (unknownReply.autoAdd && unknownReply.selectableItems.length === 1) {
      const autoItem = unknownReply.selectableItems[0];
      const autoQty = Math.max(1, Math.min(50, extractAnyQuantity(context.messageText) ?? 1));
      const newCart = helpers.mergeCartItems(state.cart, [
        { name: autoItem.name, qty: autoQty, price: autoItem.price, category: autoItem.category, size: null, addons: [], item_instructions: null },
      ]);
      return helpers.replyDecision(
        unknownReply.text,
        helpers.withPreferredLanguage({ cart: newCart, workflow_step: "collecting_items", last_presented_options: null, last_presented_options_at: null }, preferredLanguage),
        trace,
      );
    }
    return helpers.replyDecision(
      unknownReply.text,
      helpers.withPreferredLanguage(
        {
          workflow_step: "collecting_items",
          last_presented_options: unknownReply.selectableItems,
          last_presented_options_at: unknownReply.selectableItems.length > 0 ? new Date().toISOString() : null,
        },
        preferredLanguage,
      ),
      trace,
    );
  }

  if (interpretation.intent === "greeting") {
    return helpers.replyDecision(
      prefersRomanUrdu
        ? "Ji, main yahan hoon. Aap *menu* likh dein ya item ka naam quantity ke sath bhej dein."
        : "Hi, I am here to help. You can send *menu* or share an item name with quantity.",
      helpers.withPreferredLanguage({}, preferredLanguage),
      trace,
    );
  }

  if (interpretation.intent === "chitchat" || interpretation.intent === "unknown") {
    return {
      kind: "fallback",
      statePatch: helpers.withPreferredLanguage({}, preferredLanguage),
      trace,
    };
  }

  return helpers.replyDecision(
    prefersRomanUrdu
      ? "Aap *menu* likh dein ya item ka naam aur quantity bhej dein. Misal: *2 Chicken Biryani*."
      : "You can send *menu* or item name with quantity, for example: *2 Chicken Biryani*.",
    helpers.withPreferredLanguage({ workflow_step: "collecting_items" }, preferredLanguage),
    trace,
  );
}
