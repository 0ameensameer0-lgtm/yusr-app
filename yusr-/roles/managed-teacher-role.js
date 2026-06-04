// دور المعلم التابع:
// هذا الملف يحتوي صلاحيات المعلم الذي أنشأ المشرف كوده.
// وجود parentCode يعني أن الحساب تابع لمشرف، ولذلك نطبق عليه هذه الصلاحيات.

export const TEACHER_PERMISSION_SECTIONS = [
  ["subjects", "المواد", "book-open"],
  ["students", "الطلاب", "users"],
  ["attendance", "التحضير", "check-check"],
  ["schedule", "الحصص", "calendar-days"],
  ["grades", "الدرجات", "table-2"],
  ["stats", "الإحصائيات", "bar-chart-3"],
  ["settings", "الإعدادات", "settings"]
];

export const TEACHER_ACTION_PERMISSIONS = [
  ["studentAdd", "إضافة/استيراد الطلاب", "user-plus", "يسمح للمعلم بإضافة أسماء الطلاب أو استيرادها من Excel."],
  ["studentEdit", "تعديل بيانات الطالب", "pencil", "يسمح بتعديل بيانات بسيطة مثل الملاحظة ورقم ولي الأمر."],
  ["studentDelete", "حذف الطلاب نهائيًا", "trash-2", "يفضل إبقاؤها للمشرف فقط، ولا تفعّل إلا عند الحاجة."],
  ["studentRequests", "طلبات إضافة/حذف", "send", "بديل آمن للإضافة أو الحذف؛ يرسل المعلم طلبًا للمشرف."],
  ["subjectManage", "إدارة المواد والفصول", "book-plus", "إضافة أو حذف المواد والفصول من صلاحيات المشرف عادة."],
  ["scheduleManage", "إدارة جدول الحصص", "calendar-plus", "تعديل الجدول الأساسي وربط الحصص بالمواد."],
  ["gradeColumnManage", "إضافة وتعديل أعمدة الدرجات", "columns-3", "إظهار أزرار إضافة العمود وتعديل الأعمدة وترتيبها وحذفها داخل قسم الدرجات."],
  ["gradeBoost", "منح تحسين الدرجات", "sparkles", "السماح باستخدام أداة منح تحسين جماعي للطلاب داخل قسم الدرجات."]
];

export const ALL_TEACHER_PERMISSION_IDS = [
  ...TEACHER_PERMISSION_SECTIONS.map(([id]) => id),
  ...TEACHER_ACTION_PERMISSIONS.map(([id]) => id)
];

export const DEFAULT_MANAGED_TEACHER_PERMISSIONS = {
  subjects: true,
  students: true,
  attendance: true,
  schedule: true,
  grades: true,
  stats: true,
  settings: true,
  studentAdd: false,
  studentEdit: true,
  studentDelete: false,
  studentRequests: true,
  subjectManage: false,
  scheduleManage: false,
  gradeColumnManage: true,
  gradeBoost: true
};

export function isManagedTeacherAccount(license = null) {
  return Boolean(license?.accessMode === "teacher" && normalizeCode(license?.parentCode));
}

export function normalizeTeacherPermissions(value = {}) {
  const source = typeof value === "object" && value ? value : {};
  return Object.fromEntries(ALL_TEACHER_PERMISSION_IDS.map((id) => [
    id,
    Boolean(source[id] ?? DEFAULT_MANAGED_TEACHER_PERMISSIONS[id])
  ]));
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}
