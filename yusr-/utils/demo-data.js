// بيانات افتراضية قديمة للتجربة فقط؛ التطبيق الحالي يبدأ غالبًا بدون مواد فعلية للمستخدم الجديد.
export const demoSubjects = [
  { id: "programming", name: "برمجة", code: "CS101", room: "قاعة 204", studentsCount: 60, lastAttendanceAt: new Date().toISOString() },
  { id: "networks", name: "شبكات", code: "NET220", room: "معمل 3", studentsCount: 45, lastAttendanceAt: new Date(Date.now() - 86400000).toISOString() },
  { id: "databases", name: "قواعد البيانات", code: "DB310", room: "قاعة 112", studentsCount: 52, lastAttendanceAt: new Date(Date.now() - 172800000).toISOString() }
];

const names = [
  "أحمد خالد", "سارة محمد", "محمد علي", "فاطمة ناصر", "عبدالله سعيد", "نورة إبراهيم", "عمر حسن", "لينا يوسف",
  "خالد فهد", "ريم صالح", "يوسف مازن", "مها عبدالعزيز", "زياد سامي", "جود طارق", "تركي منصور", "هدى ماجد",
  "راكان وليد", "دانة عادل", "بدر سلطان", "شهد ياسر", "إياد مراد", "ليان حمد", "مالك أنس", "رنا بلال"
];

// توليد طلاب تجريبيين عند الحاجة للاختبار، وليس مصدر الطلاب الحقيقيين في التطبيق.
export function generateStudents(subjectId, count = 36) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${subjectId}-student-${index + 1}`,
    subjectId,
    name: names[index % names.length] + (index >= names.length ? ` ${Math.floor(index / names.length) + 1}` : ""),
    universityId: `44${String(index + 1).padStart(4, "0")}`,
    absenceCount: index % 11,
    lateCount: index % 5,
    notes: ""
  }));
}

// أعمدة الدرجات الافتراضية التي تظهر عند إنشاء مادة جديدة قبل أن يعدلها المعلم.
export const defaultGradeColumns = [
  { id: "oral", label: "الشفوي", max: 10 },
  { id: "homework", label: "الواجب", max: 15 },
  { id: "monthly", label: "الشهري", max: 20 },
  { id: "behavior", label: "السلوك", max: 5 },
  { id: "final", label: "النهائي", max: 50 }
];

// إعدادات التطبيق الافتراضية قبل أن يغيرها المستخدم من صفحة الإعدادات.
export const defaultSettings = {
  attendanceMode: "buttons",
  autoPresent: true,
  absenceLimit: 6,
  notifications: true,
  deviceNotifications: false,
  lessonReminders: true,
  reminderMinutes: 15,
  studentSort: "alpha",
  quickSearch: true,
  theme: "light",
  language: "ar",
  dateCalendar: "gregory",
  accessMode: "teacher",
  readOnlyMode: false,
  teacherName: "م.أمين سمير أمين اليوسفي",
  appPasswordHash: "",
  appPasswordEnabled: false,
  appPasswordAutoLock: false,
  assistantVisible: true,
  assistantSuggestions: true,
  assistantSaveChats: true
};

// حصص تجريبية يمكن استخدامها أثناء التطوير أو عند إنشاء بيانات أولية.
export const defaultSchedule = [
  { id: "lesson-1", day: "الأحد", start: "08:00", end: "08:50", subjectId: "programming", room: "قاعة 204", notes: "محاضرة" },
  { id: "lesson-2", day: "الأحد", start: "10:00", end: "10:50", subjectId: "networks", room: "معمل 3", notes: "تطبيقي" },
  { id: "lesson-3", day: "الثلاثاء", start: "09:00", end: "09:50", subjectId: "databases", room: "قاعة 112", notes: "محاضرة" },
  { id: "lesson-4", day: "الخميس", start: "11:00", end: "11:50", subjectId: "programming", room: "قاعة 204", notes: "مراجعة" }
];
