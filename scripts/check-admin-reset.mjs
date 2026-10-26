import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

// Execute the actual route with mocked dependencies: never delete real data.
const source = fs.readFileSync("app/api/admin/reset/route.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const calls = [];
let auth = { session: { restaurantId: "restaurant-a" }, response: null };
let body;
let failure;
const json = (data, options = {}) => ({ data, status: options.status ?? 200 });
const dependencies = {
  "next/server": { NextResponse: { json } },
  "@/lib/admin-request": { requireAdminApiSession: async () => auth },
  "@/lib/api-utils": {
    readLimitedJsonBody: async (_req, limit) => {
      assert.equal(limit, 4096);
      return body;
    },
    apiErrorResponse: () => json({ error: "Reset failed" }, { status: 500 }),
  },
  "@/lib/admin": {
    wipeOperationalData: async (...args) => {
      if (failure) throw failure;
      calls.push(args);
    },
  },
};
const exports = {};
new Function("require", "exports", "process", compiled)(
  (name) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  },
  exports,
  { env: { NODE_ENV: "production", ADMIN_RESET_ENABLED: "false" } },
);

for (const status of [401, 403]) {
  auth = { session: null, response: json({ error: "Denied" }, { status }) };
  assert.equal((await exports.POST({})).status, status);
  assert.equal(calls.length, 0);
}
auth = { session: { restaurantId: "restaurant-a" }, response: null };
for (const invalid of [{}, { confirmation: "wrong" }, { branch_id: "branch-a", confirmation: "WIPE ALL OPERATIONAL DATA" }]) {
  body = invalid;
  assert.equal((await exports.POST({})).status, 400);
  assert.equal(calls.length, 0);
}
body = { confirmation: "WIPE ALL OPERATIONAL DATA" };
assert.equal((await exports.POST({})).status, 200);
assert.deepEqual(calls.pop(), ["restaurant-a", { branchId: null }]);
body = { branch_id: " branch-a ", confirmation: "WIPE BRANCH branch-a" };
assert.equal((await exports.POST({})).status, 200);
assert.deepEqual(calls.pop(), ["restaurant-a", { branchId: "branch-a" }]);
failure = new Error("Database unavailable");
assert.equal((await exports.POST({})).status, 500);
assert.equal(calls.length, 0);
console.log("PASS: Production reset, authorization, confirmation, tenant/branch forwarding, and failure handling (mocked writes).");
