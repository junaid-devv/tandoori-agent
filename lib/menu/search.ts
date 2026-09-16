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
const SIMILARITY_THRESHOLD = Number(process.env.MENU_MATCH_THRESHOLD) || 0.60;
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
  let v = value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Common Pakistani phonetic variations / transliterations
  v = v
    .replace(/\b(nan|non|naans|nans)\b/g, "naan")
    .replace(/\b(krahi|karai|kadai|kadhai)\b/g, "karahi")
    .replace(/\b(bryani|biryany|baryani|biryanis)\b/g, "biryani")
    .replace(/\b(handee|handy)\b/g, "handi")
    .replace(/\b(tika|tikkah)\b/g, "tikka")
    .replace(/\b(kebab|kabaab|kababs|kebabs)\b/g, "kabab")
    .replace(/\b(rogni|roghani)\b/g, "roghni")
    .replace(/\b(cremy|cremi)\b/g, "creamy")
    .replace(/\b(raitah|rayta|raitaa)\b/g, "raita")
    .replace(/\b(coldring|colddrink|cooldrink)\b/g, "cold drink");
  return v;
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

export function queryTokensCoveredByName(query: string, name: string): boolean {
  const qTokens = normalize(query)
    .split(" ")
    .filter((t) => (t.length >= 3 || /^\d+$/.test(t)) && !/^(special|pure|desi)$/i.test(t));
  if (qTokens.length === 0) return false;
  const nameNorm = normalize(name);
  return qTokens.every((t) => nameNorm.includes(t));
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
  const normQ = normalize(query);
  const normName = normalize(row.name);
  const qTokens = normQ.split(" ").filter((t) => t.length >= 3);
  const nameMatches = qTokens.length > 0 && qTokens.some((t) => normName.includes(t));
  if (nameMatches) {
    return Math.max(0.65, overlapScore(query, [row.name, row.category, row.description].filter(Boolean).join(" ")));
  }
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
const VARIANT_WORDS =
  "full|half|quarter|single|double|small|medium|large|extra\\s*large|xl|reg(?:ular)?|med(?:ium)?|lar(?:ge)?|\\d+[\"']|\\w+\\s*\\d+[\"']|1\\s*kg|0?\\.5\\s*kg|half\\s*kg|\\d+\\s*pcs?|tin|glass|bottle|boneless|b\\/l|with\\s*cheese";

const VARIANT_PATTERN = new RegExp(
  `(?:\\s*(?:[\\(\\[\\{]|\\s+-\\s+|\\s+\\/\\s+)(${VARIANT_WORDS})[\\)\\]\\}]?|\\s+(${VARIANT_WORDS}))\\s*$`,
  "i"
);

const SIZE_WORDS_PATTERN =
  /\b(full|half|quarter|single|double|small|medium|large|extra\s*large|xl|reg(?:ular)?|med|\d+["']|\d+\s*inch|\d+\s*pcs?|tin|glass|bottle)\b/i;

export function extractBaseItemName(fullName: string): { baseName: string; variant: string | null } {
  const match = fullName.match(VARIANT_PATTERN);
  const variant = match ? (match[1] || match[2]) : null;
  if (match && variant) {
    const base = fullName.slice(0, match.index).trim();
    return { baseName: base || fullName.trim(), variant: variant.trim().toLowerCase() };
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

function isCandidateRelevant(query: string, candidate: ResolvedMenuItem): boolean {
  const sim = candidate.similarity ?? 0;
  if (sim >= 0.72) return true;

  const qTokens = normalize(query).split(" ").filter((t) => t.length >= 3);
  const nameNorm = normalize(candidate.name);
  const catNorm = normalize(candidate.category || "");
  const descNorm = normalize(candidate.description || "");

  // Substring check
  const qCompact = compact(query);
  const nameCompact = compact(candidate.name);
  if (qCompact.length >= 4 && (nameCompact.includes(qCompact) || qCompact.includes(nameCompact))) {
    return true;
  }

  // Token overlap in name or category
  const matchesToken = qTokens.some((t) => nameNorm.includes(t) || catNorm.includes(t) || descNorm.includes(t));
  if (matchesToken && sim >= 0.30) return true;

  return false;
}

/**
 * Detailed item resolution that detects size variants (Half/Full) and ambiguity.
 * Prevents blindly adding Full when Half/Full options exist and no size was specified.
 * Accurately classifies items not on the menu as not_found rather than suggesting unrelated food.
 *
 * @param lastCategory - optional category context (e.g. "Burger") from last_shown_category.
 *   Candidates matching this category get a similarity boost so that a query like
 *   "Chaple Burger" in a Burger browsing context won't resolve to a Platter from another category.
 */
export async function resolveItemDetailed(
  branchId: string,
  query: string,
  explicitSize?: string | null,
  inMemoryMenu?: Parameters<typeof searchMenu>[3],
  lastCategory?: string | null,
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

  // If we have a category context, boost candidates from that category
  if (lastCategory) {
    const catNorm = lastCategory.toLowerCase().trim();
    combined = combined.map((m) => {
      const mCat = (m.category || "").toLowerCase().trim();
      if (mCat === catNorm || mCat.includes(catNorm) || catNorm.includes(mCat)) {
        return { ...m, similarity: Math.min(1.0, (m.similarity ?? 0) + 0.15) };
      }
      return m;
    });
    // Re-sort after boosting
    combined.sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
  }

  const available = combined.filter((m) => m.is_available !== false);
  if (available.length === 0) {
    return { kind: "not_found", query: trimmed, suggestions: [] };
  }

  // Filter available candidates by semantic relevance to prevent unrelated suggestions
  const relevantCandidates = available.filter((m) => isCandidateRelevant(trimmed, m));
  if (relevantCandidates.length === 0) {
    return { kind: "not_found", query: trimmed, suggestions: [] };
  }

  const top = relevantCandidates[0];
  const topSim = top.similarity ?? 0;
  if (topSim < 0.30) {
    return { kind: "not_found", query: trimmed, suggestions: [] };
  }

  // 1) Direct exact name match (e.g. "RAITA" -> item "RAITA", "Coke" -> "Coke", "Chicken Handi" -> "CHICKEN HANDI (BONELESS)")
  const exactMatch = relevantCandidates.find((c) => {
    const normCand = normalize(c.name);
    const normBaseCand = normalize(extractBaseItemName(c.name).baseName);
    const normQ = normalize(trimmed);
    const normBaseQ = normalize(baseQuery);
    return normCand === normQ || normCand === normBaseQ || normBaseCand === normQ || normBaseCand === normBaseQ;
  });

  if (exactMatch) {
    const { variant } = extractBaseItemName(exactMatch.name);
    if (variant || requestedSize) {
      return { kind: "exact", item: exactMatch, confidence: 1.0 };
    }
    const sameBaseVariants = relevantCandidates.filter((c) => {
      const cBase = extractBaseItemName(c.name);
      return cBase.baseName.toLowerCase() === extractBaseItemName(exactMatch.name).baseName.toLowerCase() && cBase.variant !== null;
    });
    if (sameBaseVariants.length > 1) {
      sameBaseVariants.sort((a, b) => a.price - b.price);
      return { kind: "variants", baseName: extractBaseItemName(exactMatch.name).baseName, variants: sameBaseVariants };
    }
    return { kind: "exact", item: exactMatch, confidence: 1.0 };
  }

  // 2) If user specified a size (e.g. "half", "full", "large", "reg", "medium", "xl"), find ALL candidates matching that size
  if (requestedSize) {
    const s = requestedSize.toLowerCase();
    const isSizeMatch = (c: ResolvedMenuItem): boolean => {
      const { variant } = extractBaseItemName(c.name);
      const v = variant ? variant.toLowerCase() : "";
      const n = c.name.toLowerCase();
      const sDigits = s.replace(/\D/g, "");
      const vDigits = v.replace(/\D/g, "");
      const digitMatch = Boolean(sDigits && vDigits && sDigits === vDigits);
      return (
        digitMatch ||
        v === s ||
        v.includes(s) ||
        s.includes(v) ||
        n.includes(`(${s}`) ||
        n.includes(` ${s} `) ||
        n.endsWith(` ${s}`) ||
        n.endsWith(` ${s}"`) ||
        (s === "regular" && (v.includes("reg") || n.includes("reg"))) ||
        (s === "reg" && (v.includes("reg") || n.includes("reg"))) ||
        (s === "medium" && (v.includes("med") || n.includes("med"))) ||
        (s === "med" && (v.includes("med") || n.includes("med"))) ||
        (s === "large" && (v.includes("large") || v.includes("lar") || n.includes("large"))) ||
        (s === "xl" && (v.includes("xl") || v.includes("extra large") || n.includes("xl"))) ||
        (s === "extra large" && (v.includes("xl") || v.includes("extra large") || n.includes("xl")))
      );
    };
    const sizeMatches = relevantCandidates.filter(isSizeMatch);
    if (sizeMatches.length === 1) {
      return { kind: "exact", item: sizeMatches[0], confidence: sizeMatches[0].similarity ?? 0.9 };
    }
    if (sizeMatches.length > 1) {
      // Check if these are distinct items (e.g. Vegetarian Pizza Large vs Chicken Pizza Large)
      // or sub-variants of the same base item
      const sizeDistinctBases = [...new Set(sizeMatches.map((m) => extractBaseItemName(m.name).baseName.toLowerCase()))];
      if (sizeDistinctBases.length > 1) {
        // Multiple DIFFERENT items at this size — present as options to choose
        return { kind: "ambiguous", query: trimmed, matches: sizeMatches.slice(0, 5) };
      }
      // Same base item with multiple sub-variants at this size — show variants
      sizeMatches.sort((a, b) => a.price - b.price);
      return { kind: "variants", baseName: sizeDistinctBases[0], variants: sizeMatches };
    }
  }

  // 3) Check if top candidates share the same base name with multiple size variants
  const topBase = extractBaseItemName(top.name);
  const sameBaseVariants = relevantCandidates.filter((c) => {
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

  // 4) Check for broad/ambiguous query matching multiple distinct dishes
  const candidatesCoveringQuery = relevantCandidates.filter((c) => queryTokensCoveredByName(trimmed, c.name));
  const distinctBases = [...new Set(relevantCandidates.slice(0, 5).map((c) => extractBaseItemName(c.name).baseName.toLowerCase()))];
  const isBroadSingleWord = /^(burger|burgers|pizza|pizzas|shawarma|roll|rolls|paratha|sandwich|sandwiches|pasta|fries|deal|deals|wrap|wraps|salad|salads|shake|shakes|karahi|kabab|tikka|handi|biryani|naan|roti|rice|drink|drinks|juice|dessert|fish|boti)$/i.test(trimmed);
  // Also detect "size/protein + generic dish" patterns like "large pizza", "chicken burger", "beef burger", "crispy wrap"
  const isBroadSizeOrTypeQuery = /^(?:small|medium|large|xl|x-large|extra\s*large|reg(?:ular)?|half|full|chicken|beef|crispy|smash|cheese|special|grilled|zinger)\s+(burger|burgers|pizza|pizzas|shawarma|roll|rolls|paratha|sandwich|sandwiches|pasta|fries|deal|deals|wrap|wraps|salad|salads|shake|shakes|karahi|kabab|tikka|handi|biryani|naan|roti|rice|drink|drinks|juice|dessert|fish|boti)$/i.test(trimmed);
  const isBroadQuery = isBroadSingleWord || isBroadSizeOrTypeQuery;

  // If multiple distinct dishes match the query (or the query is a broad generic dish/category term):
  if (distinctBases.length > 1 && (isBroadQuery || candidatesCoveringQuery.length > 1)) {
    const matches = (candidatesCoveringQuery.length > 1 ? candidatesCoveringQuery : relevantCandidates).slice(0, 5);
    return { kind: "ambiguous", query: trimmed, matches };
  }

  // Also check if user typed a deal/item with a number (e.g. "deal 1", "combo 1") matching multiple deals
  if (distinctBases.length > 1) {
    const numMatch = trimmed.match(/\b\d+\b/);
    if (numMatch) {
      const num = numMatch[0];
      const numMatchingCandidates = relevantCandidates.filter((c) => {
        const cNums = c.name.match(/\b\d+\b/g);
        return cNums && cNums.includes(num);
      });
      if (numMatchingCandidates.length > 1) {
        return { kind: "ambiguous", query: trimmed, matches: numMatchingCandidates.slice(0, 5) };
      }
    }
  }

  // If exactly ONE candidate uniquely covers all query tokens, it is an exact match:
  if (candidatesCoveringQuery.length === 1) {
    return { kind: "exact", item: candidatesCoveringQuery[0], confidence: 0.95 };
  }

  // 5) Single exact / clear best match
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
