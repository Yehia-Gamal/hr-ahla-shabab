# Employee avatar import

ارفع محتوى المجلد `employee-avatars/` إلى Supabase Storage داخل bucket باسم `avatars`.

المسار النهائي لكل صورة يجب أن يكون مثل:

`avatars/employee-avatars/emp-executive-director.png`

الواجهة ستحول المسار `employee-avatars/<file>` تلقائيًا إلى رابط عام اعتمادًا على `HR_SUPABASE_CONFIG.url` و `storage.avatarsBucket`.
