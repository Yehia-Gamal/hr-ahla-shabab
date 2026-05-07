import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { options, json } from '../_shared/cors.ts';

function normalizePhone(value: unknown) {
  const ar = '٠١٢٣٤٥٦٧٨٩';
  const fa = '۰۱۲۳۴۵۶۷۸۹';
  let text = String(value || '').trim();
  text = text.replace(/[٠-٩]/g, (d) => String(ar.indexOf(d))).replace(/[۰-۹]/g, (d) => String(fa.indexOf(d)));
  let digits = text.replace(/\D/g, '');
  if (digits.startsWith('0020')) digits = digits.slice(2);
  if (digits.startsWith('20') && digits.length >= 12) digits = `0${digits.slice(2)}`;
  if (digits.length === 10 && digits.startsWith('1')) digits = `0${digits}`;
  return digits;
}

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function syntheticEmail(phone: string) {
  return `employee.${phone || crypto.randomUUID()}@ahla-shabab.local`.toLowerCase();
}

function isDuplicateAuthError(message = '') {
  return /already|exists|registered|duplicate/i.test(message);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return options(req);
  return json(req, {
    error: 'EMPLOYEE_SELF_REGISTRATION_DISABLED',
    message: 'تم إيقاف تسجيل الموظفين من تطبيق الموظف. إضافة الموظفين وإنشاء الحسابات تتم من لوحة HR فقط.'
  }, 410);
});
