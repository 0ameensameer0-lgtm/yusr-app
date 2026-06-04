// دور المندوب التابع:
// المندوب التابع يظهر له التحضير والحصص فقط، لأن المشرف هو من يجهز المواد والطلاب.

export const MANAGED_DELEGATE_ALLOWED_ROUTES = new Set([
  "attendance",
  "schedule"
]);

export function isManagedDelegateAccount(license = null) {
  return Boolean(license?.accessMode === "delegate" && normalizeCode(license?.parentCode));
}

export function isDelegateRoute(first, tab) {
  if (MANAGED_DELEGATE_ALLOWED_ROUTES.has(first)) return true;
  if (first === "subject" && tab === "attendance") return true;
  return false;
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}
