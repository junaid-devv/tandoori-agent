import OpenAI from "openai";
import { supabaseAdmin } from "./supabase-admin.ts";

export type SemanticMenuMatch = {
  id: string;
  name: string;
  price: number;
  category: string | null;
  description: string | null;
  is_available: boolean;
  similarity: number | null;
};

type MenuRow = {
  id: string;
  branch_id: string;
  name: string;
  price: number | string;
  category: string | null;
  description: string | null;
  is_available: boolean;
};

function getEmbeddingModel(): string {
  return process.env.MENU_EMBEDDING_MODEL || "text-embedding-3-small";
}
function getEmbeddingDimensions(): number {
  return Number(process.env.MENU_EMBEDDING_DIMENSIONS) || 1536;
}

let embeddingClient: OpenAI | null = null;

function getEmbeddingClient(): OpenAI | null {
  const apiKey = process.env.MENU_EMBEDDING_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  if (embeddingClient) return embeddingClient;

  const baseURL =
    process.env.MENU_EMBEDDING_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    "https://api.openai.com/v1";

  embeddingClient = new OpenAI({
    apiKey,
    baseURL,
  });

  return embeddingClient;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCompact(value: string): string {
  return normalizeText(value).replace(/\s+/g, "");
}

function overlapScore(query: string, candidate: string): number {
  const normalizedQuery = normalizeText(query);
  const normalizedCandidate = normalizeText(candidate);
  const compactQuery = normalizeCompact(query);
  const compactCandidate = normalizeCompact(candidate);

  if (compactQuery && compactCandidate) {
    if (compactQuery === compactCandidate) return 0.95;
    if (compactQuery.length >= 5 && compactCandidate.length >= 5) {
      if (compactQuery.includes(compactCandidate) || compactCandidate.includes(compactQuery)) {
        return 0.75;
      }
    }
  }

  const left = new Set(normalizedQuery.split(" ").filter(Boolean));
  const right = new Set(normalizedCandidate.split(" ").filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }

  const union = new Set([...left, ...right]).size;
  return union > 0 ? intersection / union : 0;
}

function buildEmbeddingSource(item: Pick<MenuRow, "name" | "category" | "description">): string {
  return [item.name, item.category, item.description]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" | ");
}

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

async function createEmbedding(input: string): Promise<number[] | null> {
  const vectors = await createBatchEmbeddings([input]);
  return vectors[0] ?? null;
}

async function createBatchEmbeddings(inputs: string[]): Promise<(number[] | null)[]> {
  const client = getEmbeddingClient();
  const trimmed = inputs.map((s) => s.trim());
  if (!client || trimmed.every((s) => !s)) return inputs.map(() => null);

  try {
    const model = getEmbeddingModel();
    const dimensions = getEmbeddingDimensions();
    const response = await client.embeddings.create({
      model,
      input: trimmed.map((s) => s || " "),
      dimensions,
    });

    const result: (number[] | null)[] = new Array(inputs.length).fill(null);
    for (const entry of response.data) {
      if (
        Array.isArray(entry.embedding) &&
        entry.embedding.length === dimensions
      ) {
        result[entry.index] = entry.embedding;
      }
    }
    return result;
  } catch (err) {
    console.error("[semantic-menu] Batch embedding generation failed:", err);
    return inputs.map(() => null);
  }
}

function toSemanticMatch(row: Partial<MenuRow> & { id: string; name: string; price: number | string }): SemanticMenuMatch {
  return {
    id: row.id,
    name: row.name,
    price: Number(row.price),
    category: row.category ?? null,
    description: row.description ?? null,
    is_available: row.is_available ?? true,
    similarity: "similarity" in row && typeof row.similarity === "number" ? row.similarity : null,
  };
}

function lexicalFallback(queryText: string, rows: MenuRow[], limit: number): SemanticMenuMatch[] {
  return rows
    .map((row) => ({
      ...row,
      similarity: overlapScore(queryText, buildEmbeddingSource(row)),
    }))
    .filter((row) => row.similarity >= 0.2)
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, limit)
    .map(toSemanticMatch);
}

export async function syncMenuEmbeddingsForBranch(branchId: string): Promise<void> {
  const client = getEmbeddingClient();
  if (!client) return;

  const { data: menuData, error: menuError } = await supabaseAdmin
    .from("menu_items")
    .select("id, branch_id, name, price, category, description, is_available")
    .eq("branch_id", branchId);

  if (menuError) throw menuError;

  const rows = (menuData ?? []) as MenuRow[];
  if (rows.length === 0) return;

  // Check existing embeddings to avoid redundant re-embedding on unchanged items
  const { data: existingData } = await supabaseAdmin
    .from("menu_item_embeddings")
    .select("menu_item_id, embedding_source, embedding_model")
    .eq("branch_id", branchId);

  const existingMap = new Map<string, { embedding_source: string; embedding_model: string }>();
  for (const emb of existingData ?? []) {
    existingMap.set(emb.menu_item_id, emb);
  }

  const targetModel = getEmbeddingModel();
  const itemsToSync = rows.filter((row) => {
    const source = buildEmbeddingSource(row);
    const existing = existingMap.get(row.id);
    return !existing || existing.embedding_source !== source || existing.embedding_model !== targetModel;
  });

  if (itemsToSync.length === 0) {
    console.info(`[semantic-menu] all ${rows.length} items up-to-date for branch ${branchId}`);
    return;
  }

  console.info(`[semantic-menu] syncing ${itemsToSync.length} items (${rows.length - itemsToSync.length} already fresh) for branch ${branchId}`);

  let ok = 0;
  let failed = 0;
  const BATCH_SIZE = 25;

  for (let i = 0; i < itemsToSync.length; i += BATCH_SIZE) {
    const chunk = itemsToSync.slice(i, i + BATCH_SIZE);
    const sources = chunk.map((item) => buildEmbeddingSource(item));

    try {
      const vectors = await createBatchEmbeddings(sources);
      const upsertRows = [];

      for (let j = 0; j < chunk.length; j++) {
        const vec = vectors[j];
        if (vec) {
          upsertRows.push({
            menu_item_id: chunk[j].id,
            branch_id: chunk[j].branch_id,
            embedding_model: targetModel,
            embedding_source: sources[j],
            embedding: toVectorLiteral(vec),
            updated_at: new Date().toISOString(),
          });
          ok += 1;
        } else {
          failed += 1;
          console.warn(`[semantic-menu] skipped item "${chunk[j].name}" (${chunk[j].id}) due to missing embedding`);
        }
      }

      if (upsertRows.length > 0) {
        const { error: upsertError } = await supabaseAdmin
          .from("menu_item_embeddings")
          .upsert(upsertRows, { onConflict: "menu_item_id" });

        if (upsertError) {
          console.error("[semantic-menu] batch upsert error:", upsertError);
        }
      }
    } catch (batchErr) {
      console.error("[semantic-menu] batch processing failed:", batchErr);
      failed += chunk.length;
    }
  }

  console.info(`[semantic-menu] sync complete for branch ${branchId}: ${ok} embedded, ${failed} failed (${rows.length} total items)`);
}

export async function getSemanticMenuMatches(
  branchId: string,
  queryText: string,
  limit = 5,
): Promise<SemanticMenuMatch[]> {
  const { data: rows, error: rowError } = await supabaseAdmin
    .from("menu_items")
    .select("id, branch_id, name, price, category, description, is_available")
    .eq("branch_id", branchId)
    .eq("is_available", true);

  if (rowError || !rows) {
    console.error("[semantic-menu] Failed to load menu rows:", rowError);
    return [];
  }

  const menuRows = rows as MenuRow[];
  const embedding = await createEmbedding(queryText).catch((error) => {
    console.error("[semantic-menu] Embedding generation failed:", error);
    return null;
  });

  if (!embedding) {
    return lexicalFallback(queryText, menuRows, limit);
  }

  const { data, error } = await supabaseAdmin.rpc("match_menu_items_by_embedding", {
    branch_uuid: branchId,
    query_embedding: toVectorLiteral(embedding),
    match_count: limit,
    similarity_threshold: 0.52,
  });

  if (error || !Array.isArray(data) || data.length === 0) {
    if (error) {
      console.error("[semantic-menu] Vector lookup failed:", error);
    }
    return lexicalFallback(queryText, menuRows, limit);
  }

  return data.map((row) => toSemanticMatch(row as Partial<MenuRow> & { id: string; name: string; price: number | string }));
}
