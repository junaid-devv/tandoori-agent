import type { DashboardSession } from "./auth";
import { ApiRequestError } from "./api-utils";

type Scope = { branchId: string | null; session: DashboardSession | null };
export const EMPTY_TENANT_SCOPE = "00000000-0000-0000-0000-000000000000";

/** An all-branches view always means all branches authorized for this session. */
export function scopeBranchQuery<T>(query: T, scope: Scope, column = "branch_id"): T {
  if (!scope.session) throw new ApiRequestError("Unauthorized", 401);
  const ids = scope.branchId ? [scope.branchId] : scope.session.allowedBranches.map(branch => branch.id);
  if (scope.branchId && !scope.session.allowedBranches.some(branch => branch.id === scope.branchId)) {
    throw new ApiRequestError("Forbidden for the selected branch", 403);
  }
  return (query as T & { in: (column: string, ids: string[]) => T }).in(column, ids.length ? ids : [EMPTY_TENANT_SCOPE]);
}

export function scopeRestaurantQuery<T>(query: T, session: DashboardSession | null, column = "restaurant_id"): T {
  if (!session?.restaurantId) throw new ApiRequestError("Select a restaurant first", 400);
  return (query as T & { eq: (column: string, value: string) => T }).eq(column, session.restaurantId);
}
