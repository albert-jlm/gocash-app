const ALLOWED_ORIGINS = new Set([
  "https://gocash.zether.net",
  "capacitor://localhost",
  "http://localhost:3000",
]);

function getAllowOrigin(req: Request): string {
  const origin = req.headers.get("Origin") ?? "";
  return ALLOWED_ORIGINS.has(origin) ? origin : "https://gocash.zether.net";
}

function corsHeaders(req: Request) {
  return {
    "Access-Control-Allow-Origin": getAllowOrigin(req),
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function handleCors(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req), status: 204 });
  }
  return null;
}

export function jsonResponse(
  req: Request,
  body: unknown,
  status = 200
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}
