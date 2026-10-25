// Test-only session injection for HTTP route regressions. Never used by the app.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@/lib/branch-request") return {
    shortCircuit: true,
    url: "data:text/javascript," + encodeURIComponent("export async function requireApiSession() { return { session: globalThis.__tenantRouteSession, response: null }; }"),
  };
  return nextResolve(specifier, context);
}
