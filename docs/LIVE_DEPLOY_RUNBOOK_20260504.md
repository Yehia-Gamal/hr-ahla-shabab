# دليل النشر الحي النهائي — أحلى شباب HR

هذا الدليل يشرح ترتيب التشغيل بعد رفع النسخة النهائية التي تحتوي على:

- Identity Guard V4
- Neon Command Center Theme V3
- Full Workflow Notes Applied
- Final QA
- SQL patches 051–064

## 1) قبل رفع الملفات

لا ترفع أي ملف يحتوي على أسرار حقيقية داخل GitHub أو أي منصة عامة.

تأكد من وجود هذه القيم كـ GitHub Secrets أو Environment Variables في الاستضافة:

```text
VITE_SUPABASE_PROJECT_REF
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_VAPID_PUBLIC_KEY
HR_OPS_GATE_CODE
```

وتأكد من وجود هذه القيم داخل Supabase Edge Function Secrets فقط:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
VAPID_SUBJECT
LOGIN_RATE_LIMIT_SALT
LOGIN_RESOLVE_MAX_ATTEMPTS
LOGIN_RESOLVE_BLOCK_MINUTES
```

## 2) Supabase Database

شغّل ملفات SQL بالترتيب. إن كانت قاعدة البيانات محدثة حتى Patch 050، شغّل فقط:

```text
supabase/sql/RUN_IN_SUPABASE_SQL_EDITOR.sql
```

هذا الملف يجمع:

```text
051_attendance_identity_verification.sql
052_attendance_identity_server_review.sql
053_trusted_device_approval.sql
054_attendance_branch_qr_challenge.sql
055_attendance_anti_spoofing_risk.sql
056_attendance_risk_center.sql
057_employee_requests_two_stage_workflow.sql
058_kpi_advanced_workflow_percentages.sql
059_dispute_committee_privacy_workflow.sql
060_location_readable_labels_and_policy_ack.sql
061_trusted_device_policy_enforcement.sql
062_branch_qr_station_rotation.sql
063_attendance_fraud_ops_snapshot.sql
064_attendance_fallback_workflow.sql
```

## 3) Storage Buckets

تأكد من وجود هذه Buckets:

```text
avatars
punch-selfies
employee-attachments
```

أهم bucket لهذا الإصدار:

```text
punch-selfies
```

## 4) Edge Functions

انشر الوظائف المطلوبة:

```bash
supabase functions deploy admin-create-user --project-ref <project-ref>
supabase functions deploy admin-update-user --project-ref <project-ref>
supabase functions deploy resolve-login-identifier --project-ref <project-ref>
supabase functions deploy passkey-register --project-ref <project-ref>
supabase functions deploy send-push-notifications --project-ref <project-ref>
```

## 5) بعد الرفع مباشرة

افتح هذه المسارات:

```text
/
/employee/
/admin/
/executive/
/operations-gate/
/health.html
```

ثم امسح الكاش أو افتح نافذة خاصة إذا ظهر التصميم القديم.

## 6) اختبارات القبول الأساسية

### الموظف

- تسجيل دخول الموظف.
- ظهور الاسم والمسمى الوظيفي في الهيدر.
- ظهور الصفحة الرئيسية بالترتيب الجديد.
- إرسال موقع ويظهر كعنوان مفهوم.
- تسجيل بصمة حضور داخل المجمع.
- تسجيل بصمة خارج المجمع مع ملاحظة.
- طلب إجازة.
- طلب مأمورية.
- تقديم شكوى.
- تأكيد قراءة سياسة.
- تعبئة KPI عندما تكون الدورة مفتوحة.

### المدير المباشر

- ظهور صفحة فريقي.
- مراجعة طلب إجازة.
- مراجعة طلب مأمورية.
- مراجعة KPI للفريق.
- رؤية إشعار شكوى في الفريق بدون تفاصيل حساسة.

### HR / الإدارة

- مراجعة الحضور المشبوه.
- اعتماد جهاز جديد.
- مراجعة طلبات المدير المعتمدة.
- مراجعة الشكاوى في لجنة الخلافات.
- مراجعة KPI.
- تصدير التقارير.

### المدير التنفيذي

- رؤية المؤشرات العامة.
- رؤية التصعيدات فقط عندما تصل للمدير التنفيذي.
- متابعة مركز المخاطر.

## 7) معايير النجاح

النسخة تعتبر جاهزة للتشغيل الحي عندما تنجح السيناريوهات التالية:

```text
موظف 1 يسجل حضور من جهازه داخل المجمع.
موظف 2 يحاول استخدام نفس الجهاز خلال 30 دقيقة.
النظام يرفع SERVER_SHARED_DEVICE_RECENT.
تتحول الحركة إلى مراجعة HR.
HR يعتمد أو يرفض.
```

```text
الموظف يطلب إجازة.
المدير المباشر يوافق.
HR يعتمد نهائيًا.
الموظف يستلم إشعارًا بالحالة.
```

```text
الموظف يقدم شكوى ضد موظف.
الطرف المذكور يستلم إشعارًا عامًا بدون تفاصيل.
اللجنة ترى التفاصيل.
المدير المباشر يرى فقط وجود شكوى في الفريق بدون أسماء أو تفاصيل.
```


## V27 Clean Supabase Update

استخدم الآن ملف SQL واحد فقط: `supabase/sql/RUN_IN_SUPABASE_SQL_EDITOR.sql`، ثم شغّل `DEPLOY_SUPABASE_PRODUCTION.ps1` أو `DEPLOY_SUPABASE_PRODUCTION.sh`. الملفات القديمة موجودة في `_archive` للرجوع فقط.
