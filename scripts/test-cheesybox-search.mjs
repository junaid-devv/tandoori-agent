import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  "https://msjgqesrnnxrjbhijmlq.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zamdxZXNybm54cmpiaGlqbWxxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTEwODUyNSwiZXhwIjoyMDkwNjg0NTI1fQ.4rwHEQH9Ip02YI5Zen6tcAGrjN1hAbD7agIKJCB9h0Q"
);
const openai = new OpenAI({
  apiKey: "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",
  baseURL: "https://router.huggingface.co/deepinfra/v1/openai",
});

async function testSearch(query) {
  const resp = await openai.embeddings.create({
    model: "Qwen/Qwen3-Embedding-8B",
    input: [query],
    dimensions: 1536,
  });
  const vector = resp.data[0].embedding;
  const { data, error } = await sb.rpc("match_menu_items_by_embedding", {
    branch_uuid: "92de8ae3-eac0-4b31-8e13-a1c3557c7c5c",
    query_embedding: `[${vector.join(",")}]`,
    match_count: 3,
    similarity_threshold: 0.35,
  });
  console.log(`\nQuery: "${query}" -> Matches:`);
  if (error) {
    console.error("RPC Error:", error);
    return;
  }
  if (!data || data.length === 0) {
    console.log("  No matches found");
  } else {
    data.forEach((m) =>
      console.log(`  - ${m.name} | Rs. ${m.price} | sim: ${m.similarity?.toFixed(3)}`)
    );
  }
}

async function runAll() {
  await testSearch("deal 1");
  await testSearch("zinger burger");
  await testSearch("weekly deal");
  await testSearch("crown crust pizza");
  await testSearch("loaded fries");
  await testSearch("wings");
}

runAll();
