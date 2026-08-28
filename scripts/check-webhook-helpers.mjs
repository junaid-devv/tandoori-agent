import assert from "node:assert/strict";
import {
  buildInteractiveCategoryList,
  buildInteractiveListForCities,
  dedupeCities,
  findCitySelection,
} from "../lib/webhook-city-helpers.ts";
import {
  buildInteractiveListForBranches,
  buildInteractiveListForPresentedOptions,
} from "../lib/webhook-interactive-builders.ts";
import {
  buildCategoryItemsReply,
  buildMenuItemRowId,
} from "../lib/order-menu-replies.ts";

function pass(message) {
  console.log(`PASS: ${message}`);
}

function testCityHelpers() {
  const deduped = dedupeCities(["Lahore", "lahore", "Karachi", "KARACHI"]);
  assert.equal(deduped.length, 2);
  assert.equal(findCitySelection("city_option_2", ["Lahore", "Karachi"]), "Karachi");
  assert.equal(findCitySelection("2", ["Lahore", "Karachi"]), "Karachi");

  const cityList = buildInteractiveListForCities(["Lahore", "Karachi"], false);
  assert.ok(cityList);
  assert.equal(cityList.rows[0].id, "city_option_1");
  pass("City helpers dedupe and interactive selection parsing work.");
}

function testCategoryInteractivePagination() {
  const menuItems = Array.from({ length: 11 }).map((_, index) => ({
    category: `Category ${index + 1}`,
  }));
  const page1 = buildInteractiveCategoryList(menuItems, false, 1);
  assert.ok(page1);
  assert.equal(page1.rows.length, 10);
  assert.ok(page1.rows.some((row) => row.id === "category_more_2"));
  pass("Category interactive builder paginates and emits category_more controls.");
}

function testInteractiveBuilders() {
  const presented = buildInteractiveListForPresentedOptions(
    [
      { id: "i1", name: "Chicken Karahi", price: 1395, category: "Pakistani", is_available: true },
      { id: "i2", name: "Kheer", price: 295, category: "Desserts", is_available: true },
    ],
    false,
  );
  assert.ok(presented);
  assert.equal(presented.rows.length, 2);
  assert.equal(presented.rows[0].id, buildMenuItemRowId("i1"));

  const branchList = buildInteractiveListForBranches(
    [{ id: "b1", name: "Main Branch", slug: "main", address: "Mall Road, Lahore" }],
    false,
    "Lahore",
  );
  assert.ok(branchList);
  assert.equal(branchList.rows[0].id, "b1");
  pass("Interactive list builders return expected list payloads.");
}

function testCategoryItemRowsUseStableItemIds() {
  const reply = buildCategoryItemsReply(
    "Pakistani Cuisine",
    [
      { id: "hari-mirch-1", name: "Chicken Hari Mirch", price: 1495, category: "Pakistani Cuisine", is_available: true },
      { id: "karahi-1", name: "Chicken Karahi", price: 1395, category: "Pakistani Cuisine", is_available: true },
    ],
    false,
  );

  assert.ok(reply.interactiveList);
  assert.equal(reply.interactiveList.rows[0].id, buildMenuItemRowId("hari-mirch-1"));
  assert.equal(reply.interactiveList.rows[0].title, "Chicken Hari Mirch");
  pass("Category item rows use stable menu item IDs instead of item names.");
}

// NOTE: WhatsApp Flow payload builders were removed in the rebuild (dead code, never
// deployed). Only the interactive list/city/category builders survive and are tested above.

try {
  testCityHelpers();
  testCategoryInteractivePagination();
  testInteractiveBuilders();
  testCategoryItemRowsUseStableItemIds();
} catch (error) {
  console.error("FAIL:", error instanceof Error ? error.message : error);
  process.exit(1);
}
