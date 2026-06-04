// دور المندوب المستقل:
// المندوب المستقل ليس تابعًا لمشرف، لذلك يستطيع إعداد جهاته ومواده داخل حسابه.
// المندوب التابع له ملف مستقل في managed-delegate-role.js.

export function isIndependentDelegateAccount(license = null) {
  return Boolean(license?.accessMode === "delegate" && !normalizeCode(license?.parentCode));
}

export function delegateHelpGuide(license = null) {
  const managed = Boolean(license?.parentCode);
  return {
    title: "مساعدة حساب المندوب",
    badge: managed ? "مندوب تابع" : "مندوب مستقل",
    icon: "clipboard-check",
    heading: "التحضير السريع للحصص",
    summary: managed
      ? "المندوب التابع يستخدم المواد والحصص التي يربطها المشرف بحسابه، ويتركز عمله على التحضير فقط."
      : "المندوب المستقل يستطيع إعداد جهاته ومواده وطلابه، ثم استخدام التحضير والكشف بشكل طبيعي.",
    items: [
      ...(managed ? [] : [
        {
          icon: "building-2",
          title: "الجهات والمواد",
          text: "أضف جهة تعليمية من قسم الحصص أولًا، ثم أضف المواد والطلاب داخل كل مادة حتى يظهر التحضير والكشف بصورة صحيحة."
        }
      ]),
      {
        icon: "calendar-days",
        title: "الحصص",
        text: managed
          ? "الحصص تأتي من المشرف. إذا تغير جدول المشرف فستنعكس الحصص على حسابك بعد التحديث."
          : "راجع يوم الحصة ووقتها قبل التحضير حتى يرتبط السجل بالحصة الصحيحة."
      },
      {
        icon: "check-check",
        title: "التحضير",
        text: "اختر اليوم والحصة، ثم حدد حاضر أو غائب أو متأخر واحفظ التحضير."
      },
      {
        icon: "users-round",
        title: "الطلاب",
        text: managed
          ? "تظهر لك قائمة الطلاب المرتبطة بالمادة التي جهزها المشرف."
          : "يمكنك إضافة الطلاب أو استيرادهم من Excel إذا كان الحساب مستقلًا."
      },
      {
        icon: "search",
        title: "البحث عن طالب",
        text: "استخدم البحث السريع للوصول للطالب مباشرة، خصوصًا في الشعب الكبيرة."
      },
      {
        icon: "calendar-clock",
        title: "السنة الدراسية",
        text: "إذا كان حسابك مستقلًا يمكنك تنظيم بياناتك حسب السنة الدراسية من الإعدادات. أما الحساب التابع فيعتمد على بيانات المشرف."
      },
      ...(managed ? [
        {
          icon: "user-check",
          title: "المواد المرتبطة",
          text: "إذا كان الحساب تابعًا لمشرف فستظهر المواد والحصص التي ربطها المشرف فقط. عند عدم ظهور مادة تواصل مع المشرف."
        }
      ] : [])
    ]
  };
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}
