# يُسر

تطبيق ويب عربي احترافي لإدارة التحضير والدرجات، مبني بـ HTML وCSS وVanilla JavaScript مع دعم PWA وتهيئة Firebase.

## هيكل المشروع

```text
/
├─ assets/
├─ components/
├─ docs/
├─ pages/
├─ services/
├─ styles/
├─ utils/
├─ index.html
├─ app.js
├─ styles.css
├─ firebase-config.js
├─ manifest.webmanifest
└─ sw.js
```

## التشغيل محليًا

افتح المشروع من خادم محلي حتى تعمل وحدات JavaScript وService Worker:

```bash
node dev-server.mjs
```

ثم افتح `http://127.0.0.1:4173`.

بدائل ممكنة:

```bash
npx serve .
```

أو:

```bash
python -m http.server 4173
```

ثم افتح العنوان الذي يظهر في الطرفية.

## Firebase

1. أنشئ مشروعًا جديدًا في Firebase Console.
2. فعّل Authentication بالبريد وكلمة المرور أو Google.
3. أنشئ Firestore Database في وضع Production.
4. فعّل Storage.
5. انسخ إعدادات Web App إلى `firebase-config.js`.
6. راجع المخطط المقترح في [docs/firebase-schema.md](./docs/firebase-schema.md).

## النشر

يمكن نشر التطبيق على Firebase Hosting:

```bash
npm install -g firebase-tools
firebase login
firebase init hosting
firebase deploy
```

اختر مجلد المشروع الحالي كمجلد النشر، واجعل `index.html` نقطة الدخول.

## PWA وتحويل Android

التطبيق يحتوي على `manifest.webmanifest` و`sw.js` وأيقونات قابلة للتثبيت. لتحويله إلى Android لاحقًا استخدم Capacitor:

```bash
npm init -y
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init "يُسر" "com.yusr.attendance"
npx cap add android
npx cap copy android
npx cap open android
```

بعد النشر النهائي، اربط Capacitor بعنوان الإنتاج أو انسخ ملفات الويب إلى مجلد `www`.
