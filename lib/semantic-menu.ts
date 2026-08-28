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

const DEFAULT_EMBEDDING_MODEL = process.env.MENU_EMBEDDING_MODEL || "text-embedding-3-small";
const DEFAULT_EMBEDDING_BASE_URL =
  process.env.MENU_EMBEDDING_BASE_URL ||
  process.env.OPENAI_BASE_URL ||
  "https://api.openai.com/v1";
const DEFAULT_EMBEDDING_API_KEY =
  process.env.MENU_EMBEDDING_API_KEY ||
  process.env.OPENAI_API_KEY ||
  "";
// Must match lib/menu/search.ts and the vector(1536) column exactly.
const DEFAULT_EMBEDDING_DIMENSIONS = Number(process.env.MENU_EMBEDDING_DIMENSIONS) || 1536;

let embeddingClient: OpenAI | null = null;

function getEmbeddingClient(): OpenAI | null {
  if (!DEFAULT_EMBEDDING_API_KEY) return null;
  if (embeddingClient) return embeddingClient;

  embeddingClient = new OpenAI({
    apiKey: DEFAULT_EMBEDDING_API_KEY,
    baseURL: DEFAULT_EMBEDDING_BASE_URL,
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
  const client = getEmbeddingClient();
  if (!client || !input.trim()) return null;

  const response = await client.embeddings.create({
    model: DEFAULT_EMBEDDING_MODEL,
    input,
    dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
  });

  const vector = response.data[0]?.embedding;
  if (!Array.isArray(vector) || vector.length === 0) return null;
  if (vector.length !== DEFAULT_EMBEDDING_DIMENSIONS) {
    throw new Error(
      `[semantic-menu] embedding dim ${vector.length} != expected ${DEFAULT_EMBEDDING_DIMENSIONS}. ` +
        "Refusing to store a mismatched vector (would corrupt cosine search).",
    );
  }
  return vector;
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

  const { data, error } = await supabaseAdmin
    .from("menu_items")
    .select("id, branch_id, name, price, category, description, is_available")
    .eq("branch_id", branchId);

  if (error) throw error;

  const rows = (data ?? []) as MenuRow[];
  let ok = 0;
  let failed = 0;

  // Per-item resilience: one bad embedding (HF rate limit, transient 5xx) must
  // NOT abort the whole menu sync and leave the rest un-embedded.
  for (const row of rows) {
    const source = buildEmbeddingSource(row);
    try {
      const embedding = await createEmbedding(source);
      if (!embedding) {
        failed += 1;
        console.warn(`[semantic-menu] no embedding for "${row.name}" (${row.id}); skipped`);
        continue;
      }

      const { error: upsertError } = await supabaseAdmin.from("menu_item_embeddings").upsert(
        {
          menu_item_id: row.id,
          branch_id: row.branch_id,
          embedding_model: DEFAULT_EMBEDDING_MODEL,
          embedding_source: source,
          embedding: toVectorLiteral(embedding),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "menu_item_id" },
      );

      if (upsertError) {
        failed += 1;
        console.error(`[semantic-menu] upsert failed for "${row.name}" (${row.id}):`, upsertError);
        continue;
      }
      ok += 1;
    } catch (err) {
      failed += 1;
      console.error(`[semantic-menu] embedding failed for "${row.name}" (${row.id}):`, err);
    }
  }

  console.info(`[semantic-menu] sync done for branch ${branchId}: ${ok} embedded, ${failed} failed of ${rows.length}`);
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
