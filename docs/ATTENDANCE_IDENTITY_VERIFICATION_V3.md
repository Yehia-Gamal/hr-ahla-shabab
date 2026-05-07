# Attendance Identity Guard V3 — حماية البصمة المتقدمة

تمت إضافة طبقة V3 فوق Identity Guard V1/V2 لمنع تبادل الموظفين للموبايلات أو الحسابات أثناء تسجيل الحضور.

## المكونات الجديدة

1. **اعتماد الجهاز من HR**
   - أي جهاز جديد يفتح طلب اعتماد في `trusted_device_approval_requests`.
   - البصمة من جهاز غير معتمد تتحول إلى مراجعة ولا تُعتمد تلقائيًا.

2. **QR متغير داخل الفرع**
   - يمكن للـ HR إنشاء كود QR صالح لفترة قصيرة.
   - الموظف يمسح الكود أو يدخله عند تسجيل البصمة.
   - عدم وجود QR أو كود غير صالح يرفع Risk Score ويحوّل البصمة للمراجعة.

3. **Anti-GPS Spoofing**
   - يتم تقييم دقة GPS، عمر القراءة، السرعة، والسياق الآمن.
   - العلامات مثل `GPS_ACCURACY_VERY_WEAK` أو `GPS_SPEED_SUSPICIOUS` ترفع الخطر.

4. **إقرار سياسة الحضور**
   - الموظف يقر بأن البصمة يجب أن تكون شخصية ومن جهازه المعتمد.
   - يتم حفظ الإقرار في `attendance_policy_acknowledgements`.

5. **مركز مكافحة التلاعب**
   - View باسم `attendance_risk_center` لعرض الحركات المشبوهة.
   - View باسم `attendance_monthly_risk_report` للتقرير الشهري.

6. **حضور احتياطي**
   - عند فشل Passkey أو الكاميرا أو GPS، يتم تسجيل طلب حضور احتياطي يحتاج مراجعة HR بدل سقوط الحالة بالكامل.

## ملفات SQL الجديدة

- `053_trusted_device_approval.sql`
- `054_attendance_branch_qr_challenge.sql`
- `055_attendance_anti_spoofing_risk.sql`
- `056_attendance_risk_center.sql`

شغّلها بعد 051 و052 أو استخدم:

```sql
\i patches/053_trusted_device_approval.sql
\i patches/054_attendance_branch_qr_challenge.sql
\i patches/055_attendance_anti_spoofing_risk.sql
\i patches/056_attendance_risk_center.sql
```

## اختبار عملي

1. موظف يسجل من جهازه المعتمد.
2. نفس الجهاز يحاول تسجيل موظف آخر.
3. موظف يسجل بدون QR الفرع.
4. موظف يسجل من GPS بدقة ضعيفة جدًا.
5. HR يراجع الحالة من مركز المخاطر ويعتمد أو يرفض.
