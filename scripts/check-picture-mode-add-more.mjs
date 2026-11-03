import assert from "node:assert/strict";
import { reply } from "../lib/agent/reply.ts";
import { nextTransition } from "../lib/agent/state-machine.ts";
import { executeTurn } from "../lib/agent/executor.ts";

function pass(message) {
  console.log(`PASS: ${message}`);
}

console.log("\n== Testing Picture Mode 'Add More' Behavior ==");

// 1) Test reply texts for askAddMore across languages
assert.equal(reply.askAddMore("roman_urdu"), "Aur kya add karna hai? Batayein! 😊");
assert.equal(reply.askAddMore("english"), "What would you like to add? 😊");
pass("reply.askAddMore correctly handles Roman Urdu and English.");

// 2) Test nextTransition passes isAddMore in show_menu action payload
const uAddMore = {
  intents: ["browse_menu"],
  primary_intent: "browse_menu",
  confidence: 0.95,
  language: "roman_urdu",
  items: [],
  removals: [],
  order_type: null,
  address: null,
  guests: null,
  reservation_time: null,
  pickup_time: null,
  info_query: "add_more",
  sentiment: "neutral",
  wants_human: false,
  notes: "fast_path_add_more",
};

const stateView = {
  stage: "building_cart",
  cart: [{ menu_item_id: "m1", name: "Zinger Burger", unit_price: 450, qty: 1, size: null, addons: [], notes: null }],
  order_type: null,
  has_address: false,
  has_dinein_details: false,
  has_pickup_time: false,
  upsell_offered: true,
  anger_level: 0,
  consecutive_failures: 0,
  invalid_step_count: 0,
  awaiting_selection: false,
};

const transitionAddMore = nextTransition(stateView, uAddMore);
const showMenuAction = transitionAddMore.actions.find((a) => a.kind === "show_menu");
assert(showMenuAction, "Expected show_menu action in transition");
assert.equal(showMenuAction.payload?.isAddMore, true, "Expected isAddMore to be true in show_menu payload");
pass("nextTransition correctly attaches isAddMore: true to show_menu action.");

// 3) Test executeTurn with menu_pictures and isAddMore=true (NO media pictures sent!)
const mockMenu = [
  { id: "m1", name: "Zinger Burger", price: 450, category: "Burgers", is_available: true },
];

const mockContext = {
  state: {
    stage: "building_cart",
    cart: [{ menu_item_id: "m1", name: "Zinger Burger", unit_price: 450, qty: 1, size: null, addons: [], notes: null }],
    preferred_language: "roman_urdu",
    last_shown_options: [],
  },
  view: stateView,
  settings: {
    opening_time: "11:00",
    closing_time: "23:00",
    timezone: "Asia/Karachi",
    currency: "Rs.",
  },
  menu: mockMenu,
  isOpenNow: true,
};

const menuCardImages = ["https://example.com/menu1.jpg", "https://example.com/menu2.jpg"];

const resAddMore = await executeTurn({
  transition: transitionAddMore,
  understanding: uAddMore,
  ctx: mockContext,
  branchId: "branch-1",
  conversationId: "conv-1",
  sourceUserMessageId: "msg-1",
  appName: "Cheezo Bites",
  currency: "Rs.",
  menuDisplayMode: "menu_pictures",
  menuCardImages,
});

assert.equal(resAddMore.mediaUrls, undefined, "Expected mediaUrls to be undefined when adding more in picture mode");
assert(resAddMore.replyText.includes("Aur kya add karna hai"), `Expected reply text to ask what to add, got: ${resAddMore.replyText}`);
assert(!resAddMore.replyText.includes("Tasweer dekh kar"), "Expected menu picture invite copy NOT to be sent on add more");
pass("executeTurn does NOT send mediaUrls and asks what to add when isAddMore is true in picture mode.");

// 4) Test executeTurn with menu_pictures and explicit menu view (media pictures ARE sent!)
const uViewMenu = {
  intents: ["browse_menu"],
  primary_intent: "browse_menu",
  confidence: 0.95,
  language: "roman_urdu",
  items: [],
  removals: [],
  order_type: null,
  address: null,
  guests: null,
  reservation_time: null,
  pickup_time: null,
  info_query: "view_menu",
  sentiment: "neutral",
  wants_human: false,
  notes: "fast_path_view_menu",
};

const transitionViewMenu = nextTransition(stateView, uViewMenu);
const resViewMenu = await executeTurn({
  transition: transitionViewMenu,
  understanding: uViewMenu,
  ctx: mockContext,
  branchId: "branch-1",
  conversationId: "conv-1",
  sourceUserMessageId: "msg-2",
  appName: "Cheezo Bites",
  currency: "Rs.",
  menuDisplayMode: "menu_pictures",
  menuCardImages,
});

assert.deepEqual(resViewMenu.mediaUrls, menuCardImages, "Expected mediaUrls to contain menuCardImages when explicitly viewing menu");
assert(resViewMenu.replyText.includes("Tasweer dekh kar") || resViewMenu.replyText.includes("menu"), "Expected menuPictureInvite copy when explicitly viewing menu");
pass("executeTurn DOES send mediaUrls when explicitly viewing menu in picture mode.");

// 5) Test understandingFromInteractiveId for action:add_more and action:view_menu
import { understandingFromInteractiveId } from "../lib/agent/pipeline.ts";

const uActionAddMore = understandingFromInteractiveId("action:add_more", "roman_urdu", []);
assert(uActionAddMore, "Expected understandingFromInteractiveId to handle action:add_more");
assert.equal(uActionAddMore.intents[0], "browse_menu");
assert.equal(uActionAddMore.info_query, "add_more");
assert.equal(uActionAddMore.notes, "fast_path_add_more");
pass("understandingFromInteractiveId correctly produces fast_path_add_more for action:add_more.");

const uActionViewMenu = understandingFromInteractiveId("action:view_menu", "roman_urdu", []);
assert(uActionViewMenu, "Expected understandingFromInteractiveId to handle action:view_menu");
assert.equal(uActionViewMenu.intents[0], "browse_menu");
assert.equal(uActionViewMenu.info_query, "view_menu");
assert.equal(uActionViewMenu.notes, "fast_path_view_menu");
pass("understandingFromInteractiveId correctly produces fast_path_view_menu for action:view_menu.");

// 6) Test Add More text pattern variations
const ADD_MORE_RE = /^(?:(?:kuch\s+)?(?:aur|or)\s+(?:(?:kya|kia)\s+add\s+k(?:ar|r|a)?na\s+h(?:ai)?|add\s+(?:karein|karen|k(?:ar|r|a)?na\s+h(?:ai)?|k(?:ar|r|a)?na|k(?:ar|r)?do|karo|bhejo|dalein|dalen)|dalein|dalen|daalain|daalo|dalo|kuch(?:\s+add\s+k(?:ar|r|a)?na\s+h(?:ai)?)?|mangwana\s+h(?:ai)?|lena\s+h(?:ai)?|add)|kuch\s+(?:aur|or)\s+add\s+k(?:ar|r|a)?na\s+h(?:ai)?|add\s*more(?:\s+items?)?|want\s+to\s+add\s+more|nor\s+(?:tse\s+)?add(?:\s+kawal(?:\s+ghwaram)?)?)[!.]*$/i;

const positivePhrases = [
  "add more",
  "Add More",
  "add more items",
  "aur dalein",
  "aur add karein",
  "aur add krna hai",
  "aur add karna hai",
  "or add krna hai",
  "or kia add krna hai",
  "aur kya add karna hai",
  "aur kuch add karna hai",
  "kuch aur add karna hai",
  "aur add krdo",
  "aur add kardo",
  "aur mangwana hai",
  "aur kuch",
  "or kuch",
  "nor tse add kawal",
];

for (const phrase of positivePhrases) {
  assert(ADD_MORE_RE.test(phrase), `Expected "${phrase}" to match ADD_MORE_RE`);
}
pass("ADD_MORE_RE correctly matches all Pakistani customer variations.");

// Ensure specific item orders like "1 burger aur add krdo" or "2 coke" do NOT falsely match
const negativePhrases = [
  "1 zinger burger",
  "2 aur add karo", // this is delta qty for an item, not general add more
  "chicken karahi aur add krdo",
  "menu",
  "menu dikhao",
  "checkout",
];

for (const phrase of negativePhrases) {
  assert(!ADD_MORE_RE.test(phrase), `Expected "${phrase}" NOT to match ADD_MORE_RE`);
}
pass("ADD_MORE_RE correctly excludes specific item orders and other intents.");

console.log("\nALL PICTURE MODE 'ADD MORE' TESTS PASSED! ✅\n");
