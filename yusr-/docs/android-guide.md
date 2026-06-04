# تحويل يُسر إلى تطبيق Android

## الخيار الموصى به: Capacitor

1. انشر نسخة الويب أو جهّز مجلد `www`.
2. ثبّت Capacitor.
3. أضف Android.
4. افتح المشروع في Android Studio.
5. اضبط الأيقونات واسم التطبيق واتجاه RTL.
6. فعّل Firebase Android App وأضف ملف `google-services.json`.

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init "يُسر" "com.yusr.attendance"
npx cap add android
npx cap copy android
npx cap open android
```

## إشعارات Push

لإشعارات Firebase Cloud Messaging:

1. فعّل Cloud Messaging من Firebase.
2. أضف إعدادات FCM للويب.
3. أنشئ `firebase-messaging-sw.js`.
4. في Android، اربط Firebase SDK عبر Android Studio.

## فحص الجودة قبل النشر

- اختبار Offline بعد أول تحميل.
- اختبار التحضير بالسحب على جهاز حقيقي.
- اختبار الجداول الكبيرة 500+ طالب.
- اختبار التصدير باللغة العربية.
- اختبار الوضع الداكن والفاتح.
