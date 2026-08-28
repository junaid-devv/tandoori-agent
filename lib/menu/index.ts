/**
 * lib/menu — Phase 6 menu namespace.
 * search.ts is THE retrieval path; embeddings sync is re-exported from the
 * existing semantic-menu module (populates menu_item_embeddings on menu save).
 */
export {
  searchMenu,
  resolveItem,
  isVectorSearchEnabled,
  assertSearchReady,
  type ResolvedMenuItem,
  type MenuSearchResult,
  type ResolutionMethod,
} from "./search";
export { syncMenuEmbeddingsForBranch } from "@/lib/semantic-menu";
