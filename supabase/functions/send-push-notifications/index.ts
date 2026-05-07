import { options, json } from '../_shared/cors.ts';

type PushRow = {
  id: string;
  user_id?: string | null;
  employee_id?: string | null;
  endpoint: string;
  keys?: { p256dh?: string; auth?: string } | null;
  payload?: { keys?: { p256dh?: string; auth?: string } } | null;
  p256dh?: string | null;
  auth?: string | null;
  is_active?: boolean | null;
  status?: string | null;
};

function asArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((v) => v.trim()).filter(Boolean) : [];
}

function subscriptionFromRow(row: PushRow) {
  const p256dh = row.p256dh || row.keys?.p256dh || row.payload?.keys?.p256dh || '';
  const auth = row.auth || row.keys?.auth || row.payload?.keys?.auth || '';
  if (!row.endpoint || !p256dh || !auth) return null;
  return { endpoint: row.endpoint, keys: { p256dh, auth } };
}

function activeRow(row: PushRow) {
  if (row.is_active === false) return false;
  if (row.status && !['ACTIVE', 'active', ''].includes(String(row.status))) return false;
  return true;
}

async function safeInsertLog(adminClient: any, row: Record<string, unknown>) {
  try { await adminClient.from('notification_delivery_log').insert(row); } catch (_) { /* optional table */ }
}

async function pushRowsForTargets(adminClient: any, targetUserIds: string[], targetEmployeeIds: string[], audience: unknown) {
  const columns = 'id,user_id,employee_id,endpoint,keys,payload,p256dh,auth,is_active,status';
  const byId = new Map<string, PushRow>();
  const collect = (rows: PushRow[] | null | undefined) => {
    for (const row of rows || []) if (row?.id) byId.set(row.id, row);
  };

  if (targetUserIds.length) {
    const { data, error } = await adminClient.from('push_subscriptions').select(columns).in('user_id', targetUserIds).limit(1000);
    if (error) return { rows: [] as PushRow[], error };
    collect(data as PushRow[]);
  }
  if (targetEmployeeIds.length) {
    const { data, error } = await adminClient.from('push_subscriptions').select(columns).in('employee_id', targetEmployeeIds).limit(1000);
    if (error) return { rows: [] as PushRow[], error };
    collect(data as PushRow[]);
  }
  if (!targetUserIds.length && !targetEmployeeIds.length) {
    if (audience !== 'all') return { rows: [] as PushRow[], error: { message: 'TARGET_REQUIRED', status: 400 } };
    const { data, error } = await adminClient.from('push_subscriptions').select(columns).limit(1000);
    if (error) return { rows: [] as PushRow[], error };
    collect(data as PushRow[]);
  }

  return { rows: Array.from(byId.values()), error: null };
}

async function callerCanSend(userClient: any, adminClient: any, userId: string) {
  const scopes = ['alerts:manage', 'notifications:manage', 'users:manage', 'live-location:request', 'executive:report'];
  try {
    const [full, anyPerm] = await Promise.all([
      userClient.rpc('current_is_full_access'),
      userClient.rpc('has_any_permission', { scopes }),
    ]);
    if (full?.data === true || anyPerm?.data === true) return true;
  } catch (_) { /* fall back below */ }
  try {
    const { data } = await adminClient
      .from('profiles')
      .select('id, permissions, role_id, roles:role_id(slug, permissions)')
      .eq('id', userId)
      .maybeSingle();
    const role = Array.isArray(data?.roles) ? data.roles[0] : data?.roles;
    const roleSlug = String(role?.slug || data?.permissions?.__role || data?.permissions?.role || '').trim().toLowerCase();
    const rolePermissions = Array.isArray(role?.permissions) ? role.permissions : [];
    const jsonPermissions = data?.permissions && typeof data.permissions === 'object' ? Object.keys(data.permissions).filter((k) => data.permissions[k]) : [];
    const allPermissions = new Set([...rolePermissions, ...jsonPermissions].map((item) => String(item).trim()).filter(Boolean));
    return ['admin', 'executive', 'executive-secretary', 'hr-manager', 'technical-lead'].includes(roleSlug)
      || allPermissions.has('*')
      || scopes.some((scope) => allPermissions.has(scope));
  } catch (_) {
    return false;
  }
}

Deno.serve(async (req) => {
  // Keep preflight dependency-free. This is the most important part for GitHub Pages CORS.
  if (req.method === 'OPTIONS') return options(req);
  if (req.method !== 'POST') return json(req, { error: 'METHOD_NOT_ALLOWED' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com';
  if (!supabaseUrl || !anonKey || !serviceKey) return json(req, { error: 'MISSING_SUPABASE_SECRETS' }, 500);
  if (!vapidPublicKey || !vapidPrivateKey) {
    return json(req, {
      ok: true,
      attempted: 0,
      sent: 0,
      skipped: true,
      reason: 'MISSING_VAPID_SECRETS',
      message: 'Push notification secrets are not configured; internal notification flow can continue.',
    });
  }

  let createClient: any;
  let webpush: any;
  try {
    const supabaseModule = await import('https://esm.sh/@supabase/supabase-js@2');
    const webpushModule = await import('npm:web-push@3.6.7');
    createClient = supabaseModule.createClient;
    webpush = webpushModule.default || webpushModule;
  } catch (error) {
    return json(req, { error: 'RUNTIME_IMPORT_FAILED', detail: error instanceof Error ? error.message : String(error) }, 500);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const adminClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: callerData, error: callerError } = await userClient.auth.getUser();
  if (callerError || !callerData.user) return json(req, { error: 'UNAUTHORIZED' }, 401);
  if (!await callerCanSend(userClient, adminClient, callerData.user.id)) return json(req, { error: 'FORBIDDEN_NOTIFICATION_SEND' }, 403);

  const body = await req.json().catch(() => ({}));
  const payload = {
    title: String(body.title || 'تنبيه من نظام الحضور'),
    body: String(body.body || body.message || 'لديك إشعار جديد.'),
    tag: String(body.tag || 'hr-notification'),
    data: body.data || {},
  };
  const targetUserIds = asArray(body.targetUserIds || (body.userId ? [body.userId] : []));
  const targetEmployeeIds = asArray(body.targetEmployeeIds || (body.employeeId ? [body.employeeId] : []));
  const notificationId = String(body.notificationId || '').trim() || null;

  const { rows: rawRows, error: subError } = await pushRowsForTargets(adminClient, targetUserIds, targetEmployeeIds, body.audience);
  if (subError) {
    const subErrorAny = subError as any;
    if (String(subErrorAny.message || '') === 'TARGET_REQUIRED') return json(req, { error: 'TARGET_REQUIRED' }, 400);
    // Gracefully handle missing push_subscriptions table (not yet created via SQL patches)
    const code = String(subErrorAny.code || '');
    if (['42P01', 'PGRST200', 'PGRST204', '42703'].includes(code) || String(subErrorAny.message || '').includes('does not exist')) {
      return json(req, {
        ok: true,
        attempted: 0,
        sent: 0,
        skipped: true,
        reason: 'PUSH_TABLE_NOT_READY',
        message: 'push_subscriptions table is not available yet; push delivery skipped. Run RUN_IN_SUPABASE_SQL_EDITOR.sql to enable.',
      });
    }
    return json(req, { error: subErrorAny.message }, 400);
  }
  const rows = ((rawRows || []) as PushRow[]).filter(activeRow);

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  const results = [];
  for (const row of rows) {
    const subscription = subscriptionFromRow(row);
    if (!subscription) {
      results.push({ id: row.id, status: 'SKIPPED', error: 'INVALID_SUBSCRIPTION_KEYS' });
      continue;
    }
    try {
      const response = await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 60 * 60 });
      await safeInsertLog(adminClient, {
        notification_id: notificationId,
        push_subscription_id: row.id,
        target_user_id: row.user_id,
        status: 'SENT',
        provider_response: { statusCode: response.statusCode, headers: response.headers },
      });
      await adminClient.from('push_subscriptions').update({ last_sent_at: new Date().toISOString(), last_error: '', status: 'ACTIVE', is_active: true }).eq('id', row.id);
      results.push({ id: row.id, status: 'SENT' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const statusCode = Number((error as { statusCode?: number })?.statusCode || 0);
      await safeInsertLog(adminClient, {
        notification_id: notificationId,
        push_subscription_id: row.id,
        target_user_id: row.user_id,
        status: 'FAILED',
        error: message,
      });
      const patch: Record<string, unknown> = { last_error: message, updated_at: new Date().toISOString() };
      if ([404, 410].includes(statusCode)) { patch.status = 'EXPIRED'; patch.is_active = false; }
      await adminClient.from('push_subscriptions').update(patch).eq('id', row.id);
      results.push({ id: row.id, status: 'FAILED', statusCode, error: message });
    }
  }

  if (notificationId) {
    const sent = results.filter((item) => item.status === 'SENT').length;
    const failed = results.filter((item) => item.status === 'FAILED').length;
    await adminClient.from('notifications').update({
      push_sent_at: sent ? new Date().toISOString() : null,
      push_status: failed ? 'PARTIAL_OR_FAILED' : (sent ? 'SENT' : 'NO_SUBSCRIPTIONS'),
      push_error: failed ? `${failed} failed` : '',
    }).eq('id', notificationId);
  }

  return json(req, { ok: true, attempted: results.length, sent: results.filter((item) => item.status === 'SENT').length, results });
});
