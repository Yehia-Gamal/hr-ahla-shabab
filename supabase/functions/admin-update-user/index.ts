import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { options, json } from '../_shared/cors.ts';

function strongEnough(pwd: string): boolean {
  return typeof pwd === 'string' && pwd.length >= 10
    && /[A-Z]/.test(pwd) && /[a-z]/.test(pwd)
    && /\d/.test(pwd) && /[^A-Za-z0-9]/.test(pwd);
}

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function normalizePhone(value: unknown) {
  return String(value || '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/\D/g, '');
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
  const userId = String(body.id || body.userId || '').trim();
  if (!userId) return json(req, { error: 'USER_ID_REQUIRED' }, 400);

  const email = normalizeEmail(body.email);
  const phone = normalizePhone(body.phone);
  const authPatch: Record<string, unknown> = {};
  if (email) authPatch.email = email;
  if (body.password) {
    const newPassword = String(body.password);
    if (phone && normalizePhone(newPassword) === phone) {
      return json(req, { error: 'PASSWORD_REJECTED', message: 'كلمة المرور غير مقبولة.' }, 400);
    }
    if (!strongEnough(newPassword)) {
      return json(req, { error: 'PASSWORD_WEAK', message: 'كلمة المرور ضعيفة. يجب أن تحتوي 10 أحرف على الأقل مع حرف كبير وصغير ورقم ورمز، ولا يُسمح باستخدام رقم الهاتف ككلمة مرور.' }, 400);
    }
    authPatch.password = newPassword;
  }
  if (Object.keys(authPatch).length) {
    const { error: authError } = await adminClient.auth.admin.updateUserById(userId, {
      ...authPatch,
      email_confirm: email ? true : undefined,
      user_metadata: {
        full_name: body.fullName || body.name || email || undefined,
        avatar_url: body.avatarUrl || body.photoUrl || undefined,
      },
    });
    if (authError) return json(req, { error: authError.message }, 400);
  }

  const profilePatch = {
    full_name: body.fullName || body.name || undefined,
    email: email || undefined,
    phone: phone || undefined,
    avatar_url: body.avatarUrl || body.photoUrl || undefined,
    employee_id: body.employeeId || undefined,
    role_id: body.roleId || undefined,
    branch_id: body.branchId || undefined,
    department_id: body.departmentId || undefined,
    governorate_id: body.governorateId || undefined,
    complex_id: body.complexId || undefined,
    status: body.status || undefined,
    temporary_password: body.password ? true : undefined,
    must_change_password: body.password ? true : undefined,
  };

  const { data: profile, error: updateError } = await adminClient
    .from('profiles')
    .update(profilePatch)
    .eq('id', userId)
    .select('*')
    .single();
  if (updateError) return json(req, { error: updateError.message }, 400);

  const employeeId = body.employeeId || profile?.employee_id;
  if (employeeId && (email || phone)) {
    await adminClient.from('employees').update({ email: email || undefined, phone: phone || undefined, user_id: userId }).eq('id', employeeId);
  }

  return json(req, { ok: true, user: profile });
});
