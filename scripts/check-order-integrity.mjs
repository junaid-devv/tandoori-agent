/** Executes the real migration and placement RPC in isolated PostgreSQL (PGlite). */
import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const migrationPath = "supabase/migrations/20261025124633_restaurant_order_integrity.sql";
const branch = "11111111-1111-4111-8111-111111111111";
const otherBranch = "11111111-1111-4111-8111-111111111112";
const conversation = "22222222-2222-4222-8222-222222222222";
const menuId = "33333333-3333-4333-8333-333333333333";
const items = [{ menu_item_id: menuId, name: "Plain Naan", qty: 2, unit_price: 50, size: null, addons: [], item_instructions: "less oil" }];
let checks = 0;
const pass = (text) => { checks++; console.log(`PASS: ${text}`); };
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table conversations(id uuid primary key, branch_id uuid not null);
    create table restaurant_settings(branch_id uuid primary key,
      is_accepting_orders boolean default true, opening_time text default '12:00 AM', closing_time text default '11:59 PM',
      delivery_enabled boolean default true, delivery_fee numeric default 100, min_delivery_amount numeric default 0, delivery_areas jsonb default '[]');
    create table messages(id uuid primary key, conversation_id uuid references conversations(id), role text, metadata jsonb default '{}');
    create table orders(id uuid primary key default gen_random_uuid(), branch_id uuid, conversation_id uuid,
      source_user_message_id text unique, type text, subtotal numeric, delivery_fee numeric,
      total numeric generated always as (subtotal + delivery_fee) stored, customer_instructions text,
      address text, guests integer, reservation_time timestamptz, pickup_time timestamptz, status text);
    create table order_items(id uuid primary key default gen_random_uuid(), order_id uuid references orders(id),
      name text, qty integer, price numeric, size text, addons jsonb, item_instructions text);
    create table menu_items(id uuid primary key, branch_id uuid, name text, price numeric, is_available boolean default true,
      available_days jsonb default '[]', available_start_time text, available_end_time text, sort_order integer default 0, created_at timestamptz default now());
  `);
  const schema = fs.readFileSync("db/schema.sql", "utf8");
  const stateStart = schema.indexOf("create table conversation_states (");
  await db.exec(schema.slice(stateStart, schema.indexOf("\n);", stateStart) + 3));
  await db.exec(fs.readFileSync(migrationPath, "utf8"));
  pass("migration creates functions and deferred trigger in PostgreSQL");
  await db.query("insert into conversations values ($1,$2)", [conversation, branch]);
  await db.query("insert into restaurant_settings(branch_id) values ($1),($2)", [branch, otherBranch]);
  await db.query("insert into menu_items(id,branch_id,name,price) values ($1,$2,'Plain Naan',50)", [menuId, branch]);
  const reset = async () => {
    await db.exec("truncate order_items, orders; delete from conversation_states; update menu_items set price=50,is_available=true,available_days='[]',available_start_time=null,available_end_time=null; update restaurant_settings set is_accepting_orders=true,delivery_enabled=true,delivery_fee=100,min_delivery_amount=0,delivery_areas='[]';");
    await db.query(`insert into conversation_states(conversation_id,stage,summary_sent_at,cart,order_type,address)
      values ($1,'confirming',now(),$2::jsonb,'delivery','House 12 Street 4 Gulberg')`, [conversation, JSON.stringify(items.map(({ item_instructions, ...i }) => ({ ...i, notes: item_instructions })))]);
  };
  const place = async ({ source = "wamid.test", targetBranch = branch, payload = items, type = "delivery", address = "House 12 Street 4 Gulberg", pickupTime = null, guests = null, reservationTime = null } = {}) =>
    db.query("select * from place_order_from_payload($1::uuid,$2::uuid,$3::text,$4::text,$5::jsonb,null,$6::text,$7::integer,$8::timestamptz,$9::timestamptz,999::numeric)",
      [conversation, targetBranch, source, type, JSON.stringify(payload), address, guests, reservationTime, pickupTime]);
  const count = async () => Number((await db.query("select count(*)::integer n from orders")).rows[0].n);
  const rollsBack = async (name, setup, options = {}) => {
    await reset(); if (setup) await setup();
    await assert.rejects(() => place(options));
    assert.equal(await count(), 0);
    assert.equal((await db.query("select stage from conversation_states")).rows[0].stage, "confirming");
    pass(name);
  };
  await reset();
  const first = await place();
  assert.equal(await count(), 1);
  const state = (await db.query("select * from conversation_states")).rows[0];
  assert.equal(state.stage, "placed"); assert.deepEqual(state.cart, []); assert.equal(state.summary_sent_at, null);
  assert.equal((await db.query("select total from orders")).rows[0].total, "200");
  pass("commit atomically places all lines, uses configured fee and clears the reviewed draft");
  const duplicate = await place();
  assert.equal(duplicate.rows[0].id, first.rows[0].id); assert.equal(await count(), 1);
  pass("same-message retry returns the original order without another insert");
  await assert.rejects(() => place({ source: "wamid.second-confirm" })); assert.equal(await count(), 1);
  pass("a second confirmation cannot create another order after the draft was consumed");
  await rollsBack("changed menu price rolls back order and preserves draft", () => db.exec("update menu_items set price=75"));
  await rollsBack("unavailable menu item cannot be ordered", () => db.exec("update menu_items set is_available=false"));
  await rollsBack("missing summary cannot authorize placement", () => db.exec("update conversation_states set summary_sent_at=null"));
  await rollsBack("restaurant paused after summary cannot accept an order", () => db.exec("update restaurant_settings set is_accepting_orders=false"));
  await rollsBack("different branch cannot consume this conversation's order", () => db.query("update conversations set branch_id=$1", [otherBranch]));
  await db.query("update conversations set branch_id=$1", [branch]);
  await rollsBack("changed preparation notes cannot bypass renewed review", null, { payload: [{ ...items[0], item_instructions: "extra spicy" }] });
  await rollsBack("unpriced extras cannot be inserted as free addons", () => db.query("update conversation_states set cart=$1", [JSON.stringify([{ ...items[0], notes: "less oil", addons: ["extra cheese"] }])]), { payload: [{ ...items[0], addons: ["extra cheese"] }] });
  await rollsBack("below-minimum delivery cannot be committed", () => db.exec("update restaurant_settings set min_delivery_amount=1000"));
  await rollsBack("coverage binds the phase number instead of any house number", () => db.exec("update restaurant_settings set delivery_areas='[\"DHA Phase 1-6\"]'"), { address: "House 2 DHA Phase 9" });
  await rollsBack("wrong menu ID cannot substitute a similarly named item", null, { payload: [{ ...items[0], menu_item_id: otherBranch }] });
  await rollsBack("changed quantity cannot bypass the reviewed cart", null, { payload: [{ ...items[0], qty: 3 }] });
  await rollsBack("pickup times must be valid and in the future", null, { type: "pickup", pickupTime: "2020-01-01T00:00:00Z" });
  await rollsBack("dine-in requires a valid guest count and future time", null, { type: "dine-in", guests: 0, reservationTime: new Date(Date.now() + 3600_000).toISOString() });
  await rollsBack("root rider instructions cannot change after review", () => db.exec("update conversation_states set customer_instructions='Call at the gate'"));
  const latePickup = new Date(Date.now() + 12 * 3600_000).toISOString();
  await rollsBack("scheduled pickup outside restaurant hours cannot commit", async () => {
    await db.exec("update restaurant_settings set opening_time=to_char((now() at time zone 'Asia/Karachi') - interval '1 hour','HH24:MI'), closing_time=to_char((now() at time zone 'Asia/Karachi') + interval '1 hour','HH24:MI')");
    await db.query("update conversation_states set order_type='pickup',pickup_time=$1", [latePickup]);
  }, { type: "pickup", pickupTime: latePickup });
  await db.exec("update restaurant_settings set opening_time='12:00 AM',closing_time='11:59 PM'");
  assert.equal((await db.query("select restaurant_agent_integrity_version() version")).rows[0].version, "20261025124633");
  pass("read-only deployment probe confirms the required migration version");
  const coverage = (await db.query(`select restaurant_delivery_area_covers('House 2 DHA Phase 9','DHA Phase 1-6') bad,
    restaurant_delivery_area_covers('House 99 DHA Phase 5','DHA Phase 1-6') good,
    restaurant_delivery_area_covers('House 1 Askari 11','Askari 10') wrong_number`)).rows[0];
  assert.deepEqual(coverage, { bad: false, good: true, wrong_number: false });
  pass("database delivery coverage agrees with application coverage");
  await db.exec("set role anon");
  try { await assert.rejects(() => place(), /permission denied/); } finally { await db.exec("reset role"); }
  pass("anonymous clients cannot invoke privileged order placement");
  await reset();
  const message = "44444444-4444-4444-8444-444444444444";
  await db.query("insert into messages(id,conversation_id,role) values ($1,$2,'user')", [message, conversation]);
  const commit = async (messageId, patch) => db.query("select commit_restaurant_agent_turn($1,$2,$3) applied", [conversation, messageId, JSON.stringify(patch)]);
  assert.equal((await commit(message, { stage: "building_cart", cart: [{ ...items[0], qty: 3 }] })).rows[0].applied, true);
  assert.equal((await db.query("select metadata from messages where id=$1", [message])).rows[0].metadata.agent_processed, true);
  assert.equal((await commit(message, { cart: [{ ...items[0], qty: 9 }] })).rows[0].applied, false);
  assert.equal((await db.query("select cart from conversation_states")).rows[0].cart[0].qty, 3);
  pass("draft mutation and durable inbound receipt commit together; old message replay cannot alter quantities");
  await assert.rejects(() => commit(otherBranch, { stage: "human", cart: [] }), /does not belong/);
  assert.equal((await db.query("select stage from conversation_states")).rows[0].stage, "building_cart");
  pass("unknown or cross-conversation inbound message rolls back its state mutation");
  console.log(`\nORDER INTEGRITY: ${checks} PostgreSQL checks passed.`);
} finally { await db.close(); }
