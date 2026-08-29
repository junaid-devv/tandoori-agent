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
// Lexical fallback — works on an in-memory menu slice to avoid a DB round trip.
// The caller passes menuItems if available (always true when called from executor).
// ---------------------------------------------------------------------
interface MenuRow {
  id: string;
  name: string;
  price: number | string;
  category: string | null;
  description: string | null;
  is_available: boolean;
}

function lexicalScore(query: string, row: MenuRow): number {
  return overlapScore(query, [row.name, row.category, row.description].filter(Boolean).join(" "));
}

function lexicalRank(query: string, rows: MenuRow[], limit: number): ResolvedMenuItem[] {
  return rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      price: Number(row.price),
      category: row.category,
      description: row.description,
      is_available: row.is_available,
      similarity: lexicalScore(query, row),
      method: "lexical" as ResolutionMethod,
    }))
    .filter((r) => (r.similarity ?? 0) >= 0.2)
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, limit);
}

/** Lexical fallback that uses pre-loaded in-memory menu (no DB round trip). */
function lexicalSearchInMemory(query: string, menuItems: MenuRow[], limit: number): ResolvedMenuItem[] {
  return lexicalRank(query, menuItems.filter((r) => r.is_available), limit);
}

/** Lexical fallback that fetches from DB (used only when menu not pre-loaded). */
async function lexicalSearchFromDb(branchId: string, query: string, limit: number): Promise<ResolvedMenuItem[]> {
  const { data, error } = await supabaseAdmin
    .from("menu_items")
    .select("id, name, price, category, description, is_available")
    .eq("branch_id", branchId)
    .eq("is_available", true);
  if (error || !data) {
    if (error) console.error("[menu/search] lexical load failed:", error);
    return [];
  }
  return lexicalRank(query, data as MenuRow[], limit);
}

// ---------------------------------------------------------------------
// Public: search — accepts optional in-memory menu to skip DB on lexical fallback
// ---------------------------------------------------------------------
export async function searchMenu(
  branchId: string,
  query: string,
  limit = 5,
  /** Pass ctx.menu here to avoid a DB round trip on lexical fallback */
  inMemoryMenu?: Array<{ id: string; name: string; price: number; category: string | null; description?: string | null; is_available: boolean }>,
): Promise<MenuSearchResult> {
  const trimmed = query.trim();
  if (!trimmed) return { matches: [], method: "none", usedEmbedding: false };

  const lexicalFallback = async (): Promise<ResolvedMenuItem[]> => {
    if (inMemoryMenu && inMemoryMenu.length > 0) {
      return lexicalSearchInMemory(trimmed, inMemoryMenu as MenuRow[], limit);
    }
    return lexicalSearchFromDb(branchId, trimmed, limit);
  };

  // Genuinely un-embeddable (too short) -> lexical is the correct path.
  if (trimmed.length < MIN_EMBEDDABLE_LEN) {
    const matches = await lexicalFallback();
    return { matches, method: matches.length ? "lexical" : "none", usedEmbedding: false };
  }

  const embedding = await embedQuery(trimmed);
  if (!embedding) {
    const matches = await lexicalFallback();
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
    const matches = await lexicalFallback();
    return { matches, method: matches.length ? "lexical" : "none", usedEmbedding: false };
  }

  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) {
    // Vector cleared threshold with nothing — lexical safety net for brand-new items.
    const matches = await lexicalFallback();
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

// ---------------------------------------------------------------------
// Variant & Disambiguation Helpers
// ---------------------------------------------------------------------
const VARIANT_PATTERN =
  /\s*(?:[\(\[\{]|\s+-\s+|\s+\/\s+)(full|half|quarter|single|double|small|medium|large|1\s*kg|0?\.5\s*kg|half\s*kg|\d+\s*pcs?|tin|glass|bottle|boneless|b\/l)[\)\]\}]?\s*$/i;

const SIZE_WORDS_PATTERN =
  /\b(full|half|quarter|single|double|small|medium|large|\d+\s*pcs?|tin|glass|bottle)\b/i;

export function extractBaseItemName(fullName: string): { baseName: string; variant: string | null } {
  const match = fullName.match(VARIANT_PATTERN);
  if (match && match[1]) {
    const base = fullName.slice(0, match.index).trim();
    return { baseName: base || fullName.trim(), variant: match[1].trim().toLowerCase() };
  }
  return { baseName: fullName.trim(), variant: null };
}

export function extractSizeFromQuery(query: string, explicitSize?: string | null): string | null {
  if (explicitSize && explicitSize.trim()) {
    const s = explicitSize.trim().toLowerCase();
    const m = s.match(SIZE_WORDS_PATTERN);
    return m ? m[1].toLowerCase() : s;
  }
  const match = query.match(SIZE_WORDS_PATTERN);
  return match ? match[1].toLowerCase() : null;
}

export type ItemResolutionResult =
  | { kind: "exact"; item: ResolvedMenuItem; confidence: number }
  | { kind: "variants"; baseName: string; variants: ResolvedMenuItem[] }
  | { kind: "ambiguous"; query: string; matches: ResolvedMenuItem[] }
  | { kind: "not_found"; query: string; suggestions: ResolvedMenuItem[] };

/**
 * Detailed item resolution that detects size variants (Half/Full) and ambiguity.
 * Prevents blindly adding Full when Half/Full options exist and no size was specified.
 */
export async function resolveItemDetailed(
  branchId: string,
  query: string,
  explicitSize?: string | null,
  inMemoryMenu?: Parameters<typeof searchMenu>[3],
): Promise<ItemResolutionResult> {
  const trimmed = query.trim();
  if (!trimmed) return { kind: "not_found", query: trimmed, suggestions: [] };

  const requestedSize = extractSizeFromQuery(trimmed, explicitSize);
  const baseQuery = trimmed.replace(SIZE_WORDS_PATTERN, " ").replace(/\s+/g, " ").trim();

  // Search with original query
  const { matches: directMatches } = await searchMenu(branchId, trimmed, 8, inMemoryMenu);

  // If size was stripped and baseQuery is different, also search with baseQuery to maximize recall
  let combined = [...directMatches];
  if (baseQuery && baseQuery !== trimmed && baseQuery.length >= 3) {
    const { matches: baseMatches } = await searchMenu(branchId, baseQuery, 8, inMemoryMenu);
    const seenIds = new Set(combined.map((m) => m.id));
    for (const bm of baseMatches) {
      if (!seenIds.has(bm.id)) {
        combined.push(bm);
        seenIds.add(bm.id);
      }
    }
  }

  const available = combined.filter((m) => m.is_available !== false);
  if (available.length === 0) {
    return { kind: "not_found", query: trimmed, suggestions: [] };
  }

  const top = available[0];
  const topSim = top.similarity ?? 0;
  if (topSim < 0.25) {
    return { kind: "not_found", query: trimmed, suggestions: available.slice(0, 3) };
  }

  // 1) If user specified a size (e.g. "half", "full"), find the candidate matching that size
  if (requestedSize) {
    const sizeMatch = available.find((c) => {
      const { variant } = extractBaseItemName(c.name);
      return (
        (variant && variant.toLowerCase() === requestedSize) ||
        c.name.toLowerCase().includes(requestedSize)
      );
    });
    if (sizeMatch) {
      return { kind: "exact", item: sizeMatch, confidence: sizeMatch.similarity ?? 0.9 };
    }
  }

  // 2) Check if top candidates share the same base name with multiple size variants
  const topBase = extractBaseItemName(top.name);
  const sameBaseVariants = available.filter((c) => {
    const cBase = extractBaseItemName(c.name);
    return cBase.baseName.toLowerCase() === topBase.baseName.toLowerCase() && cBase.variant !== null;
  });

  // If there are multiple size variants for this base item (e.g. Chicken Karahi Half & Full)
  // and the user did NOT specify which size they want:
  if (sameBaseVariants.length > 1 && !requestedSize) {
    // Sort variants logically (e.g. Half before Full, or smaller price first)
    sameBaseVariants.sort((a, b) => a.price - b.price);
    return { kind: "variants", baseName: topBase.baseName, variants: sameBaseVariants };
  }

  // 3) Check for broad/ambiguous query matching multiple distinct dishes
  const distinctBases = [...new Set(available.slice(0, 5).map((c) => extractBaseItemName(c.name).baseName.toLowerCase()))];
  const isBroadSingleWord = /^(karahi|kabab|tikka|handi|biryani|naan|roti|rice|drink|juice|dessert|fish|boti)$/i.test(trimmed);
  if ((distinctBases.length > 1 && isBroadSingleWord) || (distinctBases.length > 2 && topSim < 0.85)) {
    return { kind: "ambiguous", query: trimmed, matches: available.slice(0, 5) };
  }

  // 4) Single exact / clear best match
  return { kind: "exact", item: top, confidence: topSim };
}

/**
 * Resolve a single free-text item mention to the best menu item, or null.
 * Pass inMemoryMenu (ctx.menu) to skip DB on lexical fallback.
 *
 * Only returns items where is_available === true so that an out-of-stock /
 * unavailable hit is never silently added to the cart.
 */
export async function resolveItem(
  branchId: string,
  query: string,
  inMemoryMenu?: Parameters<typeof searchMenu>[3],
): Promise<ResolvedMenuItem | null> {
  const res = await resolveItemDetailed(branchId, query, undefined, inMemoryMenu);
  if (res.kind === "exact") return res.item;
  // If only 1 variant or clear match, return it
  if (res.kind === "variants" && res.variants.length === 1) return res.variants[0];
  return null;
}
