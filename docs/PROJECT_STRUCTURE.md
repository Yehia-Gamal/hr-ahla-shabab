# هيكل المشروع بعد فصل لوحة الإدارة وتطبيق الموظفين

```text
hr_supabase/
├── index.html
├── admin-login.html
├── admin/
│   └── index.html
├── employee/
│   └── index.html
├── shared/
│   ├── css/
│   │   ├── styles.css
│   │   └── employee.css
│   ├── js/
│   │   ├── app-admin.js
│   │   ├── employee-app.js
│   │   ├── api.js
│   │   ├── supabase-api.js
│   │   ├── supabase-config.js
│   │   ├── database.js
│   │   └── register-sw.js
│   ├── images/
│   └── pwa/
├── sw.js
├── supabase/
├── tools/
└── docs/
```

## الهدف

- `index.html` هو مدخل تطبيق الموظفين فقط، ويحوّل إلى `employee/index.html`.
- لوحة الإدارة منفصلة ولا تفتح إلا من `admin-login.html` أو `admin/index.html`.
- تطبيق الموظفين Mobile-first لتسجيل البصمة، قراءة GPS، إرسال الموقع، الإجازات، الشكاوى، الإشعارات، وحساب الموظف.
- لوحة الإدارة Desktop-first للإدارة والصلاحيات والتقارير ومراجعة البصمات والأجهزة والمواقع والشكاوى والإعدادات.
- الواجهتان تستخدمان نفس Supabase ونفس قاعدة البيانات ونفس منظومة الصلاحيات.
