/**
 * scripts/check-cart.mjs — Phase 7 pure cart-operation tests.
 * Run: node --no-warnings --import ./scripts/alias-register.mjs --experimental-strip-types scripts/check-cart.mjs
 */
import { addToCart, removeFromCart, updateQuantity, cartSubtotal } from "../lib/agent/cart.ts";

let failures = 0;
function pass(m) { console.log(`PASS: ${m}`); }
function fail(m) { console.error(`FAIL: ${m}`); failures += 1; }
function check(c, m) { c ? pass(m) : fail(m); }

const mk = (id, name, price, qty = 1, size = null) => ({
  menu_item_id: id, name, unit_price: price, qty, size, addons: [], notes: null,
});

console.log("\n== cart ops ==");

// add new
let cart = addToCart([], mk("a", "Biryani", 300, 2));
check(cart.length === 1 && cart[0].qty === 2, "add new item");

// add same line merges qty
cart = addToCart(cart, mk("a", "Biryani", 300, 1));
check(cart.length === 1 && cart[0].qty === 3, "same item merges quantity");

// different size = separate line
cart = addToCart(cart, mk("a", "Biryani", 350, 1, "large"));
check(cart.length === 2, "different size creates separate line");

// subtotal
check(cartSubtotal(cart) === 300 * 3 + 350 * 1, "subtotal computed correctly");

// qty cap at 50
let capped = addToCart([], mk("b", "Coke", 100, 60));
check(capped[0].qty === 50, "quantity capped at 50");

// remove partial
let c2 = addToCart([], mk("a", "Roll", 200, 5));
c2 = removeFromCart(c2, { menu_item_id: "a", qty: 2 });
check(c2[0].qty === 3, "partial removal reduces qty");

// remove all
c2 = removeFromCart(c2, { menu_item_id: "a", qty: "all" });
check(c2.length === 0, "remove all clears the line");

// remove by name
let c3 = addToCart([], mk("x", "Fries", 150, 1));
c3 = removeFromCart(c3, { name: "fries", qty: "all" });
check(c3.length === 0, "remove by name (case-insensitive)");

// update quantity
let c4 = addToCart([], mk("y", "Naan", 40, 1));
c4 = updateQuantity(c4, { menu_item_id: "y", qty: 4 });
check(c4[0].qty === 4, "update quantity sets absolute qty");

// update quantity floors at 1
c4 = updateQuantity(c4, { menu_item_id: "y", qty: 0 });
check(c4[0].qty === 1, "update quantity floors at 1");

console.log("");
if (failures > 0) {
  console.error(`CART CHECK FAILED: ${failures} failure(s)`);
  process.exitCode = 1;
} else {
  console.log("CART CHECK PASSED");
}
