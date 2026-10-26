/**
 * lib/menu/search.ts — Phase 6
 *
 * Resolve catalog names locally first, including spelling and size aliases.
 * Optional bounded vector retrieval supplies suggestions for descriptive queries.
 * Every result is reconciled with the current branch catalog; semantic similarity
 * alone never authorizes adding a different named dish.
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
const SIMILARITY_THRESHOLD = Number(process.env.MENU_MATCH_THRESHOLD) || 0.48;
const QUERY_EMBEDDING_TTL_MS = Number(process.env.MENU_QUERY_EMBEDDING_TTL_MS) || 10 * 60_000;
const MIN_EMBEDDABLE_LEN = 3; // shorter than this -> lexical fallback

let embeddingClient: OpenAI | null = null;
function getEmbeddingClient(): OpenAI | null {
  if (!EMBEDDING_API_KEY) return null;
  if (embeddingClient) return embeddingClient;
  embeddingClient = new OpenAI({ apiKey: EMBEDDING_API_KEY, baseURL: EMBEDDING_BASE_URL, maxRetries: 0, timeout: 2000 });
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
        "Set the key to enable optional descriptive menu suggestions.",
    );
  }
}

// ---------------------------------------------------------------------
// Text utils (lexical fallback only)
// ---------------------------------------------------------------------
function normalize(value: string): string {
  let v = value
    .toLowerCase()
    .replace(/[^a-z0-9.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Common Pakistani phonetic variations / transliterations
  v = v
    .replace(/\b(saji|sajji|sajje|sajy|sajjy|saaji|saajji)\b/g, "sajji")
    .replace(/\b(quater|quator|quatir|qtr|qauter)\b/g, "quarter")
    .replace(/\b(nan|non|naans|nans)\b/g, "naan")
    .replace(/\b(krahi|karai|kadai|kadhai)\b/g, "karahi")
    .replace(/\b(bryani|biryany|baryani|biryanis)\b/g, "biryani")
    .replace(/\b(handee|handy)\b/g, "handi")
    .replace(/\b(tika|tikkah|teeka|teekah)\b/g, "tikka")
    .replace(/\b(kebab|kabaab|kababs|kebabs|kebabz|kababz|kbb)\b/g, "kabab")
    .replace(/\b(boti|botiyan|botti|boty)\b/g, "boti")
    .replace(/\b(mali|mlai|malaee|malaii)\b/g, "malai")
    .replace(/\b(with\s*rice|with\s*chawal|sath\s*chawal|chawal\s*(?:ke|k|kay)\s*sath|chawal\s*sath)\b/g, "chawal")
    .replace(/\b(without\s*rice|without\s*chawal|baghair\s*rice|bina\s*rice|baghair\s*chawal|bina\s*chawal)\b/g, "baghair chawal")
    .replace(/\b(chawl|chaawal|chawal|chawall|rice)\b/g, "chawal")
    .replace(/\b(baghair|begair|bghair|bina|without)\b/g, "baghair")
    .replace(/\b(khali|sirf|only)\b/g, "")
    .replace(/\b(qalmi|kalmi|qulmi|kulmi)\b/g, "qalmi")
    .replace(/\b(reshmi|rehsmi|reshme)\b/g, "reshmi")
    .replace(/\b(rogni|roghani)\b/g, "roghni")
    .replace(/\b(cremy|cremi)\b/g, "creamy")
    .replace(/\b(raitah|rayta|raitaa)\b/g, "raita")
    .replace(/\b(machli|machhli|machliyan)\b/g, "fish")
    .replace(/\b(rohu|rohuu)\b/g, "rahu")
    .replace(/\b(peice|peices|peec|peace)\b/g, "piece")
    .replace(/\b(cheast|seena)\b/g, "chest")
    .replace(/\b(tang|taang)\b/g, "leg")
    .replace(/\b(sadah|plain)\b/g, "sada")
    .replace(/\b(paani|water)\b/g, "pani")
    .replace(/\b(coldring|colddrink|cooldrink|botal)\b/g, "cold drink")
    .replace(/\b(barbecue|barbeque|bar\s*b\s*q)\b/g, "bbq")
    .replace(/\b(milk\s*shakes?|shakes?)\b/g, "milkshake")
    .replace(/\b(pizzas)\b/g, "pizza")
    .replace(/\b(burgers)\b/g, "burger")
    .replace(/\bwith\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return v;
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const d: number[][] = [];
  for (let i = 0; i <= a.length; i++) d[i] = [i];
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[a.length][b.length];
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
  const nameTokens = new Set(normalize(name).split(" "));
  return qTokens.every((t) => nameTokens.has(t));
}

/** All meaningful words must identify the dish. One shared word (e.g. BBQ)
 * cannot turn a requested BBQ pizza into a chicken tikka. Short tokens and
 * numbers require exact identity; longer spelling mistakes allow a small edit. */
export function menuNameCoversQuery(query: string, name: string, allowTypos = true): boolean {
  const tokens = normalize(query).split(" ").filter(Boolean);
  const names = normalize(name).split(" ").filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => names.some((word) => token === word
    || allowTypos && token.length >= 6 && word.length >= 5 && editDistance(token, word) <= (token.length >= 8 ? 2 : 1)));
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
    if (inMemoryMenu) {
      return lexicalSearchInMemory(trimmed, inMemoryMenu as MenuRow[], limit);
    }
    return lexicalSearchFromDb(branchId, trimmed, limit);
  };

  // Most restaurant requests refer directly to catalog names. Resolve those
  // locally in microseconds, without an embedding HTTP call or vector RPC.
  // Keep every matching sibling for downstream size/flavor clarification.
  if (inMemoryMenu) {
    const baseQuery = trimmed.replace(SIZE_WORDS_PATTERN, " ").replace(/\s+/g, " ").trim();
    const matching = (allowTypos: boolean) => inMemoryMenu.filter((item) => item.is_available && (menuNameCoversQuery(trimmed, item.name, allowTypos)
      || extractSizeFromQuery(trimmed) && menuNameCoversQuery(baseQuery, extractBaseItemName(item.name).baseName, allowTypos)));
    const literal = matching(false);
    const direct = literal.length ? literal : matching(true);
    if (direct.length) {
      const matches = direct.map((item) => ({ ...item, description: item.description ?? null,
        similarity: Math.max(0.7, lexicalScore(trimmed, item as MenuRow)), method: "lexical" as const }))
        .sort((a, b) => b.similarity - a.similarity);
      return { matches, method: "lexical", usedEmbedding: false };
    }
    if (!inMemoryMenu.length) return { matches: [], method: "none", usedEmbedding: false };
  }

  // Genuinely un-embeddable (too short) -> lexical is the correct path.
  if (trimmed.length < MIN_EMBEDDABLE_LEN) {
    const matches = await lexicalFallback();
    return { matches, method: matches.length ? "lexical" : "none", usedEmbedding: false };
  }

  const normQuery = normalize(trimmed);
  const embedding = await embedQuery(normQuery || trimmed);
  if (!embedding) {
    const matches = await lexicalFallback();
    return { matches, method: matches.length ? "lexical" : "none", usedEmbedding: false };
  }

  let result;
  try {
    result = await supabaseAdmin.rpc("match_menu_items_by_embedding", {
      branch_uuid: branchId,
      query_embedding: toVectorLiteral(embedding),
      match_count: limit,
      similarity_threshold: SIMILARITY_THRESHOLD,
    }).abortSignal(AbortSignal.timeout(2000));
  } catch {
    const matches = await lexicalFallback();
    return { matches, method: matches.length ? "lexical" : "none", usedEmbedding: false };
  }
  const { data, error } = result;

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

  const matches: ResolvedMenuItem[] = rows.flatMap((row) => {
    const r = row as {
      id: string;
      name: string;
      price: number | string;
      category: string | null;
      description: string | null;
      is_available: boolean;
      similarity: number;
    };
    const current = inMemoryMenu?.find((item) => item.id === r.id);
    if (inMemoryMenu && (!current || !current.is_available)) return [];
    return [{
      id: r.id,
      name: r.name,
      price: Number(r.price),
      category: r.category,
      is_available: r.is_available,
      similarity: r.similarity,
      method: "vector" as const,
      ...current,
      description: current ? current.description ?? null : r.description,
    }];
  });

  return { matches, method: "vector", usedEmbedding: true };
}

// ---------------------------------------------------------------------
// Variant & Disambiguation Helpers
// ---------------------------------------------------------------------
const VARIANT_WORDS =
  "\\d+(?:\\.\\d+)?\\s*(?:ml|l(?:itre|iter)?s?|kg|g)|half\\s*(?:kg|l(?:itre|iter)?)|full|half|quarter|single|double|small|medium|extra\\s*large|large|xl|reg(?:ular)?|med(?:ium)?|lar(?:ge)?|\\d+[\"']|\\w+\\s*\\d+[\"']|\\d+\\s*pcs?|tin|glass|bottle|boneless|b\\/l|with\\s*cheese";

const VARIANT_SUFFIX_PATTERN = new RegExp(
  `(?:\\s*(?:[\\(\\[\\{]|\\s+-\\s+|\\s+\\/\\s+)(${VARIANT_WORDS})[\\)\\]\\}]?|\\s+(${VARIANT_WORDS}))\\s*$`,
  "i"
);

const VARIANT_PREFIX_PATTERN = new RegExp(
  `^(${VARIANT_WORDS})\\s+`,
  "i"
);

export function extractBaseItemName(fullName: string): { baseName: string; variant: string | null } {
  // Suffix variant: "Chicken Karahi (Half)", "Pizza Large"
  const suffixMatch = fullName.match(VARIANT_SUFFIX_PATTERN);
  const suffixVariant = suffixMatch ? (suffixMatch[1] || suffixMatch[2]) : null;
  if (suffixMatch && suffixVariant) {
    const base = fullName.slice(0, suffixMatch.index).trim();
    return { baseName: base || fullName.trim(), variant: suffixVariant.trim().toLowerCase() };
  }

  // Prefix variant: "Half Sajji", "1.5 Litre Pani"
  const prefixMatch = fullName.match(VARIANT_PREFIX_PATTERN);
  if (prefixMatch && prefixMatch[1]) {
    const base = fullName.slice(prefixMatch[0].length).trim();
    return { baseName: base || fullName.trim(), variant: prefixMatch[1].trim().toLowerCase() };
  }

  return { baseName: fullName.trim(), variant: null };
}

const SIZE_WORDS_PATTERN =
  /\b(\d+(?:\.\d+)?\s*(?:ml|l(?:itre|iter)?s?|kg|g)|half\s*(?:kg|l(?:itre|iter)?)|full|half|quarter|single|double|small|medium|extra\s*large|large|xl|reg(?:ular)?|med|\d+["']|\d+\s*inch|\d+\s*pcs?|tin|glass|bottle|derh|dedh|dehr|aadha|1\.5|0?\.5)\b/i;

export function extractSizeFromQuery(query: string, explicitSize?: string | null): string | null {
  const q = (explicitSize || query).toLowerCase();
  const volume = q.match(/\b(\d+(?:\.\d+)?)\s*(ml|l(?:itre|iter)?s?)\b/);
  if (volume) return `${Number(volume[1]) * (volume[2] === "ml" ? 1 : 1000)} ml`;
  if (/\b(half\s*l(?:itre|iter)?|aadha\s*l(?:itre|iter)?)\b/i.test(q)) return "500 ml";
  if (/\b(1\.5|derh|dedh|dehr)\b/i.test(q)) return "1500 ml";
  if (/\b(1\s*kg|aik\s*kilo|ek\s*kilo|1\s*kilo)\b/i.test(q)) return "1 kg";
  if (/\b(half\s*kg|aadha\s*kilo|0\.5\s*kg)\b/i.test(q)) return "0.5 kg";
  if (/\b(half|aadha|aadhi)\b/i.test(q)) return "half";
  if (/\b(quarter|chauthai|pao|paao)\b/i.test(q)) return "quarter";
  if (/\b(full|poori|poora)\b/i.test(q)) return "full";
  if (/\b(reg|regular)\b/i.test(q)) return "regular";
  if (/\b(med|medium)\b/i.test(q)) return "medium";
  if (/\b(xl|extra\s*large)\b/i.test(q)) return "xl";
  const match = q.match(SIZE_WORDS_PATTERN);
  return match ? match[1].toLowerCase() : null;
}

export type ItemResolutionResult =
  | { kind: "exact"; item: ResolvedMenuItem; confidence: number }
  | { kind: "variants"; baseName: string; variants: ResolvedMenuItem[] }
  | { kind: "ambiguous"; query: string; matches: ResolvedMenuItem[] }
  | { kind: "not_found"; query: string; suggestions: ResolvedMenuItem[] };

function isCandidateRelevant(query: string, candidate: ResolvedMenuItem): boolean {
  const sim = candidate.similarity ?? 0;
  if (sim >= 0.62) return true;

  const qTokens = normalize(query).split(" ").filter((t) => t.length >= 3);
  const nameNorm = normalize(candidate.name);
  const nameTokens = nameNorm.split(" ").filter((t) => t.length >= 3);
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
  if (matchesToken && sim >= 0.25) return true;

  // Fuzzy token match (typo tolerance)
  const matchesFuzzyToken = qTokens.some((qt) => {
    return nameTokens.some((nt) => {
      const maxLen = Math.max(qt.length, nt.length);
      const maxDist = maxLen >= 6 ? 2 : 1;
      return editDistance(qt, nt) <= maxDist;
    });
  });
  if (matchesFuzzyToken) return true;

  if (sim >= 0.48) return true;

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

  // Ranking must never hide choices that match the customer's words.
  if (inMemoryMenu) {
    const seen = new Set(combined.map((item) => item.id));
    for (const item of inMemoryMenu) {
      if (!seen.has(item.id) && item.is_available && queryTokensCoveredByName(baseQuery || trimmed, extractBaseItemName(item.name).baseName)) {
        combined.push({ ...item, description: item.description ?? null, similarity: lexicalScore(trimmed, item as MenuRow), method: "lexical" });
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
  const literalNames = available.filter((m) => menuNameCoversQuery(baseQuery || trimmed, extractBaseItemName(m.name).baseName, false));
  const nameMatches = literalNames.length ? literalNames : available.filter((m) => menuNameCoversQuery(baseQuery || trimmed, extractBaseItemName(m.name).baseName));
  const relevantCandidates = nameMatches.length ? nameMatches : available.filter((m) => isCandidateRelevant(trimmed, m));
  if (relevantCandidates.length === 0) {
    return { kind: "not_found", query: trimmed, suggestions: [] };
  }

  const top = relevantCandidates[0];
  const topSim = top.similarity ?? 0;
  if (topSim < 0.30) {
    return { kind: "not_found", query: trimmed, suggestions: [] };
  }

  // Shared category/ingredient words are useful suggestions, never permission
  // to add another dish. Semantic-only matches require an explicit selection.
  if (!nameMatches.length) return { kind: "not_found", query: trimmed, suggestions: relevantCandidates.slice(0, 5) };

  // 1) Direct exact name match (e.g. "RAITA" -> item "RAITA", "Half Sajji" -> "Half Sajji", "1.5 Litre Pani" -> "1.5 Litre Pani")
  const combinedQ1 = requestedSize ? `${requestedSize} ${baseQuery || trimmed}` : trimmed;
  const combinedQ2 = requestedSize ? `${baseQuery || trimmed} ${requestedSize}` : trimmed;
  const normCombinedQ1 = normalize(combinedQ1);
  const normCombinedQ2 = normalize(combinedQ2);

  const matchesSize = (c: ResolvedMenuItem) => extractSizeFromQuery(c.name) === requestedSize;
  const exactMatch = relevantCandidates.find((c) => {
    if (requestedSize && !matchesSize(c)) return false;
    const normCand = normalize(c.name);
    const normBaseCand = normalize(extractBaseItemName(c.name).baseName);
    const normQ = normalize(trimmed);
    const normBaseQ = normalize(baseQuery);
    return (
      normCand === normQ ||
      normCand === normBaseQ ||
      normCand === normCombinedQ1 ||
      normCand === normCombinedQ2 ||
      (!requestedSize && (normBaseCand === normQ || normBaseCand === normBaseQ))
    );
  });

  if (exactMatch) {
    if (requestedSize) {
      return { kind: "exact", item: exactMatch, confidence: 1.0 };
    }
    // User did not specify a size. Check if there are multiple size variants of this base item:
    const baseName = extractBaseItemName(exactMatch.name).baseName.toLowerCase();
    const sameBaseVariants = relevantCandidates.filter((c) => {
      const cBase = extractBaseItemName(c.name);
      return cBase.baseName.toLowerCase() === baseName && cBase.variant !== null;
    });
    if (sameBaseVariants.length > 1) {
      sameBaseVariants.sort((a, b) => a.price - b.price);
      return { kind: "variants", baseName: extractBaseItemName(exactMatch.name).baseName, variants: sameBaseVariants };
    }
    return { kind: "exact", item: exactMatch, confidence: 1.0 };
  }

  // 2) If user specified a size (e.g. "half", "full", "large", "reg", "medium", "xl", "1.5 litre"), find ALL candidates matching that size
  if (requestedSize) {
    let sizeMatches = relevantCandidates.filter(matchesSize);
    if (!sizeMatches.length) return { kind: "not_found", query: trimmed, suggestions: relevantCandidates.slice(0, 5) };
    if (sizeMatches.length === 1) {
      return { kind: "exact", item: sizeMatches[0], confidence: sizeMatches[0].similarity ?? 0.9 };
    }
    if (sizeMatches.length > 1) {
      // Check if one of the size matches is an exact match to the combined query
      const exactInSize = sizeMatches.find((m) => {
        const mNorm = normalize(m.name);
        return mNorm === normCombinedQ1 || mNorm === normCombinedQ2 || mNorm === normalize(trimmed);
      });
      if (exactInSize) {
        return { kind: "exact", item: exactInSize, confidence: 1.0 };
      }

      // Attribute disambiguation (e.g. "with rice" / "chawal" vs "without rice" / "baghair chawal")
      const normTrimmed = normalize(trimmed);
      const wantsChawal = normTrimmed.includes("chawal") && !normTrimmed.includes("baghair");
      const wantsBaghair = normTrimmed.includes("baghair") || normTrimmed.includes("sada");

      if (wantsChawal) {
        const chawalMatches = sizeMatches.filter(
          (m) =>
            m.name.toLowerCase().includes("chawal") ||
            (m.category && m.category.toLowerCase().includes("chawal") && !m.category.toLowerCase().includes("baghair")),
        );
        if (chawalMatches.length === 1) {
          return { kind: "exact", item: chawalMatches[0], confidence: 1.0 };
        }
        if (chawalMatches.length > 1) sizeMatches = chawalMatches;
      } else if (wantsBaghair) {
        const baghairMatches = sizeMatches.filter(
          (m) =>
            !m.name.toLowerCase().includes("chawal") ||
            (m.category && m.category.toLowerCase().includes("baghair")),
        );
        if (baghairMatches.length === 1) {
          return { kind: "exact", item: baghairMatches[0], confidence: 1.0 };
        }
        if (baghairMatches.length > 1) sizeMatches = baghairMatches;
      }

      // Check token coverage: if exactly one candidate has all query tokens, it's an exact match
      const qTokens = normTrimmed
        .split(" ")
        .filter((t) => t.length >= 3 && !["sada", "baghair", "sajji"].includes(t));
      if (qTokens.length > 0) {
        const fullCover = sizeMatches.filter((m) => {
          const mNorm = normalize(m.name);
          return qTokens.every((t) => mNorm.includes(t));
        });
        if (fullCover.length === 1) {
          return { kind: "exact", item: fullCover[0], confidence: 0.95 };
        }
      }

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

  // A broad request for pizza/drink must first choose a flavor/brand. Do not
  // narrow it to the top-ranked flavor's sizes.
  const bases = new Set(relevantCandidates.map((c) => normalize(extractBaseItemName(c.name).baseName)));
  if (bases.size > 1 && !relevantCandidates.some((c) => normalize(extractBaseItemName(c.name).baseName) === normalize(baseQuery || trimmed))) {
    return { kind: "ambiguous", query: trimmed, matches: relevantCandidates.slice(0, 10) };
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
