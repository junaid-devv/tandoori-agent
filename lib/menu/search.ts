/**
 * lib/menu/search.ts — Phase 6
 *
 * THE menu retrieval path. Vector-first, genuinely wired end-to-end:
 *   query -> embedding -> match_menu_items_by_embedding RPC -> ranked items.
 *
 * Fixes the old scaffolding problem:
 *   - Returns resolved items WITH menu_item_id + similarity + a `method` tag so
 *     callers (add_items / answer_info) resolve against embeddings, not just hints.
 *   - Lexical fallback ONLY triggers for genuinely un-embeddable queries
 *     (too short) or when embeddings are unavailable — and it says so via `method`.
 *   - Query-embedding LRU cache (menu-scale queries repeat a lot).
 *   - `assertSearchReady()` for a startup warning when the embedding key is missing.
 */
import OpenAI from "openai";
import { cache } from "@/lib/core/cache";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type ResolutionMethod = "vector" | "lexical" | "none";

export interface ResolvedMenuItem {
  id: string;
  name: string;
  price: number;
  category: string | null;
  description: string | null;
  is_available: boolean;
  similarity: number | null;
  method: ResolutionMethod;
}

export interface MenuSearchResult {
  matches: ResolvedMenuItem[];
  method: ResolutionMethod;
  usedEmbedding: boolean;
}

// ---------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------
const EMBEDDING_MODEL = process.env.MENU_EMBEDDING_MODEL || "text-embedding-3-small";
const EMBEDDING_BASE_URL =
  process.env.MENU_EMBEDDING_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const EMBEDDING_API_KEY = process.env.MENU_EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || "";
// Qwen3-Embedding-8B (and text-embedding-3-*) support Matryoshka dimension
// reduction. We MUST request the same dimensionality used to store menu
// embeddings AND the DB column (vector(1536)), or cosine similarity is invalid.
const EMBEDDING_DIMENSIONS = Number(process.env.MENU_EMBEDDING_DIMENSIONS) || 1536;
const SIMILARITY_THRESHOLD = Number(process.env.MENU_MATCH_THRESHOLD) || 0.45;
const QUERY_EMBEDDING_TTL_MS = Number(process.env.MENU_QUERY_EMBEDDING_TTL_MS) || 10 * 60_000;
const MIN_EMBEDDABLE_LEN = 3; // shorter than this -> lexical fallback

let embeddingClient: OpenAI | null = null;
function getEmbeddingClient(): OpenAI | null {
  if (!EMBEDDING_API_KEY) return null;
  if (embeddingClient) return embeddingClient;
  embeddingClient = new OpenAI({ apiKey: EMBEDDING_API_KEY, baseURL: EMBEDDING_BASE_URL });
  return embeddingClient;
}

/** True when embeddings can be generated (key present). */
export function isVectorSearchEnabled(): boolean {
  return Boolean(EMBEDDING_API_KEY);
}

/** Startup readiness: warn loudly if the vector path can't work. */
export function assertSearchReady(): void {
  if (!isVectorSearchEnabled()) {
    console.warn(
      "[menu/search] MENU_EMBEDDING_API_KEY / OPENAI_API_KEY is not set. " +
        "Vector menu search is DISABLED and will fall back to lexical matching. " +
        "Set the key to enable semantic search (required for production).",
    );
  }
}

// ---------------------------------------------------------------------
// Text utils (lexical fallback only)
// ---------------------------------------------------------------------
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function compact(value: string): string {
  return normalize(value).replace(/\s+/g, "");
}
function overlapScore(query: string, candidate: string): number {
  const q = normalize(query);
  const c = normalize(candidate);
  const cq = compact(query);
  const cc = compact(candidate);
  if (cq && cc) {
    if (cq === cc) return 0.95;
    if (cq.length >= 5 && cc.length >= 5 && (cq.includes(cc) || cc.includes(cq))) return 0.75;
  }
  const left = new Set(q.split(" ").filter(Boolean));
  const right = new Set(c.split(" ").filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  let inter = 0;
  for (const t of left) if (right.has(t)) inter += 1;
  const union = new Set([...left, ...right]).size;
  return union > 0 ? inter / union : 0;
}

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

// ---------------------------------------------------------------------
// Embedding (query) — cached
// ---------------------------------------------------------------------
async function embedQuery(text: string): Promise<number[] | null> {
  const client = getEmbeddingClient();
  if (!client || !text.trim()) return null;

  const key = `qemb:${EMBEDDING_MODEL}:${text.toLowerCase().trim()}`;
  const cached = await cache.get<number[]>(key);
  if (cached) return cached;

  try {
    const res = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
      dimensions: EMBEDDING_DIMENSIONS,
    });
    const vector = res.data[0]?.embedding;
    if (!Array.isArray(vector) || vector.length === 0) return null;
    if (vector.length !== EMBEDDING_DIMENSIONS) {
      console.error(
        `[menu/search] query embedding dim ${vector.length} != expected ${EMBEDDING_DIMENSIONS}; ` +
          "vector search would be invalid. Falling back to lexical.",
      );
      return null;
    }
    await cache.set(key, vector, QUERY_EMBEDDING_TTL_MS);
    return vector;
  } catch (error) {
    console.error("[menu/search] query embedding failed:", error);
    return null;
  }
}

// ---------------------------------------------------------------------
// Lexical fallback (branch-scoped, availability-filtered)
// ---------------------------------------------------------------------
interface MenuRow {
  id: string;
  name: string;
  price: number | string;
  category: string | null;
  description: string | null;
  is_available: boolean;
}

async function lexicalSearch(branchId: string, query: string, limit: number): Promise<ResolvedMenuItem[]> {
  const { data, error } = await supabaseAdmin
    .from("menu_items")
    .select("id, name, price, category, description, is_available")
    .eq("branch_id", branchId)
    .eq("is_available", true);
  if (error || !data) {
    if (error) console.error("[menu/search] lexical load failed:", error);
    return [];
  }
  return (data as MenuRow[])
    .map((row) => ({
      id: row.id,
      name: row.name,
      price: Number(row.price),
      category: row.category,
      description: row.description,
      is_available: row.is_available,
      similarity: overlapScore(query, [row.name, row.category, row.description].filter(Boolean).join(" ")),
      method: "lexical" as ResolutionMethod,
    }))
    .filter((r) => (r.similarity ?? 0) >= 0.2)
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, limit);
}

// ---------------------------------------------------------------------
// Public: search
// ---------------------------------------------------------------------
export async function searchMenu(branchId: string, query: string, limit = 5): Promise<MenuSearchResult> {
  const trimmed = query.trim();
  if (!trimmed) return { matches: [], method: "none", usedEmbedding: false };

  // Genuinely un-embeddable (too short) -> lexical is the correct path.
  if (trimmed.length < MIN_EMBEDDABLE_LEN) {
    const matches = await lexicalSearch(branchId, trimmed, limit);
    return { matches, method: matches.length ? "lexical" : "none", usedEmbedding: false };
  }

  const embedding = await embedQuery(trimmed);
  if (!embedding) {
    // No key or embedding failure -> lexical fallback (flagged).
    const matches = await lexicalSearch(branchId, trimmed, limit);
    return { matches, method: matches.length ? "lexical" : "none", usedEmbedding: false };
  }

  const { data, error } = await supabaseAdmin.rpc("match_menu_items_by_embedding", {
    branch_uuid: branchId,
    query_embedding: toVectorLiteral(embedding),
    match_count: limit,
    similarity_threshold: SIMILARITY_THRESHOLD,
  });

  if (error) {
    console.error("[menu/search] vector RPC failed, falling back to lexical:", error);
    const matches = await lexicalSearch(branchId, trimmed, limit);
    return { matches, method: matches.length ? "lexical" : "none", usedEmbedding: false };
  }

  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) {
    // Vector ran but nothing cleared the threshold — try lexical as a safety net
    // (handles brand-new items not yet embedded).
    const matches = await lexicalSearch(branchId, trimmed, limit);
    return { matches, method: matches.length ? "lexical" : "none", usedEmbedding: true };
  }

  const matches: ResolvedMenuItem[] = rows.map((row) => {
    const r = row as {
      id: string;
      name: string;
      price: number | string;
      category: string | null;
      description: string | null;
      is_available: boolean;
      similarity: number;
    };
    return {
      id: r.id,
      name: r.name,
      price: Number(r.price),
      category: r.category,
      description: r.description,
      is_available: r.is_available,
      similarity: r.similarity,
      method: "vector",
    };
  });

  return { matches, method: "vector", usedEmbedding: true };
}

/**
 * Resolve a single free-text item mention to the best menu item, or null.
 * This is what add_items uses so cart resolution goes through embeddings.
 */
export async function resolveItem(branchId: string, query: string): Promise<ResolvedMenuItem | null> {
  const { matches } = await searchMenu(branchId, query, 3);
  return matches[0] ?? null;
}
