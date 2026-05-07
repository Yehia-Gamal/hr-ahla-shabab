const defaultOrigins = [
  Deno.env.get('SITE_URL') || '',
  'https://yehia-gamal.github.io',
  'https://yehia-gamal.github.io/HR-Operations-Platform',
  'http://localhost:5500',
  'http://localhost:4173',
];

const envOrigins = (Deno.env.get('ALLOWED_ORIGINS') || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const devOrigins = [
  'http://127.0.0.1:5500',
  'http://localhost:5500',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
  'http://127.0.0.1:3000',
  'http://localhost:3000',
];

function originAllowed(origin: string, allowedOrigins: Set<string>) {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;
  try {
    const url = new URL(origin);
    if (url.hostname === 'yehia-gamal.github.io') return true;
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return true;
  } catch (_) {
    return false;
  }
  return false;
}

export function buildCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') ?? '';
  const requestHeaders = req.headers.get('Access-Control-Request-Headers') || 'authorization, x-client-info, apikey, content-type';
  const allowedOrigins = new Set([...defaultOrigins, ...envOrigins, ...devOrigins].filter(Boolean));
  const allowOrigin = originAllowed(origin, allowedOrigins)
    ? (origin || envOrigins[0] || 'https://yehia-gamal.github.io')
    : 'https://yehia-gamal.github.io';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Vary': 'Origin, Access-Control-Request-Headers',
    'Access-Control-Allow-Headers': requestHeaders,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
}

export function options(req: Request) {
  return new Response('ok', { status: 200, headers: buildCorsHeaders(req) });
}

export function json(req: Request, data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...buildCorsHeaders(req), 'Content-Type': 'application/json; charset=utf-8' },
  });
}
