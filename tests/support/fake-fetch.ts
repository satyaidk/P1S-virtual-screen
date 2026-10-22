type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

export interface FakeFetch {
  fetch: typeof fetch;
  calls: { url: string; method: string; body: unknown; headers: Record<string, string> }[];
}

/** Routes requests by "METHOD url-suffix" to handlers; unknown routes return 404. */
export function fakeFetch(routes: Record<string, Handler>): FakeFetch {
  const calls: FakeFetch["calls"] = [];
  const impl = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    calls.push({
      url,
      method,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
    });
    const key = Object.keys(routes).find((k) => {
      const [m, suffix] = k.split(" ");
      return m === method && url.endsWith(suffix!);
    });
    if (!key) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    return routes[key]!(url, init);
  };
  return { fetch: impl as typeof fetch, calls };
}

export const jsonResponse = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
