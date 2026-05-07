import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { options, json } from '../_shared/cors.ts';

type EmployeeRow = {
  id: string;
  user_id?: string | null;
  full_name?: string | null;
  status?: string | null;
  is_active?: boolean | null;
};

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

function cairoDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function cairoWeekday() {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', weekday: 'short' }).format(new Date());
}

function subscriptionFromRow(row: PushRow) {
  const p256dh = row.keys?.p256dh || row.payload?.keys?.p256dh || row.p256dh || '';
  const auth = row.keys?.auth || row.payload?.keys?.auth || row.auth || '';
  if (!row.endpoint || !p256dh || !auth) return null;
  return { endpoint: row.endpoint, keys: { p256dh, auth } };
}

function asBool(value: unknown, fallback = true) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return !['0', 'false', 'no'].includes(value.toLowerCase());
  return fallback;
}

async function callerAllowed(req: Request, adminClient: any, anonKey: string, supabaseUrl: string) {
  const cronSecret = Deno.env.get('ATTENDANCE_REMINDER_CRON_SECRET') || Deno.env.get('CRON_SECRET') || '';
  const providedSecret = req.headers.get('x-cron-secret') || req.headers.get('x-attendance-cron-secret') || '';
  if (cronSecret && providedSecret && providedSecret === cronSecret) return true;

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return false;
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: callerData } = await userClient.auth.getUser();
  const userId = callerData?.user?.id;
  if (!userId) return false;
  const { data: profile, error } = await adminClient
    .from('profiles')
    .select('id, role_id, roles:role_id(slug, permissions)')
    .eq('id', userId)
    .single();
  if (error) return false;
  const role = Array.isArray(profile?.roles) ? profile.roles[0] : profile?.roles;
  const permissions = role?.permissions || [];
  return permissions.includes('*') || permissions.includes('alerts:manage') || permissions.includes('attendance:manage') || ['admin', 'hr-manager', 'executive-secretary'].includes(String(role?.slug || ''));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return options(req);
  if (req.method !== 'POST') return json(req, { error: 'METHOD_NOT_ALLOWED' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com';
  if (!supabaseUrl || !anonKey || !serviceKey) return json(req, { error: 'MISSING_SUPABASE_SECRETS' }, 500);

  const adminClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  if (!await callerAllowed(req, adminClient, anonKey, supabaseUrl)) return json(req, { error: 'FORBIDDEN_REMINDER_RUNNER' }, 403);

  const body = await req.json().catch(() => ({}));
  const today = String(body.date || cairoDate()).slice(0, 10);
  const sendPush = asBool(body.sendPush, true);
  const skipFriday = asBool(body.skipFriday, true);
  if (skipFriday && cairoWeekday() === 'Fri') return json(req, { ok: true, skipped: true, reason: 'FRIDAY_OFF', date: today, created: 0, pushed: 0 });

  const from = `${today}T00:00:00+02:00`;
  const to = `${today}T23:59:59+02:00`;

  const { data: employees, error: empError } = await adminClient
    .from('employees')
    .select('id,user_id,full_name,status,is_active')
    .eq('is_active', true)
    .neq('status', 'INACTIVE')
    .limit(5000);
  if (empError) return json(req, { error: empError.message }, 400);

  const { data: events, error: eventError } = await adminClient
    .from('attendance_events')
    .select('employee_id,type,event_at,created_at')
    .gte('event_at', from)
    .lte('event_at', to)
    .limit(10000);
  if (eventError) return json(req, { error: eventError.message }, 400);

  const { data: existing, error: existingError } = await adminClient
    .from('notifications')
    .select('employee_id,type,created_at')
    .eq('type', 'MISSING_PUNCH')
    .gte('created_at', from)
    .lte('created_at', to)
    .limit(10000);
  if (existingError) return json(req, { error: existingError.message }, 400);

  const seen = new Set((events || []).map((row: any) => String(row.employee_id || '')).filter(Boolean));
  const already = new Set((existing || []).map((row: any) => String(row.employee_id || '')).filter(Boolean));
  const missing = ((employees || []) as EmployeeRow[]).filter((employee) => employee.id && !seen.has(employee.id) && !already.has(employee.id));

  let created = 0;
  if (missing.length) {
    const inserts = missing.map((employee) => ({
      user_id: employee.user_id || null,
      employee_id: employee.id,
      title: 'تذكير بتسجيل البصمة',
      body: 'لم يتم تسجيل بصمة حضور اليوم حتى الآن. افتح صفحة البصمة وسجل حضورك عند الوصول للمجمع.',
      type: 'MISSING_PUNCH',
      status: 'UNREAD',
      is_read: false,
      route: 'punch',
    }));
    const { data: inserted, error: insertError } = await adminClient.from('notifications').insert(inserts).select('id,employee_id,user_id');
    if (insertError) return json(req, { error: insertError.message }, 400);
    created = inserted?.length || 0;
  }

  let pushed = 0;
  let failed = 0;
  if (sendPush && missing.length && vapidPublicKey && vapidPrivateKey) {
    const ids = missing.map((employee) => employee.id);
    const { data: subscriptions, error: subError } = await adminClient
      .from('push_subscriptions')
      .select('id,user_id,employee_id,endpoint,keys,payload,p256dh,auth,is_active,status')
      .in('employee_id', ids)
      .limit(5000);
    if (!subError) {
      webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
      const payload = JSON.stringify({
        title: 'تذكير البصمة',
        body: 'الساعة 9:30 صباحًا: لم تُسجل بصمة حضور اليوم بعد. افتح التطبيق وسجل حضورك عند الوصول.',
        tag: `missing-punch-${today}`,
        data: { route: 'punch', type: 'MISSING_PUNCH', date: today },
      });
      for (const row of (subscriptions || []) as PushRow[]) {
        if (row.is_active === false || ['EXPIRED', 'DISABLED'].includes(String(row.status || '').toUpperCase())) continue;
        const sub = subscriptionFromRow(row);
        if (!sub) continue;
        try {
          const response = await webpush.sendNotification(sub, payload, { TTL: 60 * 60 * 4 });
          pushed += 1;
          await adminClient.from('notification_delivery_log').insert({ push_subscription_id: row.id, target_user_id: row.user_id || null, status: 'SENT', provider_response: { statusCode: response.statusCode } });
        } catch (error) {
          failed += 1;
          const statusCode = Number((error as { statusCode?: number })?.statusCode || 0);
          const message = error instanceof Error ? error.message : String(error);
          await adminClient.from('notification_delivery_log').insert({ push_subscription_id: row.id, target_user_id: row.user_id || null, status: 'FAILED', error: message });
          if ([404, 410].includes(statusCode)) await adminClient.from('push_subscriptions').update({ is_active: false, status: 'EXPIRED', last_error: message }).eq('id', row.id);
        }
      }
    }
  }

  await adminClient.from('smart_alert_events').insert({
    rule_code: 'MISSING_PUNCH_0930',
    title: 'تشغيل تذكير بصمة 9:30',
    body: `تم إنشاء ${created} إشعار وإرسال ${pushed} Push.`,
    severity: 'WARNING',
    status: 'SENT',
    payload: { date: today, created, pushed, failed, source: body.source || 'scheduled' },
    sent_at: new Date().toISOString(),
  }).catch(() => null);

  return json(req, { ok: true, date: today, created, pushed, failed, missing: missing.length, skipped: false });
});
