import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { options, json } from '../_shared/cors.ts';

function normalizeLoginPhone(value: unknown) {
  let text = String(value || '').trim();
  const ar = '٠١٢٣٤٥٦٧٨٩';
  const fa = '۰۱۲۳۴۵۶۷۸۹';
  text = text.replace(/[٠-٩]/g, (d) => String(ar.indexOf(d))).replace(/[۰-۹]/g, (d) => String(fa.indexOf(d)));
  let digits = text.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0020')) digits = digits.slice(2);
  if (digits.startsWith('20') && digits.length >= 12) digits = `0${digits.slice(2)}`;
  if (digits.length === 10 && digits.startsWith('1')) digits = `0${digits}`;
  return digits;
}

async function sha256(value: string) {
  const data = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function requestIp(req: Request) {
  return req.headers.get('cf-connecting-ip')
    || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || 'unknown';
}

function minutesFromNow(minutes: number) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return options(req);
  if (req.method !== 'POST') return json(req, { error: 'METHOD_NOT_ALLOWED' }, 405);

  const body = await req.json().catch(() => ({}));
  const identifier = String(body.identifier || body.loginIdentifier || '').trim();
  const phone = normalizeLoginPhone(identifier);
  if (!phone) return json(req, { error: 'INVALID_IDENTIFIER' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return json(req, { error: 'MISSING_SUPABASE_SECRETS' }, 500);

  const rateLimitSalt = Deno.env.get('LOGIN_RATE_LIMIT_SALT') || serviceKey.slice(0, 32);
  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const ipHash = await sha256(`${rateLimitSalt}:${requestIp(req)}`);
  const identifierHash = await sha256(`${rateLimitSalt}:${phone}`);
  const maxAttempts = Number(Deno.env.get('LOGIN_RESOLVE_MAX_ATTEMPTS') || 8);
  const blockMinutes = Number(Deno.env.get('LOGIN_RESOLVE_BLOCK_MINUTES') || 15);

  const { data, error } = await adminClient.rpc('resolve_login_identifier', { login_identifier: phone });
  if (error) {
    console.warn('resolve_login_identifier failed', error.message);
    return json(req, { error: 'RESOLVER_UNAVAILABLE' }, 503);
  }

  const email = String(data || '').trim().toLowerCase();
  if (email) {
    await adminClient
      .from('login_identifier_attempts')
      .delete()
      .eq('ip_hash', ipHash)
      .eq('identifier_hash', identifierHash);
    // The browser still needs an email for Supabase signInWithPassword. Failed lookups are rate limited.
    return json(req, { email });
  }

  const { data: currentAttempt } = await adminClient
    .from('login_identifier_attempts')
    .select('id, attempts, blocked_until')
    .eq('ip_hash', ipHash)
    .eq('identifier_hash', identifierHash)
    .maybeSingle();

  if (currentAttempt?.blocked_until && new Date(currentAttempt.blocked_until).getTime() > Date.now()) {
    return json(req, { error: 'RATE_LIMITED', retryAfterSeconds: Math.ceil((new Date(currentAttempt.blocked_until).getTime() - Date.now()) / 1000) }, 429);
  }

  const nextAttempts = Number(currentAttempt?.attempts || 0) + 1;
  const blockedUntil = nextAttempts > maxAttempts ? minutesFromNow(blockMinutes) : null;
  await adminClient.from('login_identifier_attempts').upsert({
    ip_hash: ipHash,
    identifier_hash: identifierHash,
    attempts: nextAttempts,
    blocked_until: blockedUntil,
    last_attempt_at: new Date().toISOString(),
  }, { onConflict: 'ip_hash,identifier_hash' });

  if (blockedUntil) return json(req, { error: 'RATE_LIMITED', retryAfterSeconds: blockMinutes * 60 }, 429);
  return json(req, { error: 'ACCOUNT_NOT_FOUND' }, 404);
});
