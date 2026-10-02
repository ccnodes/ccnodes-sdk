/** A scripted fetch: each call takes the next handler, and every request is recorded. */
export type Handler = (req: { url: string; method: string; headers: Record<string, string>; body?: string }) =>
  | { status?: number; body?: unknown; text?: string }
  | Promise<{ status?: number; body?: unknown; text?: string }>;

type Fixed = { status?: number; body?: unknown; text?: string };

/** Handlers may be functions or fixed responses; a single one answers every call. */
export function mockFetch(handlers: Array<Handler | Fixed> | Handler | Fixed) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }> = [];
  let i = 0;
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers as Record<string, string>) ?? {})) headers[k.toLowerCase()] = v;
    const req = { url: String(input), method: init?.method ?? "GET", headers, body: init?.body as string | undefined };
    calls.push(req);
    const h = Array.isArray(handlers) ? handlers[Math.min(i++, handlers.length - 1)]! : handlers;
    const r = typeof h === "function" ? await h(req) : h;
    const text = r.text ?? (r.body === undefined ? "" : JSON.stringify(r.body));
    return new Response(text, { status: r.status ?? 200 });
  };
  return { fn: fn as typeof fetch, calls };
}
