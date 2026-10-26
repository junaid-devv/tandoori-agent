/** Real answer client against a local HTTP fixture. No live AI or messages. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
delete process.env.GROQ_API_KEY;
delete process.env.DEEPSEEK_API_KEY;
process.env.OPENROUTER_API_KEY = "offline-test-key";
process.env.ORDER_AGENT_ANSWER_MODEL = "fixture-primary";
process.env.ORDER_AGENT_ANSWER_FALLBACK_MODEL = "fixture-fallback";
process.env.ORDER_AGENT_ANSWER_TIMEOUT_MS = "800";
let mode = "rejected";
let requests = [];
const server = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const request = JSON.parse(body);
  requests.push(request.model);
  const primary = request.model === "fixture-primary";
  res.setHeader("Content-Type", "application/json");
  if (mode === "all-failed" || primary && mode === "rejected") {
    res.statusCode = 400; res.end(JSON.stringify({ error: { message: "fixture rejection" } })); return;
  }
  if (primary && mode === "slow") await new Promise((resolve) => setTimeout(resolve, 950));
  res.end(JSON.stringify({ choices: [{ finish_reason: primary && mode === "truncated" ? "length" : "stop",
    message: { role: "assistant", content: primary && mode === "empty" ? "" : "Staff can verify unlisted information." } }] }));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
process.env.ORDER_AGENT_NLU_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
const { groundedAnswer } = await import("../lib/agent/answer.ts");
const input = { language: "english", appName: "Fixture", currency: "Rs.", menu: [], isOpenNow: true,
  settings: { city: "", opening_time: "11:00", closing_time: "23:00", timezone: "Asia/Karachi", is_accepting_orders: true,
    delivery_enabled: true, delivery_areas: [], delivery_fee: 0, estimated_delivery_minutes: 40, estimated_prep_minutes: 20, ai_personality: "Warm" } };
try {
  for (mode of ["rejected", "empty", "truncated", "slow"]) {
    requests = [];
    const started = Date.now();
    assert.equal(await groundedAnswer({ ...input, question: `Question ${mode}` }), "Staff can verify unlisted information.");
    assert.deepEqual(requests, ["fixture-primary", "fixture-fallback"]);
    assert.ok(Date.now() - started < 1400, "Fallback must share the original budget");
    console.log(`PASS: ${mode} primary answer recovers on the fallback within one budget`);
  }
  const calls = requests.length;
  await groundedAnswer({ ...input, question: "Question slow" });
  assert.equal(requests.length, calls);
  console.log("PASS: a complete recovered answer is cached without another model request");
  mode = "all-failed"; requests = [];
  assert.equal(await groundedAnswer({ ...input, question: "Both providers fail" }), null);
  assert.equal(requests.length, 2);
  console.log("PASS: both failed models return no fabricated or partial answer");
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
