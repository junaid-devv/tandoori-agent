/** Apply the owner-confirmed fees and remove the four superseded zones.
 * Run with --apply to write; without it this only previews the merged settings. */
import assert from "node:assert/strict";
import fs from "node:fs";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { normalizeArea, validateDeliveryZones } from "../lib/delivery-pricing.ts";

dotenv.config({ path: ".env.local", quiet: true });
const branchId = "457cbcc8-5158-4859-9c55-066403461bf7";
const restaurantId = "95a8e90d-7e24-430d-b7a0-51d0061d711b";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const unwrap = ({ data, error }) => { if (error) throw error; return data; };
const restaurant = unwrap(await sb.from("restaurant_profiles").select("id,name").eq("id", restaurantId).single());
const branch = unwrap(await sb.from("branches").select("id,name,restaurant_id").eq("id", branchId).eq("restaurant_id", restaurantId).single());
assert.equal(restaurant.name, "Foods Carnival");
assert.equal(branch.name, "Laiq Ali Chowk");
const existing = unwrap(await sb.from("restaurant_settings")
  .select("branch_id,updated_at,delivery_enabled,delivery_pricing_mode,delivery_zones,delivery_areas,delivery_outside_area_per_km")
  .eq("branch_id", branchId).single());
const confirmed = validateDeliveryZones(JSON.parse(fs.readFileSync("data/foods-carnival-delivery-zones.json", "utf8")));
const removedNames = new Set(["Laiq Ali Chowk", "Lala Rukh", "Aslam Market", "Anwar Chowk"].map(normalizeArea));
const byName = new Map((existing.delivery_zones ?? []).filter(zone => !removedNames.has(normalizeArea(zone.name)))
  .map(zone => [normalizeArea(zone.name), zone]));
for (const zone of confirmed) byName.set(normalizeArea(zone.name), zone);
const zones = validateDeliveryZones([...byName.values()]);
const areas = zones.map(zone => zone.name);
console.log(JSON.stringify({ restaurant: restaurant.name, branch: branch.name, mode: "area", outsideAreaPerKm: 40, confirmedAreas: confirmed.length, totalAreas: zones.length, zones }, null, 2));
if (process.argv.includes("--apply")) {
  fs.mkdirSync("output/delivery", { recursive: true });
  const backup = `output/delivery/foods-carnival-before-${Date.now()}.json`;
  fs.writeFileSync(backup, JSON.stringify(existing, null, 2));
  // Refuse to overwrite a concurrent dashboard edit.
  const operation = sb.from("restaurant_settings").update({
    delivery_pricing_mode: "area", delivery_zones: zones, delivery_areas: areas, delivery_outside_area_per_km: 40,
  }).eq("branch_id", branchId);
  const saved = unwrap(await (existing.updated_at ? operation.eq("updated_at", existing.updated_at) : operation.is("updated_at", null))
    .select("branch_id,delivery_enabled,delivery_pricing_mode,delivery_zones,delivery_areas,delivery_outside_area_per_km").single());
  const readback = unwrap(await sb.from("restaurant_settings")
    .select("delivery_enabled,delivery_pricing_mode,delivery_zones,delivery_areas,delivery_outside_area_per_km").eq("branch_id", branchId).single());
  assert.deepEqual(readback.delivery_zones, zones);
  assert.deepEqual(readback.delivery_areas, areas);
  assert.equal(readback.delivery_pricing_mode, "area");
  assert.equal(readback.delivery_outside_area_per_km, 40);
  assert.equal(saved.delivery_enabled, existing.delivery_enabled);
  console.log(`Saved and verified ${zones.length} areas. Previous settings: ${backup}`);
} else {
  console.log("Preview only. Add --apply to save these delivery areas.");
}
