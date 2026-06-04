// نقطة تجميع ملفات الأدوار:
// نستورد من هذا الملف في app.js فقط، حتى تبقى تفاصيل كل دور في ملف مستقل وسهل التعديل.

export {
  isIndependentTeacherAccount,
  teacherHelpGuide
} from "./teacher-role.js?v=260";

export {
  ALL_TEACHER_PERMISSION_IDS,
  DEFAULT_MANAGED_TEACHER_PERMISSIONS,
  TEACHER_ACTION_PERMISSIONS,
  TEACHER_PERMISSION_SECTIONS,
  isManagedTeacherAccount,
  normalizeTeacherPermissions
} from "./managed-teacher-role.js?v=257";

export {
  delegateHelpGuide,
  isIndependentDelegateAccount
} from "./delegate-role.js?v=260";

export {
  MANAGED_DELEGATE_ALLOWED_ROUTES,
  isDelegateRoute,
  isManagedDelegateAccount
} from "./managed-delegate-role.js?v=257";

export {
  isSupervisorAccount,
  managerRoleLabel,
  ownerHelpGuide,
  supervisorHelpGuide
} from "./supervisor-role.js?v=260";

export function isManagedChildAccount(license = null) {
  const mode = license?.accessMode;
  const parentCode = String(license?.parentCode || "").trim();
  return Boolean(["teacher", "delegate"].includes(mode) && parentCode);
}
