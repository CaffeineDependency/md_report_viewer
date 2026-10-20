// Tiny hand-written router. No dependencies.
// Patterns use ":" for path segments and end with "*" for wildcards, e.g.
// "/admin/edit/:id", "/files/*". Wildcards only ever appear at the end.
//
// Handlers are called as handler(request, env, params, ctx).

const routes = [];

/**
 * Register a route.
 * @param {string} method
 * @param {string} pattern
 * @param {(request: Request, env: Env, params: object, ctx: ExecutionContext) => Promise<Response>|Response} handler
 */
export function route(method, pattern, handler) {
  const isWildcard = pattern.endsWith("*");
  const base = (isWildcard ? pattern.slice(0, -1) : pattern)
    .split("/")
    .filter(Boolean);
  routes.push({ method, isWildcard, base, handler });
}

/**
 * Find and invoke the matching handler.
 * @returns {Promise<Response>|null} null when no route matches
 */
export async function dispatch(request, env, ctx) {
  const url = new URL(request.url);
  const pathSegs = url.pathname.split("/").filter(Boolean);

  const isHead = request.method === "HEAD";
  for (const r of routes) {
    if (request.method !== r.method && !(isHead && r.method === "GET")) continue;

    if (r.isWildcard) {
      if (pathSegs.length < r.base.length) continue;
      let ok = true;
      for (let i = 0; i < r.base.length; i++) {
        if (r.base[i] !== pathSegs[i]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      return await r.handler(
        request,
        env,
        { wildcard: pathSegs.slice(r.base.length) },
        ctx
      );
    }

    if (pathSegs.length !== r.base.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < r.base.length; i++) {
      const seg = r.base[i];
      if (seg.startsWith(":")) {
        try {
          params[seg.slice(1)] = decodeURIComponent(pathSegs[i]);
        } catch {
          ok = false;
          break;
        }
      } else if (seg !== pathSegs[i]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    return await r.handler(request, env, params, ctx);
  }

  return null;
}
