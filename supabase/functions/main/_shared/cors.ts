/**
 * CORS for the GoCash edge functions.
 *
 * This replaces `Access-Control-Allow-Origin: "*"`, which is what production has
 * been serving on every route. Audit #4 recorded an origin allowlist as done, but
 * it was never actually deployed — the restricted version only ever existed in the
 * stale repo copy. See AUDITS.md #5a finding 5.
 *
 * Every endpoint still requires a valid Supabase JWT (VERIFY_JWT=true), so CORS is
 * defence in depth against browser-driven abuse, not the primary auth control.
 *
 * Configure with a comma-separated env var, e.g.
 *   ALLOWED_ORIGINS=https://gocash.zether.net,capacitor://localhost,http://localhost:3000
 *
 * Capacitor sends `capacitor://localhost` on iOS and `http://localhost` on Android,
 * so both belong in the list for the native shells to work.
 */

const DEFAULT_ORIGINS = [
  "https://gocash.zether.net",
  "capacitor://localhost",
  "http://localhost",
  "http://localhost:3000",
];

const ALLOWED_ORIGINS: string[] = (() => {
  const raw = Deno.env.get("ALLOWED_ORIGINS");
  if (!raw) return DEFAULT_ORIGINS;
  const parsed = raw.split(",").map((o) => o.trim()).filter(Boolean);
  return parsed.length > 0 ? parsed : DEFAULT_ORIGINS;
})();

/**
 * Echo the caller's origin only when it is on the list; otherwise fall back to the
 * canonical production origin. Never echo an arbitrary origin back — that is
 * equivalent to "*" with extra steps.
 */
function resolveOrigin(req: Request): string {
  const origin = req.headers.get("Origin") ?? "";
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

function corsHeaders(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": resolveOrigin(req),
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    // Required: the response varies by request origin, so caches must not reuse
    // one origin's response for another.
    "Vary": "Origin",
  };
}

export function handleCors(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export function jsonResponse(
  req: Request,
  body: Record<string, unknown>,
  status = 200
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}
