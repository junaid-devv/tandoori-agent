/** Real TypeScript/PostgreSQL parity for delivery spelling and fee safeguards. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { resolveDeliveryQuote, validateDeliveryZones } from "../lib/delivery-pricing.ts";

const db = new PGlite();
const branch = "11111111-1111-4111-8111-111111111111";
const confirmed = validateDeliveryZones(JSON.parse(fs.readFileSync("data/foods-carnival-delivery-zones.json", "utf8")));
let settings = { delivery_fee: 0, delivery_pricing_mode: "area", delivery_zones: confirmed };
let checks = 0;
try {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table restaurant_settings(branch_id uuid primary key, delivery_enabled boolean,
      delivery_pricing_mode text, delivery_fee numeric, delivery_zones jsonb);`);
  await db.exec(fs.readFileSync("supabase/migrations/20261103130505_delivery_area_spelling_tolerance.sql", "utf8"));
  const validator = fs.readFileSync("supabase/migrations/20261103110240_area_delivery_pricing.sql", "utf8")
    .match(/create or replace function public\.valid_delivery_zones[\s\S]*?\$\$;/)[0];
  await db.exec(validator);
  assert.equal((await db.query("select valid_delivery_zones($1::jsonb) valid", [JSON.stringify(settings.delivery_zones)])).rows[0].valid, true);
  await db.query("insert into restaurant_settings values ($1,true,'area',0,$2)", [branch, JSON.stringify(settings.delivery_zones)]);
  const check = async (address, fee, status = "matched") => {
    const quote = resolveDeliveryQuote(address, settings);
    assert.equal(quote.status, status, `TypeScript status: ${address}: ${JSON.stringify(quote)}`);
    assert.equal(quote.fee, fee, `TypeScript fee: ${address}`);
    if (fee === null) {
      await assert.rejects(() => db.query("select restaurant_delivery_quote($1,$2) fee", [branch, address]),
        status === "ambiguous" ? /ambiguous/ : /not served/);
    } else {
      // Run as the role used by the real application, including helper grants.
      await db.exec("set role service_role");
      try {
        assert.equal(Number((await db.query("select restaurant_delivery_quote($1,$2) fee", [branch, address])).rows[0].fee), fee, `PostgreSQL fee: ${address}`);
      } finally { await db.exec("reset role"); }
    }
    checks++;
  };
  await db.exec("grant select on restaurant_settings to service_role");
  for (const zone of settings.delivery_zones) {
    for (const label of [zone.name, ...zone.aliases]) await check(`House 12, Street 4, ${label}`, zone.fee);
  }
  for (const [address, fee] of [
    ["House 12 Barriar 2", 100], ["House 12 Barriar 3", 200],
    ["House 12 barier no2", 100], ["House 12 barrier3", 200],
    ["House 12 Newcity Phaze 1", 100], ["House 12 Newcity Phaze 2", 200],
    ["House 12 newcityphase2", 200], ["House 12 نیو سٹی فیز ۲", 200],
    ["House 12 بیرئیر نمبر ٣", 200], ["House 12 area18", 100],
    ["House 12 ۱۸ ایریا", 100], ["House 12 Malkaabad", 150],
    ["House 12 Malka Abadd", 150], ["House 12 Nawabbad", 150],
    ["House 12 Taxlia Chawk", 150], ["House 12 Chachi Mohallah", 150],
    ["House 12 Gudawl", 200], ["House 12 Basti Qabristan Rod", 180],
    ["House 12 Gulshn Anwar", 150], ["House 12 Wah Model Twn", 150],
    ["House 12 Jameel abaad", 150], ["House 12 Wah Genral Hospital", 200],
  ]) await check(address, fee);
  for (const address of ["House 2 Barrier 4", "House 3 Barrier 20", "House 12 New City Phase 3",
    "House 1 New City Phase 12", "House 18 Area 17", "House 2 Scheme No 3", "House 12 Islamabad", "House 2 New City",
    "House 12 Laiq Ali Chowk", "House 12 Lala Rukh", "House 12 Aslam Market", "House 12 Anwar Chowk"]) {
    await check(address, null, "unserved");
  }
  await check("House 12 Barrier 2 Barrier 3", null, "ambiguous");
  await check("House 12 Barriar 2 Barriar 3", null, "ambiguous");
  const configure = async zones => {
    settings = { ...settings, delivery_zones: zones };
    await db.query("update restaurant_settings set delivery_zones=$1", [JSON.stringify(zones)]);
  };
  await configure([{ name: "Gulberg", fee: 100, aliases: [] }, { name: "Gulburg", fee: 200, aliases: [] }]);
  await check("House 12 Gulburg", 200); // Exact match takes priority over fuzzy.
  await check("House 12 Gulbrg", null, "ambiguous");
  await configure([{ name: "DHA Phase 1-6", fee: 100, aliases: [] }]);
  await check("House 2 DHA Phase 5", 100);
  await check("House 2 DHA Phase 9", null, "unserved");
  console.log(`DELIVERY SPELLING: ${checks} TypeScript/PostgreSQL parity checks passed; ${confirmed.length} confirmed areas validated.`);
} finally { await db.close(); }
