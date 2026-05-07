import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { options, json } from '../_shared/cors.ts';

function strongEnough(password: string) {
  return typeof password === 'string' && password.length >= 10 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
}

function normalizePhone(value: unknown) {
  const ar = '٠١٢٣٤٥٦٧٨٩';
  const fa = '۰۱۲۳۴۵۶۷۸۹';
  let text = String(value || '').trim();
  text = text.replace(/[٠-٩]/g, (d) => String(ar.indexOf(d))).replace(/[۰-۹]/g, (d) => String(fa.indexOf(d)));
  return text.replace(/\D/g, '');
}

function passwordAllowedForRoster(password: string, phone: string) {
  return Boolean(phone && password === phone);
}

function generateTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  const core = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
  return `${core}@Aa1!`;
}

async function findUserByEmail(adminClient: any, email: string) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const user = (data?.users || []).find((item: any) => String(item.email || '').toLowerCase() === email);
    if (user) return user;
    if (!data?.users || data.users.length < 1000) return null;
  }
  return null;
}

async function recreateBrokenRosterUser(adminClient: any, email: string, body: any, password: string) {
  if (!email.startsWith('emp.') || !email.endsWith('@ahla.local')) return null;
  const { data: employee } = await adminClient
    .from('employees')
    .select('id, user_id')
    .eq('email', email)
    .maybeSingle();
  const { data: profile } = await adminClient
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  const brokenUserId = employee?.user_id || profile?.id || null;
  if (brokenUserId) {
    await adminClient.auth.admin.deleteUser(brokenUserId, true).catch((error: Error) => {
      console.warn('delete broken roster user failed', error.message);
    });
  }
  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: body.fullName || body.name || email, avatar_url: body.avatarUrl || body.photoUrl || '' },
  });
  if (error) throw error;
  return data.user;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return options(req);
  if (req.method !== 'POST') return json(req, { error: 'METHOD_NOT_ALLOWED' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) return json(req, { error: 'MISSING_SUPABASE_SECRETS' }, 500);
  const authHeader = req.headers.get('Authorization') ?? '';

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const adminClient = createClient(supabaseUrl, serviceKey);

  const { data: callerData, error: callerError } = await userClient.auth.getUser();
  if (callerError || !callerData.user) return json(req, { error: 'UNAUTHORIZED' }, 401);

  const { data: callerProfile, error: profileError } = await adminClient
    .from('profiles')
    .select('id, role_id, roles:role_id(slug, permissions)')
    .eq('id', callerData.user.id)
    .single();
  if (profileError) return json(req, { error: profileError.message }, 400);
  const role = Array.isArray(callerProfile?.roles) ? callerProfile.roles[0] : callerProfile?.roles;
  const permissions = role?.permissions || [];
  const allowed = permissions.includes('*') || permissions.includes('users:manage') || ['admin', 'hr-manager'].includes(role?.slug);
  if (!allowed) return json(req, { error: 'FORBIDDEN_ADMIN_USER_MANAGEMENT_ONLY' }, 403);

  const body = await req.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const phone = normalizePhone(body.phone);
  const explicitPassword = typeof body.password === 'string' && body.password.length > 0;
  const password = explicitPassword ? String(body.password) : (phone || generateTemporaryPassword());
  const isRosterPhonePassword = passwordAllowedForRoster(password, phone);
  if (!email) return json(req, { error: 'EMAIL_REQUIRED' }, 400);
  if (explicitPassword && !strongEnough(password) && !isRosterPhonePassword) return json(req, { error: 'PASSWORD_WEAK: كلمة المرور يجب أن تكون قوية أو مطابقة لرقم هاتف الموظف المعتمد.' }, 400);

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: body.fullName || body.name || email, avatar_url: body.avatarUrl || body.photoUrl || '' },
  });

  let authUser = created?.user || null;
  let action = 'created';
  if (createError) {
    authUser = await recreateBrokenRosterUser(adminClient, email, body, password).catch((error: Error) => {
      console.error('recreate roster user failed', error.message);
      return null;
    });
    if (authUser) {
      action = 'recreated';
    } else {
    const existing = await findUserByEmail(adminClient, email).catch((error) => {
      console.error('listUsers failed', error.message);
      return null;
    });
    if (!existing) return json(req, { error: createError.message }, 400);
    const { data: updated, error: updateError } = await adminClient.auth.admin.updateUserById(existing.id, {
      email,
      password,
      email_confirm: true,
      user_metadata: { ...(existing.user_metadata || {}), full_name: body.fullName || body.name || email, avatar_url: body.avatarUrl || body.photoUrl || '' },
    });
    if (updateError) return json(req, { error: updateError.message }, 400);
    authUser = updated.user;
    action = 'updated';
    }
  }

  const userId = authUser.id;
  const patch = {
    full_name: body.fullName || body.name || email,
    email,
    phone: phone || null,
    avatar_url: body.avatarUrl || body.photoUrl || '',
    employee_id: body.employeeId || null,
    role_id: body.roleId || null,
    branch_id: body.branchId || null,
    department_id: body.departmentId || null,
    governorate_id: body.governorateId || null,
    complex_id: body.complexId || null,
    status: body.status || 'ACTIVE',
    temporary_password: true,
    must_change_password: true,
  };

  await adminClient.from('profiles').upsert({ id: userId, ...patch }, { onConflict: 'id' });
  if (body.employeeId) await adminClient.from('employees').update({ user_id: userId, email, phone: phone || null }).eq('id', body.employeeId);

  return json(req, {
    ok: true,
    action,
    user: {
      id: userId,
      email,
      full_name: patch.full_name,
      phone: patch.phone,
    },
    temporaryPasswordGenerated: !explicitPassword || isRosterPhonePassword,
  });
});
