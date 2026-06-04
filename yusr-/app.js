import { createStore } from "./services/store.js?v=263";
import { FirebaseService } from "./services/firebase-service.js";
import { SyncService } from "./services/sync-service.js?v=258";
import { NotificationService } from "./services/notification-service.js?v=122";
import { SmartAssistantService } from "./services/assistant-service.js?v=22";
import { exportReportPdf } from "./services/export-service.js?v=127";
import { Toast } from "./components/toast.js?v=35";
import { Modal } from "./components/modal.js?v=41";
import { HomePage } from "./pages/home.js?v=258";
import { SubjectPage } from "./pages/subject.js?v=262";
import { SettingsPage } from "./pages/settings.js?v=254";
import { AdminPage } from "./pages/admin.js?v=253";
import { SchedulePage } from "./pages/schedule.js?v=257";
import { LicenseService } from "./services/license-service.js?v=262";
import { renderIcons, setPageTitle, qs } from "./utils/dom.js?v=53";
import { i18n } from "./utils/i18n.js";
import { hashText } from "./utils/security.js?v=194";
import {
  ALL_TEACHER_PERMISSION_IDS,
  TEACHER_ACTION_PERMISSIONS,
  TEACHER_PERMISSION_SECTIONS,
  delegateHelpGuide,
  isDelegateRoute,
  isManagedChildAccount,
  isManagedDelegateAccount,
  isManagedTeacherAccount,
  managerRoleLabel,
  normalizeTeacherPermissions,
  ownerHelpGuide,
  supervisorHelpGuide,
  teacherHelpGuide
} from "./roles/index.js?v=260";

const app = {
  // الحالة العامة للتطبيق: المادة المفتوحة، الصفحة الحالية، وخدمات التطبيق المشتركة.
  state: {
    activeSubjectId: null,
    currentRoute: "home",
    installPrompt: null
  },
  services: {},
  pages: {}
};

const APP_UNLOCK_KEY = "yusr-app-unlocked-v1";
const MANAGER_PINNED_ITEMS_KEY = "yusr-manager-pinned-items-v1";
const DISMISSED_STUDENT_REQUEST_ALERTS_KEY = "yusr-dismissed-student-request-alerts-v1";
let permissionRefreshInFlight = false;
let managerRefreshTimer = null;
let notificationBadgeTimer = null;
let behaviorActiveTab = "stats";
const managerPinnedItems = new Map();
const managedAccountSections = new Map();
const behaviorFilters = { institutionId: "", subjectId: "", studentId: "", query: "" };

const BEHAVIOR_DEGREES = [
  { value: 1, label: "الدرجة الأولى", points: 1, tone: "present", examples: ["مخالفة الزي", "العبث في الاصطفاف", "تعطيل سير الحصة"] },
  { value: 2, label: "الدرجة الثانية", points: 2, tone: "late", examples: ["الغش في الواجبات", "إثارة الفوضى", "الهروب من الحصة"] },
  { value: 3, label: "الدرجة الثالثة", points: 3, tone: "late", examples: ["الشجار", "إتلاف ممتلكات الزملاء", "إحضار مواد خطرة دون استخدامها"] },
  { value: 4, label: "الدرجة الرابعة", points: 10, tone: "absent", examples: ["التدخين", "الهروب من المدرسة", "التنمر", "العبث بتجهيزات المدرسة"] },
  { value: 5, label: "الدرجة الخامسة", points: 15, tone: "absent", examples: ["إتلاف التجهيزات", "التهديد", "التزوير", "حيازة أدوات خطرة"] },
  { value: 6, label: "الدرجة السادسة", points: 20, tone: "absent", examples: ["الاعتداء على منسوبي المدرسة", "الابتزاز أو النشر المسيء"] }
];

const BEHAVIOR_ACTIONS = [
  "تنبيه وتوجيه",
  "تعهد خطي",
  "إشعار ولي الأمر",
  "دعوة ولي الأمر",
  "إحالة للمرشد الطلابي",
  "إحالة للجنة التوجيه والإرشاد",
  "حسم درجات السلوك",
  "إصلاح التلف أو إحضار بديل",
  "ضبط الجهاز أو المادة المخالفة",
  "رفع للإدارة المختصة"
];

async function bootstrap() {
  // إنشاء الخدمات الأساسية مرة واحدة ثم تمريرها للصفحات بدل تكرارها داخل كل صفحة.
  app.services.toast = new Toast(qs("#toast-root"));
  app.services.modal = new Modal(qs("#modal-root"));
  app.services.firebase = new FirebaseService();
  app.services.license = new LicenseService();
  app.services.license.recordSiteView(location.hash || "#/activate");
  app.services.store = await createStore(app.services.firebase, app.services.license);
  app.services.sync = new SyncService(app.services.store, app.services.firebase, app.services.toast, app.services.license);
  app.services.notifications = new NotificationService(app.services.store, app.services.toast);
  app.services.assistant = new SmartAssistantService(app);

  // الصفحات تستخدم نفس كائن التطبيق للوصول إلى البيانات والإشعارات والتراخيص والنوافذ.
  app.pages.home = new HomePage(app);
  app.pages.subject = new SubjectPage(app);
  app.pages.settings = new SettingsPage(app);
  app.pages.admin = new AdminPage(app);
  app.pages.schedule = new SchedulePage(app);

  bindShellEvents();
  updateTeacherChip();
  await app.services.sync.start();
  app.services.notifications.start();
  app.services.assistant.mount();
  route();
  renderIcons();
  document.body.classList.add("is-ready");
  registerServiceWorker();
}

function bindShellEvents() {
  // التطبيق يعمل بنظام hash routing مثل #/home حتى يعمل كملف ثابت وكتطبيق PWA.
  window.addEventListener("hashchange", () => route());
  document.querySelectorAll('a[href^="#/"]').forEach((link) => {
    link.addEventListener("click", () => {
      const target = link.getAttribute("href");
      if (target === location.hash) setTimeout(() => route(), 0);
    });
  });
  document.addEventListener("teacher-profile-updated", () => updateTeacherChip());
  window.addEventListener("managed-assignment-updated", () => {
    updateTeacherChip();
    route();
  });
  document.addEventListener("yusr-access-mode-updated", (event) => {
    const accessMode = event.detail?.accessMode || app.services.license.getActiveLicense()?.accessMode || "teacher";
    applyAccessMode(accessMode);
    qs("#app-shell").classList.toggle("read-only-mode", accessMode === "readonly");
    route();
  });
  document.addEventListener("visibilitychange", () => {
    handleAutoLockOnExit();
    // عند الرجوع للتطبيق نراجع الصلاحية لأن المشرف قد يغيرها من جهاز آخر.
    if (!document.hidden) refreshCurrentLicensePermissions();
  });
  window.addEventListener("pagehide", () => handleAutoLockOnExit(true));
  window.addEventListener("focus", () => refreshCurrentLicensePermissions());
  setInterval(() => {
    if (!document.hidden) refreshCurrentLicensePermissions();
  }, 60000);

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    app.state.installPrompt = event;
    qs("#install-button").hidden = false;
  });

  qs("#install-button").addEventListener("click", async () => {
    if (!app.state.installPrompt) return;
    app.state.installPrompt.prompt();
    await app.state.installPrompt.userChoice;
    app.state.installPrompt = null;
    qs("#install-button").hidden = true;
  });

  qs("#menu-button").addEventListener("click", () => {
    qs("#app-shell").classList.toggle("sidebar-open");
  });

  qs("#theme-button").addEventListener("click", async () => {
    const settings = app.services.store.getSettings();
    const next = settings.theme === "dark" ? "light" : "dark";
    await app.services.store.updateSettings({ theme: next });
    applyTheme(next);
    app.services.toast.show(next === "dark" ? "تم تفعيل الوضع الداكن" : "تم تفعيل الوضع الفاتح", "success");
  });

  qs("#notify-button").addEventListener("click", async () => {
    const { alerts, reviewedRequestAlerts } = await collectNotificationAlerts();
    app.services.modal.open({
      title: "الإشعارات الذكية",
      body: alerts.length
        ? `
          <div class="notification-modal-tools">
            <span>${alerts.length} إشعار</span>
            <button class="icon-button clear-alerts-button" id="clear-all-alerts" type="button" title="مسح كل الإشعارات"><i data-lucide="trash-2"></i></button>
          </div>
          <div class="stack">${alerts.map((alert) => `<div class="alert-row ${alert.type}"><strong>${alert.title}</strong><span>${alert.message}</span></div>`).join("")}</div>
        `
        : `<div class="empty-state compact"><i data-lucide="bell-check"></i><h3>لا توجد تنبيهات حاليًا</h3><p>كل شيء تحت السيطرة.</p></div>`,
      actions: [
        ...(reviewedRequestAlerts.length ? [{ label: "مسح نتائج الطلبات", action: () => {
          dismissStudentRequestAlerts(reviewedRequestAlerts.map((alert) => alert.id));
          return true;
        }}] : []),
        { label: "إغلاق", variant: "primary", action: "close" }
      ]
    });
    qs("#clear-all-alerts")?.addEventListener("click", () => {
      dismissNotificationAlerts(alerts.map(alertKey));
      dismissStudentRequestAlerts(reviewedRequestAlerts.map((alert) => alert.id));
      app.services.modal.close?.();
      app.services.toast.show("تم مسح الإشعارات الحالية", "success");
      scheduleNotificationBadgeUpdate(0);
    });
    renderIcons();
  });
  ["store-updated", "managed-assignment-updated", "yusr-access-mode-updated"].forEach((eventName) => {
    window.addEventListener(eventName, () => scheduleNotificationBadgeUpdate(400));
  });
  window.addEventListener("focus", () => scheduleNotificationBadgeUpdate(700));
  setInterval(() => scheduleNotificationBadgeUpdate(0), 30000);
  scheduleNotificationBadgeUpdate(1200);

  qs("#topbar-help").addEventListener("click", () => openHelpGuide());

  qs("#auth-button").addEventListener("click", () => {
    const settings = app.services.store.getSettings();
    app.services.modal.open({
      title: "حساب المعلم",
      body: `
        <form class="form-grid" id="profile-form">
          <label>الاسم<input name="teacherName" value="${escapeAttribute(settings.teacherName || "")}" required /></label>
          <p class="muted">هذه البيانات تظهر داخل التطبيق باسم المعلم.</p>
        </form>
      `,
      actions: [
        { label: "إغلاق", action: "close" },
        { label: "حفظ", variant: "primary", action: async (root) => {
          const form = root.querySelector("#profile-form");
          if (!form.reportValidity()) return false;
          const data = Object.fromEntries(new FormData(form));
          await app.services.license.updateActiveOwnerName(data.teacherName);
          await app.services.store.updateSettings(data);
          updateTeacherChip();
          app.services.toast.show("تم حفظ بيانات المعلم", "success");
          return true;
        }}
      ]
    });
  });

  qs("#global-search").addEventListener("input", (event) => {
    window.dispatchEvent(new CustomEvent("global-search", { detail: event.target.value.trim() }));
  });
  qs("#global-search").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      openGlobalSearch(event.target.value.trim());
    }
  });

  qs("#fab-button").addEventListener("click", () => {
    if (app.state.currentRoute === "settings") return qs("#view .settings-save")?.click();
    if (app.state.currentRoute === "schedule") return app.pages.schedule.openScheduleModal();
    if (app.state.activeSubjectId) return app.pages.subject.openStudentModal();
    app.pages.home.openSubjectModal();
  });
}

async function collectNotificationAlerts() {
  const reviewedRequestAlerts = childStudentRequestReviewAlerts();
  const renewalAlerts = await renewalPaymentAlerts();
  const dismissedAlerts = dismissedNotificationAlertIds();
  const managerAlerts = await managerRequestAlerts();
  const alerts = [...renewalAlerts, ...licenseExpiryAlerts(), ...app.services.store.getSmartAlerts(), ...managerAlerts, ...reviewedRequestAlerts]
    .filter((alert) => !dismissedAlerts.has(alertKey(alert)));
  return { alerts, reviewedRequestAlerts };
}

function scheduleNotificationBadgeUpdate(delay = 500) {
  clearTimeout(notificationBadgeTimer);
  notificationBadgeTimer = setTimeout(() => updateNotificationBadge(), delay);
}

async function updateNotificationBadge() {
  const badge = qs("#notification-count");
  const button = qs("#notify-button");
  if (!badge || !button || !app.services?.store || !app.services?.license) return;
  const active = app.services.license.getActiveLicense?.();
  if (!active || app.state.currentRoute === "admin") {
    badge.hidden = true;
    button.classList.remove("has-notifications");
    return;
  }
  const { alerts } = await collectNotificationAlerts().catch(() => ({ alerts: [] }));
  const count = alerts.length;
  badge.hidden = count <= 0;
  badge.textContent = count > 99 ? "99+" : String(count);
  button.classList.toggle("has-notifications", count > 0);
}

function licenseExpiryAlerts() {
  const license = app.services.license.getActiveLicense?.();
  if (!license?.expiresAt) return [];
  const expiresAt = new Date(license.expiresAt);
  const remaining = expiresAt.getTime() - Date.now();
  if (remaining <= 0 || remaining > 86400000) return [];
  return [{
    id: "license-expiry",
    type: "warning",
    title: "اقترب انتهاء الاشتراك",
    message: "يتبقى أقل من يوم على انتهاء الاشتراك. من الإعدادات يمكنك طلب إعادة تفعيل الكود قبل إغلاق التطبيق."
  }];
}

async function renewalPaymentAlerts() {
  const license = app.services.license.getActiveLicense?.();
  if (!license?.code) return [];
  const request = await app.services.license.getActivationRequestByCode?.(license.code).catch(() => null);
  if (request?.status !== "unpaid") return [];
  const expiresAt = request.license?.expires_at || request.license?.expiresAt || license.expiresAt;
  const closeDate = expiresAt ? new Intl.DateTimeFormat("ar-SA", { dateStyle: "medium" }).format(new Date(expiresAt)) : "نهاية الاشتراك الحالي";
  return [{
    id: "renewal-payment-unpaid",
    type: "warning",
    title: "لم يتم تجديد الحساب",
    message: `سبب عدم التجديد: لم يتم تأكيد الدفع. سيبقى الحساب فعالًا حتى ${closeDate} ثم سيتم إغلاقه.`
  }];
}

async function managerRequestAlerts() {
  const license = app.services.license.getActiveLicense?.();
  if (license?.accessMode !== "admin") return [];
  const localRows = app.services.store.getSubjects(null, license).flatMap((subject) =>
    app.services.store.getStudentRequests(subject.id)
      .filter((request) => !["approved", "rejected"].includes(request.status))
      .map((request) => ({
        id: request.id,
        type: "warning",
        title: "طلب معلم بانتظار المراجعة",
        message: `${studentRequestTypeLabel(request.type)}: ${request.studentName || "طالب"} - ${subject.name}`
      }))
  );
  const localManagedRows = Object.values(app.services.license.listLocalManagedAccountData?.() || {});
  const managedRows = await Promise.resolve(app.services.license.listManagedAccountDataForParent?.(license.code) || localManagedRows)
    .catch(() => localManagedRows) || [];
  const syncedRows = managedRows
    .filter((row) => normalizeCodeInput(row.parent_code) === normalizeCodeInput(license.code))
    .flatMap((row) => {
      const owner = row.owner_name || "حساب تابع";
      const subjects = new Map((row.data?.subjects || []).map((subject) => [subject.id, subject.name]));
      return (row.data?.studentRequests || [])
        .filter((request) => !["approved", "rejected"].includes(request.status))
        .map((request) => ({
          id: `${row.code}:${request.id}`,
          type: "warning",
          title: "طلب معلم بانتظار المراجعة",
          message: `${owner} طلب ${studentRequestTypeLabel(request.type)}: ${request.studentName || "طالب"} - ${subjects.get(request.subjectId) || "مادة غير محددة"}`
        }));
    });
  return uniqueAlertsById([...syncedRows, ...localRows]).slice(0, 8);
}

function childStudentRequestReviewAlerts() {
  const license = app.services.license.getActiveLicense?.();
  if (!isManagedChildAccount(license)) return [];
  const dismissed = dismissedStudentRequestAlertIds();
  const subjects = app.services.store.getSubjects(null, license);
  const rows = subjects.flatMap((subject) =>
    app.services.store.getStudentRequests(subject.id)
      .filter((request) => ["approved", "rejected"].includes(request.status))
      .filter((request) => request.reviewedAt || request.updatedAt)
      .map((request) => {
        const id = request.id || `${subject.id}:${request.studentName}:${request.createdAt}`;
        return {
          id,
          type: request.status === "approved" ? "success" : "warning",
          title: request.status === "approved" ? "تم تنفيذ طلبك" : "تم رفض طلبك",
          message: `${studentRequestTypeLabel(request.type)} - ${request.studentName || "طالب"} في ${subject.name}${request.resultMessage ? `: ${request.resultMessage}` : ""}`,
          date: request.reviewedAt || request.updatedAt || request.createdAt
        };
      })
  );
  return rows
    .filter((alert) => !dismissed.has(alert.id))
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, 6);
}

function dismissedStudentRequestAlertIds() {
  try {
    const ids = JSON.parse(localStorage.getItem(DISMISSED_STUDENT_REQUEST_ALERTS_KEY) || "[]");
    return new Set(Array.isArray(ids) ? ids : []);
  } catch {
    return new Set();
  }
}

function dismissStudentRequestAlerts(ids = []) {
  const dismissed = dismissedStudentRequestAlertIds();
  ids.forEach((id) => dismissed.add(id));
  localStorage.setItem(DISMISSED_STUDENT_REQUEST_ALERTS_KEY, JSON.stringify([...dismissed].slice(-200)));
}

function dismissedNotificationAlertIds() {
  try {
    const ids = JSON.parse(localStorage.getItem("yusr-dismissed-notification-alerts-v1") || "[]");
    return new Set(Array.isArray(ids) ? ids : []);
  } catch {
    return new Set();
  }
}

function dismissNotificationAlerts(ids = []) {
  const dismissed = dismissedNotificationAlertIds();
  ids.filter(Boolean).forEach((id) => dismissed.add(id));
  localStorage.setItem("yusr-dismissed-notification-alerts-v1", JSON.stringify([...dismissed].slice(-400)));
}

function alertKey(alert = {}) {
  return alert.id || `${alert.title || ""}:${alert.message || ""}`;
}

function uniqueAlertsById(alerts = []) {
  const map = new Map();
  alerts.forEach((alert) => {
    const key = alert.id || `${alert.title}:${alert.message}`;
    if (!map.has(key)) map.set(key, alert);
  });
  return [...map.values()];
}

function updateTeacherChip() {
  const settings = app.services.store?.getSettings?.() || {};
  const name = settings.teacherName || "المعلم";
  const chip = qs("#auth-button");
  if (!chip) return;
  chip.innerHTML = `<span class="avatar">${escapeHtml(name.trim().charAt(0) || "?")}</span><span>${escapeHtml(name)}</span>`;
  chip.title = name;
}

async function route() {
  clearManagerAutoRefresh();
  // route هو مركز التنقل: يقرر الصفحة، ويتأكد من التفعيل، ويطبق صلاحيات الحساب.
  const hash = location.hash.replace("#", "") || "/";
  const [, first, id, tab] = hash.split("/");
  if (!first) {
    location.hash = app.services.license.isActive() ? "#/home" : "#/activate";
    return;
  }

  const routeName = first || "home";
  app.state.currentRoute = routeName;
  document.body.classList.toggle("admin-route-mode", first === "admin");
  const hasAccess = await safeCheckAccess();
  qs("#app-shell").classList.toggle("admin-mode", first === "admin");
  qs("#app-shell").classList.toggle("license-mode", first !== "admin" && (!hasAccess || !first || first === "activate"));
  qs("#app-shell").classList.toggle("settings-mode", first === "settings" || (first === "subject" && tab === "settings"));
  qs("#app-shell").classList.toggle("hide-fab-mode", first === "subject" && (tab || "students") !== "students");

  if (first === "admin") {
    document.querySelectorAll(".nav-link, .bottom-link").forEach((link) => link.classList.remove("active"));
    qs("#app-shell").classList.remove("sidebar-open");
    app.services.assistant?.refresh?.();
    await app.pages.admin.render();
    return;
  }

  if (!first || first === "activate") {
    if (hasAccess) {
      location.hash = "#/home";
      return;
    }
    document.querySelectorAll(".nav-link, .bottom-link").forEach((link) => link.classList.remove("active"));
    qs("#app-shell").classList.remove("sidebar-open");
    renderActivation();
    return;
  }

  if (!hasAccess) {
    // إذا لم يوجد تفعيل صالح نعيد المستخدم دائمًا إلى صفحة التفعيل.
    document.querySelectorAll(".nav-link, .bottom-link").forEach((link) => link.classList.remove("active"));
    qs("#app-shell").classList.remove("sidebar-open");
    renderActivation();
    return;
  }

  const activeForStore = app.services.license.getActiveLicense();
  if (activeForStore?.code) {
    await app.services.store.switchAccount(activeForStore.code, {
      ...(activeForStore.ownerName ? { teacherName: activeForStore.ownerName } : {}),
      accessMode: activeForStore.accessMode || "teacher",
      readOnlyMode: activeForStore.accessMode === "readonly"
    });
    if (activeForStore.accessMode === "admin") {
      app.services.sync.scheduleManagedAccountSync(0);
    } else if (isManagedChildAccount(activeForStore)) {
      await app.services.sync.syncManagedAccountData();
    }
  }
  const settings = app.services.store.getSettings();
  refreshCurrentLicensePermissions();
  const activeLicense = app.services.license.getActiveLicense();
  const accessMode = activeLicense?.accessMode || settings.accessMode || (settings.readOnlyMode ? "readonly" : "teacher");
  applyAccessMode(accessMode);
  const appLocked = isAppLocked(settings);
  document.body.classList.toggle("app-password-locked", appLocked);
  if (appLocked) {
    app.services.assistant.refresh();
    renderPasswordLock();
    return;
  }
  // حماية الصلاحية: قسم المشرف لا يفتح إلا لحساب مشرف حتى لو كتب المستخدم الرابط يدويًا.
  if (first === "manager" && accessMode !== "admin") {
    location.hash = "#/home";
    return;
  }
  if (accessMode === "delegate" && isManagedChildAccount(activeLicense) && !isDelegateRoute(first, tab)) {
    // المندوب التابع للمشرف محدد بالتحضير والحصص فقط. المندوب المستقل يعمل كحساب كامل داخل بياناته.
    location.hash = app.state.activeSubjectId ? `#/subject/${app.state.activeSubjectId}/attendance` : "#/attendance";
    return;
  }
  if (!isRouteAllowedByPermissions(first, tab, activeLicense)) {
    // المعلم التابع قد يمنع عنه المشرف بعض الأقسام من صفحة قسم المشرف.
    app.services.toast.show("هذا القسم غير مفعّل لهذا الحساب", "warning");
    location.hash = firstAllowedHash(activeLicense);
    return;
  }

  document.querySelectorAll(".nav-link").forEach((link) => {
    const sideRoute = routeName === "subject" ? (tab === "stats" ? "analytics" : tab === "sheet" ? "attendance" : tab || "students") : (routeName || "home");
    link.classList.toggle("active", link.dataset.route === sideRoute);
  });
  document.querySelectorAll(".bottom-link").forEach((link) => {
    const mobileRoute = routeName === "subject" ? (["attendance", "sheet", "grades"].includes(tab) ? (tab === "sheet" ? "attendance" : tab) : "subjects") : (routeName || "home");
    link.classList.toggle("active", link.dataset.route === mobileRoute);
  });
  qs("#app-shell").classList.remove("sidebar-open");

  applyTheme(settings.theme);
  i18n.setLanguage(settings.language || "ar");
  const academicReadOnly = Boolean(app.services.store.getCurrentAcademicYear?.()?.archived);
  qs("#app-shell").classList.toggle("read-only-mode", Boolean(settings.readOnlyMode || academicReadOnly));

  if (first === "subject" && id) {
    app.state.activeSubjectId = id;
    app.pages.subject.render(id, tab || "students");
    return;
  }

  if (["students", "attendance", "grades", "analytics"].includes(first)) {
    const subjects = app.services.store.getSubjects(undefined, activeLicense);
    const subject = subjects.find((item) => item.id === app.state.activeSubjectId);
    if (subject) {
      location.hash = `#/subject/${subject.id}/${first === "analytics" ? "stats" : first}`;
      return;
    }
    renderSubjectShortcutPicker(first, subjects);
    return;
  }

  if (first === "schedule") {
    app.pages.schedule.render();
  } else if (first === "manager") {
    if (normalizeManagerHubSection(id)) {
      await renderManagerPage([], id);
      return;
    }
    if (id) {
      await renderManagedAccountPage(id, tab || "");
      return;
    }
    await renderManagerPage();
  } else if (first === "settings") {
    setPageTitle("الإعدادات");
    app.pages.settings.render();
  } else if (first === "subjects") {
    setPageTitle("المواد");
    app.pages.home.render("subjects");
  } else {
    setPageTitle("الرئيسية");
    app.pages.home.render("home");
  }
}

function isAppLocked(settings = app.services.store.getSettings()) {
  return Boolean(settings.appPasswordEnabled && settings.appPasswordHash && sessionStorage.getItem(APP_UNLOCK_KEY) !== settings.appPasswordHash);
}

function handleAutoLockOnExit(force = false) {
  const settings = app.services.store?.getSettings?.();
  if (!settings?.appPasswordEnabled || !settings?.appPasswordAutoLock) return;
  if (force || document.hidden) sessionStorage.removeItem(APP_UNLOCK_KEY);
}

function renderPasswordLock() {
  applyTheme(app.services.store.getSettings().theme);
  setPageTitle("قفل التطبيق");
  qs("#app-shell").classList.add("license-mode");
  document.querySelectorAll(".nav-link, .bottom-link").forEach((link) => link.classList.remove("active"));
  qs("#view").innerHTML = `
    <section class="license-page">
      <article class="license-card glass-panel app-lock-card">
        <img class="license-logo" src="./assets/yusr-logo.png" alt="" />
        <span class="eyebrow">حماية يُسر</span>
        <h2>أدخل كلمة السر</h2>
        <p class="muted">تم تفعيل قفل التطبيق لهذا الحساب. أدخل كلمة السر للمتابعة.</p>
        <form class="form-grid" id="app-lock-form">
          <label>كلمة السر<input class="license-input" name="password" type="password" autocomplete="current-password" required autofocus /></label>
          <button class="primary-button"><i data-lucide="lock-open"></i>فتح التطبيق</button>
        </form>
        <button class="ghost-button forgot-password-button" id="forgot-app-password" type="button"><i data-lucide="help-circle"></i>نسيت كلمة السر؟</button>
      </article>
    </section>
  `;
  qs("#app-lock-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = new FormData(event.target).get("password");
    const settings = app.services.store.getSettings();
    if (await hashText(password) !== settings.appPasswordHash) {
      app.services.toast.show("كلمة السر غير صحيحة", "error");
      return;
    }
    sessionStorage.setItem(APP_UNLOCK_KEY, settings.appPasswordHash);
    document.body.classList.remove("app-password-locked");
    app.services.toast.show("تم فتح التطبيق", "success");
    await route();
    app.services.assistant?.refresh?.();
  });
  qs("#forgot-app-password")?.addEventListener("click", () => openForgotPasswordRecovery());
  renderIcons();
  app.services.assistant?.refresh?.();
}

function openForgotPasswordRecovery() {
  const active = app.services.license.getActiveLicense();
  const settings = app.services.store.getSettings();
  const roleLabel = activeRoleLabel(active?.accessMode);
  const hasSecurityAnswer = Boolean(settings.appPasswordSecurityQuestion && settings.appPasswordSecurityAnswerHash);
  app.services.modal.open({
    title: "استعادة الدخول",
    body: `
      <form class="form-grid" id="recover-password-form">
        <p class="muted">لإلغاء كلمة السر لحساب ${roleLabel}، أدخل كود التفعيل الحالي أو أجب على سؤال الأمان إن كان محفوظًا. لن يتم حذف المواد أو الطلاب أو الدرجات.</p>
        <label>كود التفعيل<input class="field" name="code" placeholder="YUSR-..." /></label>
        ${hasSecurityAnswer ? `
          <label>${securityQuestionLabel(settings.appPasswordSecurityQuestion)}
            <input class="field" name="securityAnswer" autocomplete="off" placeholder="اكتب إجابة سؤال الأمان" />
          </label>
        ` : ""}
        <p class="muted">${active?.accessMode === "admin" ? "إذا كنت مشرفًا ولا تملك الكود أو إجابة الأمان، اطلب الكود من صاحب التطبيق." : "إذا لم يكن الكود أو إجابة الأمان متوفرًا، تواصل مع المشرف أو صاحب التطبيق لإعادة التفعيل."}</p>
      </form>
    `,
    actions: [
      { label: "إلغاء", action: "close" },
      { label: "إلغاء كلمة السر", variant: "primary", action: async (root) => {
        const form = root.querySelector("#recover-password-form");
        if (!form.reportValidity()) return false;
        const data = Object.fromEntries(new FormData(form));
        const codeMatches = data.code && normalizeCodeInput(data.code) === normalizeCodeInput(active?.code);
        const securityAnswerHash = hasSecurityAnswer && data.securityAnswer
          ? await hashText(normalizeSecurityAnswer(data.securityAnswer))
          : "";
        const securityMatches = Boolean(securityAnswerHash && securityAnswerHash === settings.appPasswordSecurityAnswerHash);
        if (!codeMatches && !securityMatches) {
          app.services.toast.show("كود التفعيل أو إجابة سؤال الأمان غير صحيحة", "error");
          return false;
        }
        await app.services.store.updateSettings({
          appPasswordEnabled: false,
          appPasswordHash: "",
          appPasswordAutoLock: false,
          appPasswordSecurityQuestion: "",
          appPasswordSecurityAnswerHash: ""
        });
        sessionStorage.removeItem(APP_UNLOCK_KEY);
        app.services.toast.show("تم إلغاء كلمة السر. يمكنك الدخول الآن", "success");
        route();
        return true;
      }}
    ]
  });
}

function normalizeCodeInput(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeSecurityAnswer(value = "") {
  return String(value)
    .trim()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function securityQuestionLabel(value = "") {
  const labels = {
    imam: "ما اسم الإمام الذي تستمتع بسماع تلاوته؟",
    mosque: "ما اسم أول مسجد كنت تصلي فيه بانتظام؟",
    surah: "ما اسم السورة المفضلة لديك؟"
  };
  return labels[value] || "سؤال الأمان";
}

function activeRoleLabel(value) {
  if (value === "admin") return "المشرف";
  if (value === "delegate") return "المندوب";
  return "المعلم";
}

window.lockYusrApp = function lockYusrApp() {
  sessionStorage.removeItem(APP_UNLOCK_KEY);
  location.hash = "#/home";
  route();
};

function normalizeManagerHubSection(value = "") {
  return ["manage", "stats", "behavior", "reports"].includes(value) ? value : "";
}

function managerHubHtml(activeSection = "", pendingRequestsCount = 0) {
  const sections = [
    {
      id: "manage",
      icon: "users-round",
      title: "إدارة المعلمين والمندوبين",
      text: "إنشاء الأكواد التابعة وتعديل صلاحيات الحسابات."
    },
    {
      id: "stats",
      icon: "bar-chart-3",
      title: "إحصائيات المشرف",
      text: "حضور وأداء الحسابات التابعة وتقاريرها."
    },
    {
      id: "behavior",
      icon: "shield-alert",
      title: "السلوك والمواظبة",
      text: "مخالفات الطلاب وسجل المتابعة والطباعة."
    },
    {
      id: "reports",
      icon: "file-bar-chart-2",
      title: "التقارير",
      text: "تقارير الحضور والأداء والتحصيل والسلوك والحصص مع PDF."
    }
  ];
  return `
    <section class="manager-hub ${activeSection ? "compact" : ""}">
      ${sections.map((section) => `
        <a class="manager-hub-card ${activeSection === section.id ? "active" : ""}" href="#/manager/${section.id}">
          ${section.id === "manage" && pendingRequestsCount ? `<span class="floating-badge">${pendingRequestsCount}</span>` : ""}
          <i data-lucide="${section.icon}"></i>
          <strong>${section.title}</strong>
          <span>${section.text}</span>
        </a>
      `).join("")}
    </section>
  `;
}

function bindManagerHubNavigation() {
  document.querySelectorAll(".manager-hub-card").forEach((card) => {
    card.addEventListener("click", (event) => {
      const target = card.getAttribute("href");
      if (!target) return;
      event.preventDefault();
      location.hash = target;
    });
  });
}

async function renderManagerPage(optimisticItems = [], sectionOverride = "") {
  const settings = app.services.store.getSettings();
  const activeLicense = app.services.license.getActiveLicense();
  const isManager = activeLicense?.accessMode === "admin";
  if (!isManager) {
    setPageTitle("قسم المشرف");
    qs("#view").innerHTML = `
      <section class="panel">
        <div class="empty-state compact">
          <i data-lucide="shield-alert"></i>
          <h3>قسم المشرف غير مفعّل</h3>
          <p>هذا القسم يظهر فقط لحساب المشرف. إذا كان حسابك مشرفًا، انتظر لحظة ثم حدّث الصفحة أو تأكد من اعتماد الطلب كمشرف من لوحة الأدمن.</p>
        </div>
      </section>
    `;
    bindManagerHubNavigation();
    renderIcons();
    return;
  }
  const limit = app.services.license.managedCodeLimit(activeLicense?.code);
  const parentCode = activeLicense?.code;
  const savedItems = await app.services.license.listManagedCodesWithUsage(parentCode);
  const pinnedItems = getPinnedManagerItems(parentCode);
  let items = mergeManagerItems(parentCode, [...pinnedItems, ...optimisticItems, ...savedItems]);
  const managedDataRows = await app.services.license.listManagedAccountDataForParent(parentCode).catch(() => []);
  items = enrichManagerUsageFromSync(items, managedDataRows);
  const requestSummary = managerRequestsSummary(items, managedDataRows);
  const requestEntryByCode = new Map((requestSummary.entries || []).map((entry) => [normalizeCodeInput(entry.item.code), entry]));
  const pendingRequestsCount = requestSummary.totalPending;
  const activeManagerSection = normalizeManagerHubSection(sectionOverride);
  if (items.length) {
    pinManagerItems(parentCode, items);
    app.services.license.saveLocalManagedCodesForParent(parentCode, items);
  }
  // صفحة المشرف تعرض الأكواد التابعة فقط، ويفتح كل حساب تابع في صفحة مستقلة.
  setPageTitle("قسم المشرف");
  if (!activeManagerSection) {
    qs("#view").innerHTML = `
      <section class="panel manager-entry-panel">
        <div class="panel-header">
          <div>
            <span class="eyebrow">قسم المشرف</span>
            <h2>اختر القسم المطلوب</h2>
          </div>
          ${pendingRequestsCount ? `<span class="status-badge status-late">${pendingRequestsCount} طلب جديد</span>` : ""}
        </div>
        ${managerHubHtml("", pendingRequestsCount)}
      </section>
    `;
    renderIcons();
    return;
  }
  if (activeManagerSection === "stats") {
    qs("#view").innerHTML = `
      <section class="panel managed-teachers-panel">
        <div class="panel-header">
          <div>
            <span class="eyebrow">قسم المشرف</span>
            <h2>إحصائيات المشرف</h2>
          </div>
          <a class="ghost-button" href="#/manager"><i data-lucide="layout-grid"></i>الأقسام</a>
        </div>
        ${supervisorStatsHtml(items, managedDataRows)}
      </section>
    `;
    startManagerAutoRefresh(() => renderManagerPage([], "stats"), 9000);
    renderIcons();
    return;
  }
  if (activeManagerSection === "behavior") {
    qs("#view").innerHTML = `
      <section class="panel managed-teachers-panel">
        <div class="panel-header">
          <div>
            <span class="eyebrow">قسم المشرف</span>
            <h2>السلوك والمواظبة</h2>
          </div>
          <a class="ghost-button" href="#/manager"><i data-lucide="layout-grid"></i>الأقسام</a>
        </div>
        ${behaviorViolationsPanelHtml()}
      </section>
    `;
    bindBehaviorViolationsPanel();
    renderIcons();
    return;
  }
  if (activeManagerSection === "reports") {
    qs("#view").innerHTML = `
      <section class="panel managed-teachers-panel">
        <div class="panel-header">
          <div>
            <span class="eyebrow">قسم المشرف</span>
            <h2>التقارير</h2>
          </div>
          <a class="ghost-button" href="#/manager"><i data-lucide="layout-grid"></i>الأقسام</a>
        </div>
        ${managerReportsPanelHtml(items, managedDataRows)}
      </section>
    `;
    bindManagerReports(items, managedDataRows);
    renderIcons();
    return;
  }
  qs("#view").innerHTML = `
    <section class="panel managed-teachers-panel">
      <div class="panel-header">
        <div>
          <span class="eyebrow">قسم المشرف</span>
          <h2>إدارة المعلمين والمندوبين</h2>
        </div>
        <a class="ghost-button" href="#/manager"><i data-lucide="layout-grid"></i>الأقسام</a>
        <span class="status-badge status-present">${items.length} / ${limit}</span>
      </div>
      ${pendingRequestsCount ? `
        <div class="smart-note compact-note manager-request-alert">
          <i data-lucide="bell-ring"></i>
          <span>لديك ${pendingRequestsCount} ${pendingRequestsCount === 1 ? "طلب معلم جديد" : "طلبات معلمين جديدة"} بانتظار المراجعة.</span>
          <button class="status-button" type="button" data-manager-focus="teacher-requests">عرض الطلبات</button>
        </div>
      ` : ""}
      <form class="form-grid managed-code-form" id="managed-code-form">
        <label>اسم المعلم أو المندوب<input class="field" name="ownerName" placeholder="مثال: أحمد محمد" required /></label>
        <label>الصلاحية
          <select class="select-field" name="accessMode">
            <option value="teacher">معلم</option>
            <option value="delegate">مندوب تحضير</option>
          </select>
        </label>
        <label>مدة الكود<input class="field" name="duration" type="number" min="1" value="1" /></label>
        <label>نوع المدة
          <select class="select-field" name="durationUnit">
            <option value="months">شهور</option>
            <option value="weeks">أسابيع</option>
            <option value="days">أيام</option>
          </select>
        </label>
        <button class="primary-button"><i data-lucide="key-round"></i>إنشاء كود تابع</button>
      </form>
      <div class="manager-table-tools">
        <label class="search-input manager-table-search">
          <input id="manager-teacher-search" type="search" placeholder="بحث باسم المعلم أو المندوب" />
          <i data-lucide="search"></i>
        </label>
        <span class="muted">البحث يفلتر الأسماء الموجودة في جدول الحسابات التابع مباشرة.</span>
      </div>
      <div class="manager-mobile-list" id="manager-mobile-accounts-list">
        ${items.length ? items.map((item, index) => {
          const entry = requestEntryByCode.get(normalizeCodeInput(item.code)) || { pendingCount: 0 };
          return `
            <article class="manager-code-card manager-mobile-account-card" data-manager-account="${escapeAttribute(`${managedAccountName(item)} ${item.code}`)}">
              <span class="rank">${index + 1}</span>
              <div>
                <strong>${escapeHtml(managedAccountName(item))}</strong>
                <span class="muted">${managerRoleLabel(item.accessMode)}</span>
                ${entry.pendingCount ? `<span class="status-badge status-late">${entry.pendingCount} جديد</span>` : ""}
                <code>${escapeHtml(item.code)}</code>
                <small>${item.deviceId ? "مستخدم" : "لم يستخدم بعد"} · ينتهي في ${new Intl.DateTimeFormat("ar-SA", { dateStyle: "medium" }).format(new Date(item.expiresAt))}</small>
              </div>
              <div class="admin-actions manager-mobile-actions">
                <button class="status-button" data-manager-copy="${item.code}">نسخ</button>
                <button class="status-button" data-manager-edit="${item.code}">تعديل</button>
                ${item.accessMode === "teacher" ? `<button class="status-button" data-teacher-permissions="${item.code}">صلاحيات</button>` : ""}
                <button class="status-button" data-teacher-data="${item.code}">فتح الصفحة</button>
              </div>
            </article>
          `;
        }).join("") : `<div class="empty-state compact"><i data-lucide="key-round"></i><h3>لا توجد أكواد تابعة بعد</h3><p>أنشئ كودًا للمعلم أو المندوب وسيظهر هنا مباشرة.</p></div>`}
      </div>
      <div class="table-shell admin-table manager-table-shell" id="manager-accounts-table">
        <table>
          <thead><tr><th>#</th><th>الاسم</th><th>الكود</th><th>الصلاحية</th><th>الطلبات</th><th>الحالة</th><th>ينتهي في</th><th>نسخ</th><th>تعديل</th><th>الصلاحيات</th><th>بيانات المعلم</th></tr></thead>
          <tbody>${items.length ? items.map((item, index) => {
            const entry = requestEntryByCode.get(normalizeCodeInput(item.code)) || { pendingCount: 0 };
            return `
            <tr data-manager-account="${escapeAttribute(`${managedAccountName(item)} ${item.code}`)}">
              <td>${index + 1}</td>
              <td><strong>${escapeHtml(managedAccountName(item))}</strong></td>
              <td><code>${escapeHtml(item.code)}</code></td>
              <td>${managerRoleLabel(item.accessMode)}</td>
              <td>${entry.pendingCount ? `<span class="status-badge status-late">${entry.pendingCount} جديد</span>` : `<span class="status-badge">لا يوجد</span>`}</td>
              <td>${item.deviceId ? `<span class="status-badge status-present">مستخدم</span>` : `<span class="status-badge status-late">لم يستخدم</span>`}</td>
              <td>${new Intl.DateTimeFormat("ar-SA", { dateStyle: "medium" }).format(new Date(item.expiresAt))}</td>
              <td><button class="status-button" data-manager-copy="${item.code}">نسخ</button></td>
              <td><button class="status-button" data-manager-edit="${item.code}">تعديل</button></td>
              <td>${item.accessMode === "teacher" ? `<button class="status-button" data-teacher-permissions="${item.code}">صلاحيات المعلم</button>` : "تحضير فقط"}</td>
              <td><button class="status-button" data-teacher-data="${item.code}">فتح الصفحة</button></td>
            </tr>
          `;
          }).join("") : `<tr><td colspan="11">لا توجد أكواد تابعة بعد</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;
  qs("#managed-code-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = { ...Object.fromEntries(new FormData(event.target)), parentCode };
    const submitButton = event.submitter || event.target.querySelector("button");
    const resetLoading = setButtonLoading(submitButton, "جاري إنشاء الكود...");
    try {
      const result = await app.services.license.createManagedCode(data);
      app.services.toast.show(result.message, result.ok ? "success" : "error");
      if (result.ok) {
        if (result.item) {
          pinManagerItems(parentCode, [result.item, ...items]);
          app.services.license.upsertLocalGeneratedCodes([result.item]);
          app.services.license.saveLocalManagedCodesForParent(parentCode, [result.item, ...items]);
          await renderManagerPage([result.item, ...items], "manage");
        } else {
          await renderManagerPage(items, "manage");
        }
      }
    } finally {
      resetLoading();
    }
  });
  bindBehaviorViolationsPanel();
  document.querySelectorAll("[data-manager-focus]").forEach((button) => {
    button.addEventListener("click", () => {
      const targets = {
        codes: qs("#managed-code-form"),
        table: qs("#manager-mobile-accounts-list") || qs("#manager-accounts-table"),
        "teacher-requests": qs("#manager-mobile-accounts-list") || qs("#manager-accounts-table")
      };
      const target = targets[button.dataset.managerFocus] || qs("#manager-mobile-accounts-list") || qs("#manager-accounts-table");
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  document.querySelectorAll("[data-manager-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      await copyText(button.dataset.managerCopy);
      app.services.toast.show("تم نسخ الكود", "success");
    });
  });
  document.querySelectorAll("[data-teacher-permissions]").forEach((button) => {
    button.addEventListener("click", () => openTeacherPermissionsModal(items.find((entry) => entry.code === button.dataset.teacherPermissions)));
  });
  document.querySelectorAll("[data-manager-edit]").forEach((button) => {
    button.addEventListener("click", () => openManagedCodeEditModal(items.find((entry) => entry.code === button.dataset.managerEdit)));
  });
  document.querySelectorAll("[data-teacher-data]").forEach((button) => {
    button.addEventListener("click", () => {
      location.hash = `#/manager/${encodeURIComponent(button.dataset.teacherData)}`;
    });
  });
  qs("#manager-teacher-search")?.addEventListener("input", (event) => {
    const term = String(event.target.value || "").trim().toLocaleLowerCase("ar");
    document.querySelectorAll("[data-manager-account]").forEach((element) => {
      const value = String(element.dataset.managerAccount || "").toLocaleLowerCase("ar");
      element.hidden = Boolean(term && !value.includes(term));
    });
  });
  startManagerAutoRefresh(() => renderManagerPage([], "manage"), 9000);
  renderIcons();
}

function behaviorViolationsPanelHtml() {
  const rows = app.services.store.getBehaviorViolations();
  const contexts = behaviorStudentOptions();
  const followUp = rows.filter((row) => row.status !== "تمت المعالجة").length;
  return `
    <section class="panel behavior-panel" id="behavior-panel">
      <div class="panel-header">
        <div>
          <span class="eyebrow">السلوك والمواظبة</span>
          <h3>مخالفات الطلاب</h3>
          <p class="muted">سجل المخالفة يرتبط بالجهة والمادة والمعلم والطالب حتى تصبح المتابعة والطباعة واضحة للمشرف.</p>
        </div>
        <span class="status-badge status-late">${followUp} بحاجة متابعة</span>
      </div>
      <div class="behavior-tabbar">
        ${behaviorTabButton("stats", "الإحصائيات", "bar-chart-3")}
        ${behaviorTabButton("form", "تسجيل مخالفة", "shield-alert")}
        ${behaviorTabButton("record", "سجل المخالفات", "list-checks")}
      </div>
      <div class="behavior-tab-content">
        ${behaviorActiveTab === "form" ? behaviorFormHtml(contexts) : behaviorActiveTab === "record" ? behaviorRecordHtml(rows) : behaviorStatsHtml(rows)}
      </div>
    </section>
  `;
}

function behaviorTabButton(id, label, icon) {
  return `<button class="status-button behavior-tab ${behaviorActiveTab === id ? "active" : ""}" data-behavior-tab="${id}"><i data-lucide="${icon}"></i>${label}</button>`;
}

function behaviorFormHtml(contexts) {
  const institutions = uniqueBy(contexts.map((item) => ({ id: item.institutionId, name: item.institutionName })).filter((item) => item.id), "id");
  const subjects = uniqueBy(contexts.map((item) => ({
    key: behaviorContextKey(item),
    id: item.subjectId,
    name: item.subjectName,
    institutionId: item.institutionId,
    teacherName: item.teacherName,
    teacherCode: item.teacherCode
  })), "key");
  const degreeOptions = BEHAVIOR_DEGREES.map((degree) => `<option value="${degree.value}">${degree.label} · ${degree.points} درجة</option>`).join("");
  const examples = BEHAVIOR_DEGREES.flatMap((degree) => degree.examples);
  if (!contexts.length) {
    return `<div class="smart-note compact-note"><i data-lucide="info"></i><span>أضف جهة ومادة وطلاب أولًا حتى تستطيع تسجيل المخالفات.</span></div>`;
  }
  return `
    <form class="behavior-form behavior-form-wide" id="behavior-form">
      <label>الجهة
        <select class="select-field" id="behavior-institution" name="institutionId" required>
          <option value="" disabled selected hidden>اختر الجهة</option>
          ${institutions.map((item) => `<option value="${escapeAttribute(item.id)}">${escapeHtml(item.name)}</option>`).join("")}
        </select>
      </label>
      <label id="behavior-subject-label" hidden>المادة والمعلم
        <select class="select-field" id="behavior-subject" name="subjectKey" required>
          <option value="" disabled selected hidden>اختر المادة</option>
          ${subjects.map((item) => `<option value="${escapeAttribute(item.key)}" data-subject-id="${escapeAttribute(item.id)}" data-institution="${escapeAttribute(item.institutionId)}" data-teacher="${escapeAttribute(item.teacherName)}">${escapeHtml(item.name)} · ${escapeHtml(item.teacherName || "بدون معلم")}</option>`).join("")}
        </select>
        <input type="hidden" id="behavior-subject-id" name="subjectId" />
      </label>
      <label id="behavior-teacher-label" hidden>المعلم<input class="field" id="behavior-teacher-display" value="" placeholder="يتحدد من المادة" disabled /></label>
      <label id="behavior-student-label" hidden>الطالب
        <input class="field" id="behavior-student-input" name="studentLabel" list="behavior-student-list" placeholder="اكتب اسم الطالب أو رقم ولي الأمر..." autocomplete="off" required />
        <input type="hidden" id="behavior-student" name="studentId" />
        <datalist id="behavior-student-list">
          ${contexts.map((item) => {
            const label = `${item.studentName}${item.guardianPhone ? ` · ${item.guardianPhone}` : ""}`;
            return `<option value="${escapeAttribute(label)}" data-subject="${escapeAttribute(item.subjectId)}" data-student="${escapeAttribute(item.studentId)}" data-search="${escapeAttribute(`${item.studentName} ${item.guardianPhone || ""}`)}"></option>`;
          }).join("")}
        </datalist>
      </label>
      <label>التاريخ<input class="field" name="date" type="date" value="${new Date().toISOString().slice(0, 10)}" required /></label>
      <label>درجة المخالفة<select class="select-field" name="degree" id="behavior-degree">${degreeOptions}</select></label>
      <label>نوع المخالفة<input class="field" name="violationType" list="behavior-examples" placeholder="مثال: تعطيل سير الحصة" required /></label>
      <datalist id="behavior-examples">${examples.map((item) => `<option value="${escapeAttribute(item)}"></option>`).join("")}</datalist>
      <label>الإجراء المتخذ
        <select class="select-field" name="action" id="behavior-action">${BEHAVIOR_ACTIONS.map((action) => `<option value="${escapeAttribute(action)}">${escapeHtml(action)}</option>`).join("")}</select>
      </label>
      <label>العقوبة أو الإجراء التفصيلي<input class="field" name="penalty" list="behavior-penalties" placeholder="مثال: استدعاء ولي الأمر وتوقيع تعهد" /></label>
      <datalist id="behavior-penalties">${BEHAVIOR_ACTIONS.map((action) => `<option value="${escapeAttribute(action)}"></option>`).join("")}</datalist>
      <label>درجات الحسم<input class="field" name="points" id="behavior-points" type="number" min="0" value="${BEHAVIOR_DEGREES[0].points}" /></label>
      <label class="behavior-deduction-toggle">
        <input type="checkbox" name="deductBehaviorGrade" value="1" />
        <span>
          <strong>ربط الحسم بدرجة السلوك</strong>
          <small>إذا كان للطالب عمود باسم السلوك، سيتم خصم درجات الحسم منه تلقائيًا.</small>
        </span>
      </label>
      <label>الحالة
        <select class="select-field" name="status">
          <option value="متابعة">متابعة</option>
          <option value="تمت المعالجة">تمت المعالجة</option>
        </select>
      </label>
      <label class="behavior-note-field">ملاحظة<textarea class="field" name="note" rows="2" placeholder="تفاصيل مختصرة أو توصية المرشد"></textarea></label>
      <button class="primary-button behavior-submit"><i data-lucide="shield-alert"></i>تسجيل مخالفة</button>
    </form>
  `;
}

function behaviorStatsHtml(rows) {
  const totalPoints = rows.reduce((sum, row) => sum + Number(row.points || 0), 0);
  const followUp = rows.filter((row) => row.status !== "تمت المعالجة").length;
  const highRisk = rows.filter((row) => Number(row.degree || 0) >= 4).length;
  const studentMap = new Map();
  rows.forEach((row) => {
    const key = row.studentId || row.studentName;
    const current = studentMap.get(key) || { name: row.studentName, count: 0, points: 0 };
    current.count += 1;
    current.points += Number(row.points || 0);
    studentMap.set(key, current);
  });
  const top = [...studentMap.values()].sort((a, b) => b.count - a.count || b.points - a.points).slice(0, 8);
  return `
    <div class="behavior-summary-grid">
      <article><span>إجمالي المخالفات</span><strong>${rows.length}</strong></article>
      <article><span>درجات محسومة</span><strong>${totalPoints}</strong></article>
      <article><span>مخالفات عالية</span><strong>${highRisk}</strong></article>
      <article><span>بحاجة متابعة</span><strong>${followUp}</strong></article>
    </div>
    <div class="behavior-stats-list">
      <h4>أكثر الطلاب تسجيلًا للمخالفات</h4>
      ${top.length ? top.map((item, index) => `<div class="ranking-row"><span class="rank">${index + 1}</span><strong>${escapeHtml(item.name)}</strong><span class="status-badge status-late">${item.count} مخالفة · ${item.points} درجة</span></div>`).join("") : behaviorEmptyHtml()}
    </div>
  `;
}

function behaviorRecordHtml(rows) {
  const filtered = behaviorFilteredRows(rows);
  const institutions = uniqueBy(rows.map((row) => ({ id: row.institutionId, name: row.institutionName })).filter((item) => item.id), "id");
  const subjects = uniqueBy(rows.map((row) => ({ id: row.subjectId, name: row.subjectName, institutionId: row.institutionId, teacherName: row.teacherName })).filter((item) => item.id), "id");
  const students = uniqueBy(filtered.map((row) => ({ id: row.studentId || row.studentName, name: row.studentName, phone: row.guardianPhone })).filter((item) => item.name), "id");
  return `
    <div class="behavior-record-tools">
      <select class="select-field" id="behavior-record-institution">
        <option value="">كل الجهات</option>
        ${institutions.map((item) => `<option value="${escapeAttribute(item.id)}" ${behaviorFilters.institutionId === item.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
      </select>
      <select class="select-field" id="behavior-record-subject">
        <option value="">كل المواد</option>
        ${subjects.map((item) => `<option value="${escapeAttribute(item.id)}" data-institution="${escapeAttribute(item.institutionId || "")}" ${behaviorFilters.subjectId === item.id ? "selected" : ""}>${escapeHtml(item.name)} · ${escapeHtml(item.teacherName || "بدون معلم")}</option>`).join("")}
      </select>
      <select class="select-field" id="behavior-record-student">
        <option value="">كل الطلاب</option>
        ${students.map((item) => `<option value="${escapeAttribute(item.id)}" ${behaviorFilters.studentId === item.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
      </select>
      <label class="search-input manager-table-search">
        <input id="behavior-search" type="search" placeholder="بحث باسم الطالب أو المادة..." value="${escapeAttribute(behaviorFilters.query)}" />
        <i data-lucide="search"></i>
      </label>
    </div>
    <div class="behavior-mobile-list">
      ${filtered.length ? filtered.map((row, index) => behaviorViolationCard(row, index)).join("") : behaviorEmptyHtml()}
    </div>
    <div class="table-shell behavior-table-shell">
      <table>
        <thead><tr><th>#</th><th>الطالب</th><th>الجهة</th><th>المادة</th><th>المعلم</th><th>الدرجة</th><th>المخالفة</th><th>الإجراء/العقوبة</th><th>الحسم</th><th>خصم السلوك</th><th>إجراءات</th></tr></thead>
        <tbody>${filtered.length ? filtered.map((row, index) => behaviorViolationRow(row, index)).join("") : `<tr><td colspan="11">لا توجد مخالفات مسجلة</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function behaviorFilteredRows(rows) {
  const term = String(behaviorFilters.query || "").trim().toLocaleLowerCase("ar");
  return rows.filter((row) => {
    if (behaviorFilters.institutionId && row.institutionId !== behaviorFilters.institutionId) return false;
    if (behaviorFilters.subjectId && row.subjectId !== behaviorFilters.subjectId) return false;
    if (behaviorFilters.studentId && (row.studentId || row.studentName) !== behaviorFilters.studentId) return false;
    if (!term) return true;
    return `${row.studentName} ${row.subjectName} ${row.teacherName} ${row.institutionName} ${row.violationType} ${row.action} ${row.penalty || ""}`.toLocaleLowerCase("ar").includes(term);
  }).sort(compareBehaviorRowsByStudent);
}

function compareBehaviorRowsByStudent(first, second) {
  const nameCompare = String(first.studentName || "").localeCompare(String(second.studentName || ""), "ar", { sensitivity: "base" });
  if (nameCompare) return nameCompare;
  const dateCompare = String(first.date || "").localeCompare(String(second.date || ""));
  if (dateCompare) return dateCompare;
  return String(first.subjectName || "").localeCompare(String(second.subjectName || ""), "ar", { sensitivity: "base" });
}

function behaviorStudentOptions() {
  const license = app.services.license.getActiveLicense();
  const institutions = new Map(app.services.store.getInstitutions(license).map((item) => [item.id, item]));
  return app.services.store.getSubjects(null, license).flatMap((subject) => {
    const institution = institutions.get(subject.institutionId);
    const teacherName = subject.assignedTeacherName || app.services.store.getSettings().teacherName || "بدون معلم";
    return app.services.store.getStudents(subject.id).map((student) => ({
      institutionId: subject.institutionId || "",
      institutionName: institution?.name || "بدون جهة",
      subjectId: subject.id,
      subjectName: subject.name,
      teacherCode: subject.assignedTeacherCode || "",
      teacherName,
      studentId: student.id,
      studentName: student.name,
      guardianPhone: student.guardianPhone || ""
    }));
  });
}

function behaviorContextKey(item) {
  return [item.institutionId || "", item.subjectId || "", item.teacherCode || item.teacherName || ""].join("__");
}

function behaviorDegreeMeta(value) {
  return BEHAVIOR_DEGREES.find((item) => item.value === Number(value)) || BEHAVIOR_DEGREES[0];
}

function behaviorViolationRow(row, index) {
  const degree = behaviorDegreeMeta(row.degree);
  const parentActions = behaviorParentActions(row);
  return `
    <tr data-behavior-row="${escapeAttribute(behaviorHaystack(row))}">
      <td>${index + 1}</td>
      <td class="behavior-student-cell">
        <strong>${escapeHtml(row.studentName)}</strong>
        <small>${escapeHtml(row.date || "")}</small>
        <button class="status-button behavior-inline-pdf" data-behavior-pdf-student="${escapeAttribute(row.studentId || row.studentName)}"><i data-lucide="file-text"></i>PDF</button>
      </td>
      <td>${escapeHtml(row.institutionName || "-")}</td>
      <td>${escapeHtml(row.subjectName || "-")}</td>
      <td>${escapeHtml(row.teacherName || "-")}</td>
      <td><span class="status-badge status-${degree.tone}">${degree.label}</span></td>
      <td>${escapeHtml(row.violationType)}</td>
      <td><strong>${escapeHtml(row.action || "-")}</strong>${row.penalty ? `<br><small>${escapeHtml(row.penalty)}</small>` : ""}</td>
      <td>${Number(row.points || 0)}</td>
      <td>${row.deductBehaviorGrade ? `${Number(row.behaviorDeductionApplied || 0)}${row.behaviorGradeColumn ? `<br><small>${escapeHtml(row.behaviorGradeColumn)}</small>` : ""}` : "غير مرتبط"}</td>
      <td>
        <div class="behavior-row-actions">
          <div class="behavior-contact-actions">${parentActions}</div>
          <div class="behavior-manage-actions">
            <button class="status-button" data-behavior-toggle="${row.id}">${row.status === "تمت المعالجة" ? "إرجاع" : "معالجة"}</button>
            <button class="status-button danger-text" data-behavior-delete="${row.id}">حذف</button>
          </div>
        </div>
      </td>
    </tr>
  `;
}

function behaviorViolationCard(row, index) {
  const degree = behaviorDegreeMeta(row.degree);
  return `
    <article class="behavior-card" data-behavior-row="${escapeAttribute(behaviorHaystack(row))}">
      <div class="behavior-card-head">
        <span class="rank">${index + 1}</span>
        <div class="behavior-card-title">
          <strong>${escapeHtml(row.studentName)}</strong>
          <small>${escapeHtml(row.institutionName || "-")} · ${escapeHtml(row.subjectName || "-")} · ${escapeHtml(row.teacherName || "-")}</small>
        </div>
        <span class="status-badge status-${degree.tone}">${degree.label}</span>
      </div>
      <p>${escapeHtml(row.violationType)}</p>
      <div class="behavior-card-meta"><span>${escapeHtml(row.action)}</span><span>${Number(row.points || 0)} درجة</span><span>${escapeHtml(row.status)}</span></div>
      ${row.deductBehaviorGrade ? `<small class="muted">خصم السلوك: ${Number(row.behaviorDeductionApplied || 0)} درجة${row.behaviorGradeColumn ? ` من ${escapeHtml(row.behaviorGradeColumn)}` : ""}</small>` : ""}
      ${row.penalty ? `<small class="muted">العقوبة: ${escapeHtml(row.penalty)}</small>` : ""}
      ${row.note ? `<small class="muted">${escapeHtml(row.note)}</small>` : ""}
      <div class="behavior-card-actions">
        <div class="behavior-contact-actions">${behaviorParentActions(row)}</div>
        <div class="behavior-manage-actions">
        <button class="status-button" data-behavior-pdf-student="${escapeAttribute(row.studentId || row.studentName)}">PDF</button>
        <button class="status-button" data-behavior-toggle="${row.id}">${row.status === "تمت المعالجة" ? "إرجاع للمتابعة" : "تمت المعالجة"}</button>
        <button class="status-button danger-text" data-behavior-delete="${row.id}">حذف</button>
        </div>
      </div>
    </article>
  `;
}

function behaviorParentActions(row) {
  const phone = behaviorGuardianPhone(row);
  if (!phone) return `<span class="status-button disabled-button behavior-contact-empty" title="لا يوجد رقم ولي أمر"><i data-lucide="phone-off"></i>لا يوجد رقم ولي أمر</span>`;
  const text = `تنبيه بخصوص الطالب ${row.studentName}: تم تسجيل مخالفة (${row.violationType}) في مادة ${row.subjectName}. الإجراء: ${row.action}${row.penalty ? ` - ${row.penalty}` : ""}.`;
  return `
    <a class="status-button behavior-contact-button" href="tel:${phone}"><i data-lucide="phone"></i>اتصال</a>
    <a class="status-button behavior-contact-button" href="sms:${phone}?body=${encodeURIComponent(text)}"><i data-lucide="message-square"></i>SMS</a>
    <a class="status-button behavior-contact-button" target="_blank" rel="noopener" href="https://wa.me/${phone.replace(/^\+/, "")}?text=${encodeURIComponent(text)}"><i data-lucide="send"></i>واتساب</a>
  `;
}

function behaviorGuardianPhone(row) {
  const direct = normalizePhoneForLink(row.guardianPhone);
  if (direct) return direct;
  const sameSubjectStudent = app.services.store.getStudents(row.subjectId || "").find((student) => student.id === row.studentId || student.name === row.studentName);
  if (sameSubjectStudent?.guardianPhone) return normalizePhoneForLink(sameSubjectStudent.guardianPhone);
  const license = app.services.license.getActiveLicense();
  const allStudents = app.services.store.getSubjects(null, license).flatMap((subject) => app.services.store.getStudents(subject.id));
  const currentStudent = allStudents.find((student) => student.id === row.studentId || student.name === row.studentName);
  return normalizePhoneForLink(currentStudent?.guardianPhone || "");
}

function behaviorHaystack(row) {
  return `${row.studentName} ${behaviorGuardianPhone(row)} ${row.institutionName || ""} ${row.subjectName || ""} ${row.teacherName || ""} ${row.violationType} ${row.action} ${row.penalty || ""} ${row.status} ${row.note || ""}`;
}

function behaviorEmptyHtml() {
  return `<div class="empty-state compact"><i data-lucide="shield-alert"></i><h3>لا توجد مخالفات مسجلة</h3><p>سجل المخالفات يساعد المشرف في متابعة السلوك والإجراءات المتخذة.</p></div>`;
}

function bindBehaviorViolationsPanel() {
  document.querySelectorAll("[data-behavior-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      behaviorActiveTab = button.dataset.behaviorTab;
      renderManagerPage([], "behavior");
    });
  });
  bindBehaviorForm();
  bindBehaviorRecordFilters();
  document.querySelectorAll("[data-behavior-toggle]").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = app.services.store.getBehaviorViolations().find((item) => item.id === button.dataset.behaviorToggle);
      if (!row) return;
      const nextStatus = row.status === "تمت المعالجة" ? "متابعة" : "تمت المعالجة";
      await app.services.store.updateBehaviorViolation(row.id, { status: nextStatus });
      app.services.toast.show("تم تحديث حالة المخالفة", "success");
      renderManagerPage([], "behavior");
    });
  });
  document.querySelectorAll("[data-behavior-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const ok = await app.services.modal.confirm({
        title: "حذف المخالفة",
        message: "هل تريد حذف سجل المخالفة؟",
        confirmLabel: "حذف",
        cancelLabel: "إلغاء",
        danger: true
      });
      if (!ok) return;
      await app.services.store.deleteBehaviorViolation(button.dataset.behaviorDelete);
      app.services.toast.show("تم حذف المخالفة", "success");
      renderManagerPage([], "behavior");
    });
  });
  document.querySelectorAll("[data-behavior-pdf-student]").forEach((button) => {
    button.addEventListener("click", () => printBehaviorStudentPdf(button.dataset.behaviorPdfStudent));
  });
}

function bindBehaviorForm() {
  const form = qs("#behavior-form");
  if (!form) return;
  const institution = qs("#behavior-institution");
  const subject = qs("#behavior-subject");
  const subjectIdField = qs("#behavior-subject-id");
  const subjectLabel = qs("#behavior-subject-label");
  const teacherLabel = qs("#behavior-teacher-label");
  const studentLabel = qs("#behavior-student-label");
  const student = qs("#behavior-student");
  const studentInput = qs("#behavior-student-input");
  const studentList = qs("#behavior-student-list");
  const teacher = qs("#behavior-teacher-display");
  const degree = qs("#behavior-degree");
  const points = qs("#behavior-points");
  const contexts = behaviorStudentOptions();
  const subjects = uniqueBy(contexts.map((item) => ({
    key: behaviorContextKey(item),
    id: item.subjectId,
    name: item.subjectName,
    institutionId: item.institutionId,
    teacherName: item.teacherName
  })), "key");
  const renderSubjectOptions = () => {
    const institutionId = institution.value;
    subjectLabel.hidden = !institutionId;
    const visibleSubjects = subjects.filter((item) => item.institutionId === institutionId);
    subject.innerHTML = `<option value="" disabled selected hidden>اختر المادة</option>${visibleSubjects.map((item) => `<option value="${escapeAttribute(item.key)}" data-subject-id="${escapeAttribute(item.id)}" data-teacher="${escapeAttribute(item.teacherName || "")}">${escapeHtml(item.name)} · ${escapeHtml(item.teacherName || "بدون معلم")}</option>`).join("")}`;
  };
  const syncSelectedStudent = () => {
    const selectedOption = [...studentList.options].find((option) => option.value === studentInput.value);
    student.value = selectedOption?.dataset.student || "";
  };
  const renderStudentOptions = () => {
    const subjectKey = subject.value;
    const selectedSubjectOption = subject.selectedOptions[0];
    const subjectId = selectedSubjectOption?.dataset.subjectId || "";
    if (subjectIdField) subjectIdField.value = subjectId;
    teacherLabel.hidden = !subjectKey;
    studentLabel.hidden = !subjectKey;
    const visibleStudents = contexts.filter((item) => behaviorContextKey(item) === subjectKey);
    studentList.innerHTML = visibleStudents.map((item) => {
      const label = `${item.studentName}${item.guardianPhone ? ` · ${item.guardianPhone}` : ""}`;
      return `<option value="${escapeAttribute(label)}" data-student="${escapeAttribute(item.studentId)}"></option>`;
    }).join("");
    syncSelectedStudent();
    teacher.value = selectedSubjectOption?.dataset.teacher || "";
  };
  institution.addEventListener("change", () => {
    renderSubjectOptions();
    studentInput.value = "";
    student.value = "";
    renderStudentOptions();
  });
  subject.addEventListener("change", () => {
    studentInput.value = "";
    student.value = "";
    renderStudentOptions();
  });
  studentInput?.addEventListener("input", syncSelectedStudent);
  degree?.addEventListener("change", () => {
    points.value = behaviorDegreeMeta(degree.value).points;
  });
  renderSubjectOptions();
  renderStudentOptions();
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    syncSelectedStudent();
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form));
    if (!data.studentId) {
      app.services.toast.show("اختر الطالب من نفس خانة الطالب بعد البحث", "error");
      return;
    }
    const context = behaviorStudentOptions().find((item) => behaviorContextKey(item) === data.subjectKey && item.studentId === data.studentId);
    const result = await app.services.store.addBehaviorViolation({
      ...data,
      ...(context || {})
    });
    app.services.toast.show(result.ok ? "تم تسجيل المخالفة" : "تعذر تسجيل المخالفة", result.ok ? "success" : "error");
    if (result.ok) {
      behaviorActiveTab = "record";
      renderManagerPage([], "behavior");
    }
  });
}

function bindBehaviorRecordFilters() {
  const update = () => {
    behaviorFilters.institutionId = qs("#behavior-record-institution")?.value || "";
    behaviorFilters.subjectId = qs("#behavior-record-subject")?.value || "";
    behaviorFilters.studentId = qs("#behavior-record-student")?.value || "";
    behaviorFilters.query = qs("#behavior-search")?.value || "";
    renderManagerPage([], "behavior");
  };
  ["#behavior-record-institution", "#behavior-record-subject", "#behavior-record-student"].forEach((selector) => {
    qs(selector)?.addEventListener("change", update);
  });
  qs("#behavior-search")?.addEventListener("input", (event) => {
    behaviorFilters.query = event.target.value;
    const term = String(behaviorFilters.query || "").trim().toLocaleLowerCase("ar");
    document.querySelectorAll("[data-behavior-row]").forEach((element) => {
      const value = String(element.dataset.behaviorRow || "").toLocaleLowerCase("ar");
      element.hidden = Boolean(term && !value.includes(term));
    });
  });
}

function printBehaviorStudentPdf(studentKey) {
  const rows = app.services.store.getBehaviorViolations().filter((row) => (row.studentId || row.studentName) === studentKey);
  if (!rows.length) return app.services.toast.show("لا توجد مخالفات لهذا الطالب", "warning");
  const studentName = rows[0].studentName || "طالب";
  const html = `
    <section class="stats-report">
      <h2>بيانات الطالب</h2>
      <table class="pdf-tight-table behavior-student-info-table"><tbody>
        <tr><th>الطالب</th><td>${escapeHtml(studentName)}</td><th>رقم ولي الأمر</th><td>${escapeHtml(rows[0].guardianPhone || "-")}</td></tr>
        <tr><th>الجهة</th><td>${escapeHtml(rows[0].institutionName || "-")}</td><th>المعلم</th><td>${escapeHtml(rows[0].teacherName || "-")}</td></tr>
      </tbody></table>
      <h2>سجل المخالفات</h2>
      <table class="pdf-tight-table behavior-pdf-table">
        <colgroup>
          <col class="behavior-col-index" />
          <col class="behavior-col-date" />
          <col class="behavior-col-subject" />
          <col class="behavior-col-degree" />
          <col class="behavior-col-violation" />
          <col class="behavior-col-action" />
          <col class="behavior-col-penalty" />
          <col class="behavior-col-points" />
          <col class="behavior-col-points" />
          <col class="behavior-col-status" />
        </colgroup>
        <thead><tr><th>#</th><th>التاريخ</th><th>المادة</th><th>درجة المخالفة</th><th>المخالفة</th><th>الإجراء</th><th>العقوبة</th><th>الحسم</th><th>خصم السلوك</th><th>الحالة</th></tr></thead>
        <tbody>${rows.map((row, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(row.date || "-")}</td><td>${escapeHtml(row.subjectName || "-")}</td><td>${escapeHtml(behaviorDegreeMeta(row.degree).label)}</td><td>${escapeHtml(row.violationType)}</td><td>${escapeHtml(row.action || "-")}</td><td>${escapeHtml(row.penalty || "-")}</td><td>${Number(row.points || 0)}</td><td>${row.deductBehaviorGrade ? `${Number(row.behaviorDeductionApplied || 0)} من ${escapeHtml(row.behaviorGradeColumn || "السلوك")}` : "غير مرتبط"}</td><td>${escapeHtml(row.status || "-")}</td></tr>`).join("")}</tbody>
      </table>
    </section>
  `;
  exportReportPdf({ name: studentName }, html, "تقرير مخالفات الطالب", { calendar: app.services.store.getSettings().dateCalendar });
}

function uniqueBy(items, key) {
  const map = new Map();
  items.forEach((item) => {
    const value = item?.[key];
    if (value && !map.has(value)) map.set(value, item);
  });
  return [...map.values()];
}

function normalizePhoneForLink(value) {
  return String(value || "").replace(/[^\d+]/g, "");
}

async function renderManagedAccountPage(code, sectionOverride = "") {
  const activeLicense = app.services.license.getActiveLicense();
  if (activeLicense?.accessMode !== "admin") {
    location.hash = "#/home";
    return;
  }
  const decodedCode = decodeURIComponent(code);
  const normalizedPageCode = normalizeCodeInput(decodedCode);
  const items = mergeManagerItems(activeLicense.code, [
    ...getPinnedManagerItems(activeLicense.code),
    ...await app.services.license.listManagedCodesWithUsage(activeLicense.code)
  ]);
  const item = items.find((entry) => normalizeCodeInput(entry.code) === normalizedPageCode);
  if (!item) {
    setPageTitle("حساب تابع");
    qs("#view").innerHTML = `
      <section class="panel">
        <div class="empty-state compact">
          <i data-lucide="search-x"></i>
          <h3>الكود غير موجود</h3>
          <p>ارجع إلى قسم المشرف واختر كودًا من القائمة.</p>
          <a class="primary-button" href="#/manager/manage">العودة لقسم المشرف</a>
        </div>
      </section>
    `;
    renderIcons();
    return;
  }
  const isUsed = Boolean(item.deviceId);
  // نقرأ بيانات الحساب التابعة من المزامنة السحابية إن وجدت.
  const syncedRow = await app.services.license.getManagedAccountData(item.code).catch(() => null);
  const syncedData = syncedRow?.data || null;
  if (syncedRow?.owner_name && !item.ownerName) item.ownerName = syncedRow.owner_name;
  const requestedSection = normalizeManagedSection(sectionOverride);
  let defaultSection = requestedSection || managedAccountSections.get(normalizedPageCode) || (item.accessMode === "delegate" ? "attendance" : "students");
  if (item.accessMode === "delegate" && !["attendance", "sheets", "requests"].includes(defaultSection)) defaultSection = "attendance";
  managedAccountSections.set(normalizedPageCode, defaultSection);
  setPageTitle(managedAccountName(item));
  qs("#view").innerHTML = `
    <section class="panel managed-teachers-panel">
      <div class="panel-header managed-account-header">
        <div>
          <span class="eyebrow">${managerRoleLabel(item.accessMode)}</span>
          <h2>${escapeHtml(managedAccountName(item))}</h2>
        </div>
        <a class="ghost-button" href="#/manager/manage"><i data-lucide="arrow-right"></i>رجوع</a>
      </div>
      <div class="managed-account-overview">
        <div class="license-code-box">${escapeHtml(item.code)}</div>
        <div class="quick-stats managed-account-stats">
          <article class="stat-card"><span>حالة الكود</span><strong>${isUsed ? "مستخدم" : "لم يستخدم"}</strong></article>
          <article class="stat-card"><span>الصلاحية</span><strong>${managerRoleLabel(item.accessMode)}</strong></article>
          <article class="stat-card"><span>ينتهي في</span><strong>${new Intl.DateTimeFormat("ar-SA", { dateStyle: "medium" }).format(new Date(item.expiresAt))}</strong></article>
          <article class="stat-card"><span>آخر مزامنة</span><strong>${syncedRow?.updated_at ? new Intl.DateTimeFormat("ar-SA", { dateStyle: "short", timeStyle: "short" }).format(new Date(syncedRow.updated_at)) : "لا توجد"}</strong></article>
        </div>
      </div>
      ${syncedData ? `
        <div class="smart-note compact-note">
          <i data-lucide="cloud-check"></i>
          <span>تمت مزامنة بيانات هذا الحساب تلقائيًا. اختر القسم المطلوب من الأسفل.</span>
        </div>
      ` : isUsed ? `
        <div class="smart-note compact-note">
          <i data-lucide="info"></i>
          <span>الكود مستخدم، وستظهر بيانات الحساب هنا عند توفر المزامنة السحابية. يمكنك إدارة المواد والطلاب مباشرة من أقسام التطبيق.</span>
        </div>
      ` : `
        <div class="smart-note compact-note warning-note">
          <i data-lucide="info"></i>
          <span>هذا الحساب لم يدخل الكود بعد. أرسل الكود لصاحبه، وبعد التفعيل ستتغير الحالة إلى مستخدم.</span>
        </div>
      `}
      <div class="template-grid managed-section-grid">
        ${managedSectionCards(item, defaultSection, syncedData)}
      </div>
      <div id="managed-section-panel">${managedSectionContent(defaultSection, item, isUsed, syncedData)}</div>
    </section>
  `;
  document.querySelectorAll("[data-managed-section]").forEach((button) => {
    button.addEventListener("click", () => {
      const section = normalizeManagedSection(button.dataset.managedSection) || defaultSection;
      managedAccountSections.set(normalizedPageCode, section);
      history.replaceState(null, "", `#/manager/${encodeURIComponent(item.code)}/${section}`);
      document.querySelectorAll("[data-managed-section]").forEach((card) => card.classList.toggle("active", card === button));
      qs("#managed-section-panel").innerHTML = managedSectionContent(section, item, isUsed, syncedData);
      bindManagedStudentRequestActions(item, syncedData);
      renderIcons();
    });
  });
  bindManagedStudentRequestActions(item, syncedData);
  startManagerAutoRefresh(() => renderManagedAccountPage(code, managedAccountSections.get(normalizedPageCode) || defaultSection), 10000);
  renderIcons();
}

function normalizeManagedSection(section) {
  return ["students", "attendance", "grades", "sheets", "requests"].includes(section) ? section : "";
}

function managedSectionCards(item, active, syncedData = null) {
  const pendingRequests = Array.isArray(syncedData?.studentRequests)
    ? syncedData.studentRequests.filter((request) => studentRequestStatus(request) === "pending").length
    : 0;
  const sections = [
    ["students", "الطلاب", "users", "قائمة الطلاب والملاحظات"],
    ["attendance", "التحضير", "check-check", "سجل الحضور والغياب والتأخير"],
    ["grades", "الدرجات", "table-2", "درجات الطلاب والمجموع"],
    ["sheets", "الكشوفات", "calendar-days", "الكشف الشهري وتقارير PDF"],
    ["requests", "طلبات المعلم", "send", "طلبات الإضافة والحذف"]
  ].filter(([id]) => item.accessMode !== "delegate" || ["attendance", "sheets", "requests"].includes(id));
  return sections.map(([id, title, icon, description]) => `
    <button class="template-card managed-section-card ${id === active ? "active" : ""}" type="button" data-managed-section="${id}">
      <i data-lucide="${icon}"></i>
      <strong>${title}</strong>
      ${id === "requests" && pendingRequests ? `<span class="floating-badge">${pendingRequests}</span>` : ""}
      <span>${description}</span>
    </button>
  `).join("");
}

function managedSectionContent(section, item, isUsed, syncedData = null) {
  const titles = {
    students: ["الطلاب", "users", "قائمة الطلاب الخاصة بهذا الحساب"],
    attendance: ["التحضير", "check-check", "حضور وغياب وتأخير هذا الحساب"],
    grades: ["الدرجات", "table-2", "درجات الطلاب والمجموع"],
    sheets: ["الكشوفات", "calendar-days", "الكشف الشهري والتقارير"],
    requests: ["طلبات المعلم", "send", "طلبات الإضافة والحذف"]
  };
  const [title, icon, subtitle] = titles[section] || titles.students;
  if (syncedData) {
    // عند وجود بيانات متزامنة نعرض الجداول الفعلية بدل رسالة الانتظار.
    return `
      <article class="managed-section-panel">
        <div class="managed-section-title">
          <i data-lucide="${icon}"></i>
          <div>
            <span class="eyebrow">${escapeHtml(subtitle)}</span>
            <h3>${escapeHtml(title)}</h3>
          </div>
        </div>
        ${managedSyncedSection(section, syncedData)}
      </article>
    `;
  }
  const lockedText = isUsed
    ? "الكود مستخدم، لكن بيانات هذا الحساب لم تصل بعد. ستظهر هنا تلقائيًا عند توفر المزامنة السحابية."
    : "هذا الحساب لم يستخدم الكود بعد، لذلك لا توجد بيانات للعرض.";
  return `
    <article class="managed-section-panel">
      <div class="managed-section-title">
        <i data-lucide="${icon}"></i>
        <div>
          <span class="eyebrow">${escapeHtml(subtitle)}</span>
          <h3>${escapeHtml(title)}</h3>
        </div>
      </div>
      <div class="empty-state compact">
        <i data-lucide="${isUsed ? "cloud-off" : "user-round-x"}"></i>
        <h3>${isUsed ? "بانتظار مزامنة البيانات" : "لم يتم استخدام الكود"}</h3>
        <p>${lockedText}</p>
      </div>
    </article>
  `;
}

function managedSyncedSection(section, data) {
  if (section === "students") return managedStudentsTable(data);
  if (section === "attendance") return managedAttendanceTable(data);
  if (section === "grades") return managedGradesTable(data);
  if (section === "requests") return managedStudentRequestsTable(data);
  return managedSheetsSummary(data);
}

function managedStudentsTable(data) {
  const rows = managedSubjects(data).flatMap((subject) => managedStudents(data, subject.id)
    .map((student) => ({ subject, student })));
  if (!rows.length) return managedEmptySynced("لا توجد أسماء طلاب متزامنة بعد");
  return `
    <div class="table-shell managed-data-table">
      <table>
        <thead><tr><th>#</th><th>الطالب</th><th>المادة</th><th>غياب</th><th>تأخير</th><th>ملاحظات</th></tr></thead>
        <tbody>${rows.map(({ subject, student }, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(student.name)}</td>
            <td>${escapeHtml(subject.name)}</td>
            <td>${Number(student.absenceCount || 0)}</td>
            <td>${Number(student.lateCount || 0)}</td>
            <td>${escapeHtml(student.notes || "-")}</td>
          </tr>
        `).join("")}</tbody>
      </table>
    </div>
  `;
}

function managedAttendanceTable(data) {
  const rows = managedSubjects(data).flatMap((subject) => {
    const students = new Map(managedStudents(data, subject.id).map((student) => [student.id, student]));
    return Object.entries(data.attendance?.[subject.id] || {}).flatMap(([key, values]) => {
      const [date, sessionId = "session-1"] = String(key).split("__");
      return Object.entries(values || {}).map(([studentId, status]) => ({
        date,
        sessionId,
        subject,
        student: students.get(studentId),
        status
      }));
    });
  }).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 120);
  if (!rows.length) return managedEmptySynced("لا يوجد تحضير متزامن بعد");
  return `
    <div class="table-shell managed-data-table">
      <table>
        <thead><tr><th>#</th><th>التاريخ</th><th>الحصة</th><th>المادة</th><th>الطالب</th><th>الحالة</th></tr></thead>
        <tbody>${rows.map((row, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(row.date)}</td>
            <td>${escapeHtml(managedSessionLabel(data, row.sessionId))}</td>
            <td>${escapeHtml(row.subject.name)}</td>
            <td>${escapeHtml(row.student?.name || "طالب محذوف")}</td>
            <td>${managedStatusBadge(row.status)}</td>
          </tr>
        `).join("")}</tbody>
      </table>
    </div>
  `;
}

function managedGradesTable(data) {
  const rows = managedSubjects(data).flatMap((subject) => {
    const columns = data.gradeColumns?.[subject.id] || [];
    return managedStudents(data, subject.id).map((student) => {
      const grades = data.grades?.[subject.id]?.[student.id] || {};
      const total = columns.reduce((sum, column) => sum + Number(grades[column.id] || 0), 0);
      const max = columns.reduce((sum, column) => sum + Number(column.max || 0), 0);
      return { subject, student, total, max };
    });
  });
  if (!rows.length) return managedEmptySynced("لا توجد درجات متزامنة بعد");
  return `
    <div class="table-shell managed-data-table">
      <table>
        <thead><tr><th>#</th><th>الطالب</th><th>المادة</th><th>المجموع</th><th>النسبة</th></tr></thead>
        <tbody>${rows.map((row, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(row.student.name)}</td>
            <td>${escapeHtml(row.subject.name)}</td>
            <td>${row.total} / ${row.max}</td>
            <td>${row.max ? Math.round((row.total / row.max) * 100) : 0}%</td>
          </tr>
        `).join("")}</tbody>
      </table>
    </div>
  `;
}

function managedSheetsSummary(data) {
  const subjects = managedSubjects(data);
  if (!subjects.length) return managedEmptySynced("لا توجد كشوف متزامنة بعد");
  return `
    <div class="table-shell managed-data-table">
      <table>
        <thead><tr><th>#</th><th>المادة</th><th>الطلاب</th><th>سجلات التحضير</th><th>الحصص</th></tr></thead>
        <tbody>${subjects.map((subject, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(subject.name)}</td>
            <td>${managedStudents(data, subject.id).length}</td>
            <td>${Object.keys(data.attendance?.[subject.id] || {}).length}</td>
            <td>${(data.schedule || []).filter((item) => item.subjectId === subject.id).length}</td>
          </tr>
        `).join("")}</tbody>
      </table>
    </div>
  `;
}

function managedStudentRequestsTable(data) {
  const rows = Array.isArray(data?.studentRequests) ? [...data.studentRequests].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))) : [];
  if (!rows.length) return managedEmptySynced("لا توجد طلبات معلم مرسلة بعد");
  const subjectNames = new Map(managedSubjects(data).map((subject) => [subject.id, subject.name]));
  return `
    <div class="table-shell managed-data-table">
      <table>
        <thead><tr><th>#</th><th>نوع الطلب</th><th>الطالب</th><th>المادة/الفصل</th><th>الملاحظة</th><th>الحالة</th><th>التاريخ</th><th>الإجراء</th></tr></thead>
        <tbody>${rows.map((request, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${studentRequestTypeLabel(request.type)}</td>
            <td>${escapeHtml(request.studentName || request.name || "-")}</td>
            <td>${escapeHtml(subjectNames.get(request.subjectId) || "-")}</td>
            <td>${escapeHtml(request.note || "-")}</td>
            <td>${studentRequestStatusBadge(request)}</td>
            <td>${formatDateTime(request.createdAt)}</td>
            <td>
              ${studentRequestStatus(request) === "pending" ? `
                <div class="admin-actions request-actions">
                  <button class="status-button" data-managed-request-action="approve" data-managed-request-id="${escapeAttribute(request.id)}">${studentRequestActionLabel(request.type)}</button>
                  <button class="status-button danger-lite" data-managed-request-action="reject" data-managed-request-id="${escapeAttribute(request.id)}">رفض</button>
                </div>
              ` : `
                <div class="admin-actions request-actions">
                  <button class="status-button danger-lite" data-managed-request-action="remove" data-managed-request-id="${escapeAttribute(request.id)}">حذف الطلب</button>
                </div>
              `}
            </td>
          </tr>
        `).join("")}</tbody>
      </table>
    </div>
  `;
}

function studentRequestStatus(request = {}) {
  return request.status === "approved" || request.status === "rejected" ? request.status : "pending";
}

function studentRequestStatusBadge(request = {}) {
  const status = studentRequestStatus(request);
  const labels = { pending: "بانتظار المراجعة", approved: "تم التنفيذ", rejected: "مرفوض" };
  const classes = { pending: "status-late", approved: "status-present", rejected: "status-absent" };
  return `<span class="status-badge ${classes[status] || ""}">${labels[status] || labels.pending}</span>`;
}

function studentRequestActionLabel(type) {
  const labels = {
    add: "تنفيذ الإضافة",
    delete: "تنفيذ الحذف",
    update: "تنفيذ التعديل",
    transfer: "تنفيذ الطلب"
  };
  return labels[type] || "تنفيذ الطلب";
}

function normalizeArabicName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ar");
}

function bindManagedStudentRequestActions(item, syncedData = null) {
  document.querySelectorAll("[data-managed-request-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const reset = setButtonLoading(button, "جارٍ المعالجة...");
      try {
        const result = await handleManagedStudentRequestAction(item, button.dataset.managedRequestId, button.dataset.managedRequestAction, syncedData);
        if (result.cancelled) return;
        app.services.toast.show(result.message, result.ok ? "success" : "error");
        if (result.ok) await renderManagedAccountPage(item.code, "requests");
      } finally {
        reset();
      }
    });
  });
}

async function handleManagedStudentRequestAction(item, requestId, action, syncedData = null) {
  const activeLicense = app.services.license.getActiveLicense();
  const row = await app.services.license.getManagedAccountData(item.code).catch(() => null);
  const data = structuredClone(row?.data || syncedData || {});
  data.studentRequests = Array.isArray(data.studentRequests) ? data.studentRequests : [];
  const requestIndex = data.studentRequests.findIndex((request) => request.id === requestId);
  if (requestIndex < 0) return { ok: false, message: "لم يتم العثور على الطلب" };
  const request = data.studentRequests[requestIndex];

  if (action === "remove") {
    data.studentRequests.splice(requestIndex, 1);
    await saveManagedRequestReview(item, data, row, activeLicense);
    return { ok: true, message: "تم حذف الطلب من القائمة" };
  }

  if (action === "reject") {
    const ok = await app.services.modal.confirm({
      title: "رفض طلب المعلم",
      message: "هل تريد رفض هذا الطلب؟ سيظهر للمعلم أن الطلب مرفوض.",
      confirmLabel: "رفض الطلب"
    });
    if (!ok) return { ok: false, cancelled: true, message: "تم إلغاء العملية" };
    data.studentRequests[requestIndex] = {
      ...request,
      status: "rejected",
      reviewedAt: new Date().toISOString(),
      reviewedBy: app.services.store.getSettings().teacherName || "المشرف"
    };
    await saveManagedRequestReview(item, data, row, activeLicense);
    return { ok: true, message: "تم رفض الطلب" };
  }

  const confirmLabel = studentRequestActionLabel(request.type);
  const ok = await app.services.modal.confirm({
    title: "تنفيذ طلب المعلم",
    message: `هل تريد ${confirmLabel} للطالب ${request.studentName || ""}؟`,
    confirmLabel
  });
  if (!ok) return { ok: false, cancelled: true, message: "تم إلغاء العملية" };

  const execution = await executeStudentRequestOnSupervisorStore(request);
  if (!execution.ok) return execution;

  data.studentRequests[requestIndex] = {
    ...request,
    status: "approved",
    reviewedAt: new Date().toISOString(),
    reviewedBy: app.services.store.getSettings().teacherName || "المشرف",
    resultMessage: execution.message
  };
  await saveManagedRequestReview(item, data, row, activeLicense);
  app.services.sync.scheduleManagedAccountSync(0);
  return { ok: true, message: execution.message || "تم تنفيذ الطلب" };
}

async function executeStudentRequestOnSupervisorStore(request = {}) {
  const subjectId = request.subjectId;
  const subject = app.services.store.getSubject(subjectId, app.services.license.getActiveLicense());
  if (!subject) return { ok: false, message: "المادة غير موجودة لدى المشرف" };
  const students = app.services.store.getStudents(subjectId);
  const target = request.studentId
    ? students.find((student) => student.id === request.studentId)
    : students.find((student) => normalizeArabicName(student.name) === normalizeArabicName(request.studentName));

  if (request.type === "add") {
    const result = await app.services.store.addStudent(subjectId, { name: request.studentName, notes: request.note || "" });
    if (!result.ok) return { ok: false, message: result.reason === "duplicate" ? "الطالب موجود مسبقًا في هذه المادة" : "تعذر إضافة الطالب" };
    return { ok: true, message: "تمت إضافة الطالب للمادة" };
  }

  if (request.type === "delete") {
    if (!target) return { ok: false, message: "لم يتم العثور على الطالب المطلوب حذفه" };
    await app.services.store.deleteStudent(subjectId, target.id);
    return { ok: true, message: "تم حذف الطالب من المادة" };
  }

  if (request.type === "update") {
    if (!target) return { ok: false, message: "لم يتم العثور على الطالب المطلوب تعديله" };
    const result = await app.services.store.updateStudent(subjectId, target.id, {
      name: request.studentName || target.name,
      notes: request.note || target.notes || ""
    });
    if (!result.ok) return { ok: false, message: result.reason === "duplicate" ? "يوجد طالب آخر بنفس الاسم" : "تعذر تعديل بيانات الطالب" };
    return { ok: true, message: "تم تعديل بيانات الطالب" };
  }

  return { ok: false, message: "نوع الطلب غير مدعوم" };
}

async function saveManagedRequestReview(item, data, row, activeLicense) {
  await app.services.license.saveManagedAccountData({
    code: item.code,
    parentCode: activeLicense?.code || row?.parent_code || "",
    ownerName: row?.owner_name || item.ownerName || "",
    accessMode: item.accessMode || row?.access_mode || "teacher",
    data
  });
}

function managerRequestsSummary(items = [], dataRows = []) {
  const rowsByCode = new Map((dataRows || []).map((row) => [normalizeCodeInput(row.code), row]));
  const entries = items.map((item) => {
    const row = rowsByCode.get(normalizeCodeInput(item.code));
    const requests = Array.isArray(row?.data?.studentRequests) ? row.data.studentRequests : [];
    const pending = requests.filter((request) => studentRequestStatus(request) === "pending");
    return { item, row, requests, pending, pendingCount: pending.length, totalCount: requests.length };
  });
  return {
    entries,
    totalPending: entries.reduce((sum, entry) => sum + entry.pendingCount, 0)
  };
}

function managerTeacherNavigatorHtml(items = [], summary = managerRequestsSummary(items, [])) {
  if (!items.length) return "";
  const entryByCode = new Map((summary.entries || []).map((entry) => [normalizeCodeInput(entry.item.code), entry]));
  return `
    <section class="manager-teacher-navigator" id="manager-teacher-navigator">
      <div class="panel-header">
        <div>
          <span class="eyebrow">متابعة حسب المعلم</span>
          <h3>اختر المعلم ثم القسم المطلوب</h3>
        </div>
        <label class="search-input compact-search">
          <input id="manager-teacher-search" type="search" placeholder="بحث باسم المعلم" />
          <i data-lucide="search"></i>
        </label>
      </div>
      <div class="manager-teacher-grid">
        ${items.map((item) => {
          const entry = entryByCode.get(normalizeCodeInput(item.code)) || { pendingCount: 0, totalCount: 0 };
          const sections = item.accessMode === "delegate"
            ? [["attendance", "التحضير"], ["sheets", "الكشوفات"], ["requests", "طلبات المعلم"]]
            : [["students", "الطلاب"], ["attendance", "التحضير"], ["grades", "الدرجات"], ["sheets", "الكشوفات"], ["requests", "طلبات المعلم"]];
          return `
            <article class="manager-teacher-card" data-manager-teacher-card="${escapeAttribute(managedAccountName(item))}">
              <header>
                <strong>${escapeHtml(managedAccountName(item))}</strong>
                <span class="muted">${managerRoleLabel(item.accessMode)}</span>
                ${entry.pendingCount ? `<span class="status-badge status-late">${entry.pendingCount} طلب جديد</span>` : `<span class="status-badge">لا توجد طلبات جديدة</span>`}
              </header>
              <div class="manager-teacher-actions">
                ${sections.map(([section, label]) => `
                  <button class="status-button" type="button" data-manager-open-section="${section}" data-manager-open-code="${escapeAttribute(item.code)}">
                    ${section === "requests" && entry.pendingCount ? `<span class="mini-dot">${entry.pendingCount}</span>` : ""}
                    ${label}
                  </button>
                `).join("")}
              </div>
            </article>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function supervisorStatsHtml(items = [], dataRows = []) {
  const rows = dataRows.filter((row) => row?.data);
  const today = new Date().toISOString().slice(0, 10);
  const teacherStats = rows.map((row) => supervisorTeacherStat(row));
  const totals = teacherStats.reduce((sum, stat) => ({
    records: sum.records + stat.records,
    present: sum.present + stat.present,
    absent: sum.absent + stat.absent,
    late: sum.late + stat.late,
    absentToday: sum.absentToday + stat.absentToday
  }), { records: 0, present: 0, absent: 0, late: 0, absentToday: 0 });
  const overallRate = totals.records ? Math.round((totals.present / totals.records) * 100) : 0;
  const subjectAbsences = supervisorSubjectAbsences(rows);
  const mostAbsentSubject = subjectAbsences[0];
  const bestTeachers = [...teacherStats].sort((a, b) => b.rate - a.rate || b.records - a.records).slice(0, 5);
  const performanceRows = teacherStats.sort((a, b) => b.records - a.records).slice(0, 6);
  return `
    <section class="supervisor-stats-panel">
      <div class="panel-header">
        <div>
          <span class="eyebrow">إحصائيات المشرف</span>
          <h3>حضور وأداء الحسابات التابعة</h3>
        </div>
        <span class="status-badge status-present">${rows.length} حساب متزامن</span>
      </div>
      <div class="supervisor-filter-strip">
        <span><i data-lucide="filter"></i>فلترة حسب: المعلم · المادة · الفصل · التاريخ</span>
        <small>تظهر الأرقام بعد مزامنة بيانات الحسابات التابعة.</small>
      </div>
      <div class="supervisor-stat-groups">
        <article class="supervisor-stat-group">
          <h4><i data-lucide="check-check"></i>قسم الحضور</h4>
          <div class="quick-stats compact">
            <article class="stat-card"><span>نسبة الحضور العامة</span><strong>${overallRate}%</strong></article>
            <article class="stat-card"><span>الغائبون اليوم</span><strong>${totals.absentToday}</strong></article>
            <article class="stat-card"><span>أكثر مادة فيها غياب</span><strong>${escapeHtml(mostAbsentSubject?.name || "لا يوجد")}</strong></article>
          </div>
        </article>
        <article class="supervisor-stat-group">
          <h4><i data-lucide="award"></i>قسم الأداء</h4>
          ${bestTeachers.length ? `<div class="ranking-list">${bestTeachers.map((teacher, index) => `
            <div class="ranking-row">
              <span class="rank">${index + 1}</span>
              <strong>${escapeHtml(teacher.name)}</strong>
              <span class="status-badge status-present">${teacher.rate}% التزام</span>
            </div>
          `).join("")}</div>` : managedEmptyInline("لا توجد بيانات أداء بعد")}
        </article>
        <article class="supervisor-stat-group">
          <h4><i data-lucide="bar-chart-3"></i>قسم التحليل</h4>
          ${performanceRows.length ? `<div class="supervisor-analysis-list">${performanceRows.map((teacher, index) => `
            <article>
              <span class="rank">${index + 1}</span>
              <strong>${escapeHtml(teacher.name)}</strong>
              <div>
                <b>${teacher.records}</b><small>سجل</small>
                <b class="present-text">${teacher.present}</b><small>حضور</small>
                <b class="absent-text">${teacher.absent}</b><small>غياب</small>
                <b class="late-text">${teacher.late}</b><small>تأخير</small>
              </div>
            </article>
          `).join("")}</div>` : managedEmptyInline("لا توجد بيانات متزامنة بعد")}
        </article>
      </div>
    </section>
  `;
}

function supervisorTeacherStat(row) {
  const data = row.data || {};
  let present = 0;
  let absent = 0;
  let late = 0;
  let absentToday = 0;
  const today = new Date().toISOString().slice(0, 10);
  Object.values(data.attendance || {}).forEach((sessions) => {
    Object.entries(sessions || {}).forEach(([sessionKey, values]) => {
      Object.values(values || {}).forEach((status) => {
        if (status === "present") present += 1;
        if (status === "absent") {
          absent += 1;
          if (String(sessionKey).startsWith(today)) absentToday += 1;
        }
        if (status === "late") late += 1;
      });
    });
  });
  const records = present + absent + late;
  return {
    name: row.owner_name || data.settings?.teacherName || "معلم بدون اسم",
    present,
    absent,
    late,
    absentToday,
    records,
    rate: records ? Math.round((present / records) * 100) : 0
  };
}

function supervisorSubjectAbsences(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const data = row.data || {};
    const subjects = new Map(managedSubjects(data).map((subject) => [subject.id, subject.name]));
    Object.entries(data.attendance || {}).forEach(([subjectId, sessions]) => {
      Object.values(sessions || {}).forEach((values) => {
        Object.values(values || {}).forEach((status) => {
          if (status !== "absent") return;
          const current = map.get(subjectId) || { name: subjects.get(subjectId) || "مادة غير محددة", absent: 0 };
          current.absent += 1;
          map.set(subjectId, current);
        });
      });
    });
  });
  return [...map.values()].sort((a, b) => b.absent - a.absent);
}

function managerReportDefinitions() {
  return [
    { id: "attendance", icon: "check-check", title: "تقرير الحضور والغياب", text: "إجمالي الطلاب والحضور والغياب ونسبة الالتزام." },
    { id: "teachers", icon: "users-round", title: "تقرير أداء المعلمين", text: "نسبة التحضير والحصص المنفذة ونشاط الحسابات." },
    { id: "achievement", icon: "graduation-cap", title: "تقرير التحصيل الدراسي", text: "متوسط المواد والناجحون والراسبون." },
    { id: "risk", icon: "triangle-alert", title: "تقرير الطلاب المعرضين للخطر", text: "غياب مرتفع أو درجات منخفضة أو سلوك يحتاج متابعة." },
    { id: "behavior", icon: "shield-alert", title: "تقرير السلوك والمواظبة", text: "المخالفات وأنواعها والإجراءات المتخذة." },
    { id: "lessons", icon: "calendar-days", title: "تقرير الحصص", text: "الحصص المجدولة والمنفذة ونسبة الإنجاز." },
    { id: "grades", icon: "table-properties", title: "تقرير الدرجات", text: "الدرجات المدخلة والناقصة والمواد غير المكتملة." },
    { id: "inactive", icon: "user-x", title: "تقرير المعلمين غير النشطين", text: "آخر مزامنة وآخر تحضير ونسبة النشاط." },
    { id: "daily", icon: "sun", title: "التقرير اليومي", text: "ملخص سريع للحصص والمعلمين والغياب والتنبيهات." },
    { id: "monthly", icon: "trending-up", title: "التقرير الشهري", text: "نسبة التحسن والانخفاض وأبرز المشاكل." },
    { id: "comparison", icon: "git-compare", title: "تقرير المقارنة", text: "مقارنة بين المواد والمعلمين والجهات والأشهر." }
  ];
}

function managerReportsPanelHtml(items = [], dataRows = []) {
  const summary = managerReportSummary(items, dataRows);
  const definitions = managerReportDefinitions();
  return `
    <section class="manager-reports-panel">
      <div class="panel-header">
        <div>
          <span class="eyebrow">التقارير الإدارية</span>
          <h3>لوحة تقارير المشرف</h3>
        </div>
        <button class="primary-button" type="button" data-manager-report-pdf="all">
          <i data-lucide="file-down"></i>تصدير التقرير الشامل
        </button>
      </div>
      <div class="quick-stats compact">
        <article class="stat-card"><span>إجمالي الطلاب</span><strong>${summary.students}</strong></article>
        <article class="stat-card"><span>نسبة الحضور</span><strong>${summary.attendanceRate}%</strong></article>
        <article class="stat-card"><span>الحصص المجدولة</span><strong>${summary.lessons}</strong></article>
        <article class="stat-card"><span>المخالفات</span><strong>${summary.behaviorCount}</strong></article>
      </div>
      <div class="manager-report-export-panel">
        <label>تصدير تقرير منفصل
          <select class="select-field" id="manager-report-select">
            ${definitions.map((item) => `<option value="${item.id}">${item.title}</option>`).join("")}
          </select>
        </label>
        <button class="ghost-button" type="button" id="manager-export-selected-report">
          <i data-lucide="file-output"></i>تصدير المحدد PDF
        </button>
      </div>
      <div class="manager-report-grid">
        ${definitions.map((item) => managerReportCardHtml(item, summary)).join("")}
      </div>
    </section>
  `;
}

function managerReportCardHtml(item, summary) {
  const metrics = {
    attendance: [["الحضور", `${summary.attendanceRate}%`], ["الغياب", summary.absent], ["أكثر مادة غيابًا", summary.mostAbsentSubject || "لا يوجد"]],
    teachers: [["المعلمون", summary.teachers], ["الحصص المنفذة", summary.executedLessons], ["الالتزام", `${summary.teacherCommitment}%`]],
    achievement: [["متوسط الدرجات", `${summary.gradeAverage}%`], ["ناجحون", summary.passed], ["راسبون", summary.failed]],
    risk: [["بحاجة متابعة", summary.atRisk.length], ["غياب", summary.absenceRisk], ["درجات", summary.gradeRisk]],
    behavior: [["المخالفات", summary.behaviorCount], ["الأكثر تكرارًا", summary.topBehavior || "لا يوجد"], ["إجراءات", summary.behaviorActions]],
    lessons: [["المجدولة", summary.lessons], ["المنفذة", summary.executedLessons], ["الإنجاز", `${summary.lessonCompletion}%`]],
    grades: [["المدخلة", summary.enteredGrades], ["الناقصة", summary.missingGrades], ["غير مكتملة", summary.incompleteSubjects]],
    inactive: [["غير نشطين", summary.inactiveTeachers.length], ["آخر مزامنة", summary.latestSync || "لا يوجد"], ["الحسابات", summary.teachers]],
    daily: [["الحصص", summary.lessonsToday], ["المعلمون", summary.teachers], ["غياب اليوم", summary.absentToday]],
    monthly: [["التحسن", `${summary.monthlyImprovement}%`], ["الانخفاض", `${summary.monthlyDrop}%`], ["أفضل مادة", summary.bestSubject || "لا يوجد"]],
    comparison: [["المواد", summary.subjects], ["الجهات", summary.institutions], ["الأشهر", summary.monthsCount]]
  }[item.id] || [];
  return `
    <article class="manager-report-card">
      <i data-lucide="${item.icon}"></i>
      <strong>${item.title}</strong>
      <p>${item.text}</p>
      <div class="report-metrics">
        ${metrics.map(([label, value]) => `<span><b>${escapeHtml(value)}</b><small>${label}</small></span>`).join("")}
      </div>
      <button class="ghost-button" type="button" data-manager-report-pdf="${item.id}">
        <i data-lucide="file-down"></i>تصدير PDF
      </button>
    </article>
  `;
}

function bindManagerReports(items = [], dataRows = []) {
  document.querySelectorAll("[data-manager-report-pdf]").forEach((button) => {
    button.addEventListener("click", () => exportManagerReport(button.dataset.managerReportPdf, items, dataRows));
  });
  qs("#manager-export-selected-report")?.addEventListener("click", () => {
    exportManagerReport(qs("#manager-report-select")?.value || "attendance", items, dataRows);
  });
}

function managerReportSummary(items = [], dataRows = []) {
  const license = app.services.license.getActiveLicense();
  const localSubjects = app.services.store.getSubjects(null, license);
  const localStudents = localSubjects.flatMap((subject) => app.services.store.getStudents(subject.id).map((student) => ({ student, subject })));
  const localSchedule = app.services.store.getSchedule(null, license);
  const localBehavior = app.services.store.getBehaviorViolations?.() || [];
  const rows = dataRows.filter((row) => row?.data);
  const teacherStats = rows.map((row) => supervisorTeacherStat(row));
  const localAttendance = countAttendanceRecords(app.services.store.state?.attendance || {}, new Map(localSubjects.map((subject) => [subject.id, subject.name])));
  const managedAttendance = rows.reduce((sum, row) => mergeAttendanceCounts(sum, countAttendanceRecords(row.data?.attendance || {}, new Map(managedSubjects(row.data).map((subject) => [subject.id, subject.name])))), emptyAttendanceCounts());
  const attendance = mergeAttendanceCounts(localAttendance, managedAttendance);
  const grades = mergeGradeSummaries(collectGradeSummaryFromStore(localSubjects), rows.reduce((sum, row) => mergeGradeSummaries(sum, collectGradeSummaryFromData(row.data || {})), emptyGradeSummary()));
  const managedStudentsCount = rows.reduce((sum, row) => sum + managedSubjects(row.data).reduce((count, subject) => count + managedStudents(row.data, subject.id).length, 0), 0);
  const managedLessons = rows.reduce((sum, row) => sum + (Array.isArray(row.data?.schedule) ? row.data.schedule.length : 0), 0);
  const managedBehavior = rows.reduce((sum, row) => sum + (Array.isArray(row.data?.behaviorViolations) ? row.data.behaviorViolations.length : 0), 0);
  const subjectAbsences = supervisorSubjectAbsences(rows);
  const localSubjectAbsences = [...localAttendance.subjectAbsences.values()].sort((a, b) => b.absent - a.absent);
  const mostAbsentSubject = [...subjectAbsences, ...localSubjectAbsences].sort((a, b) => b.absent - a.absent)[0]?.name || "";
  const totalRecords = attendance.present + attendance.absent + attendance.late;
  const today = new Date().toISOString().slice(0, 10);
  const lessonsToday = [...localSchedule, ...rows.flatMap((row) => row.data?.schedule || [])].filter((lesson) => lesson.day === ARABIC_DAYS[new Date().getDay()]).length;
  const topBehavior = topRepeated(localBehavior.map((item) => item.violationType).filter(Boolean));
  const allSubjectsCount = localSubjects.length + rows.reduce((sum, row) => sum + managedSubjects(row.data).length, 0);
  const institutions = app.services.store.getInstitutions(license).length + rows.reduce((sum, row) => sum + (Array.isArray(row.data?.institutions) ? row.data.institutions.length : 0), 0);
  const atRisk = [
    ...localStudents
      .filter(({ student }) => (student.absenceCount || 0) >= (app.services.store.getSettings().absenceLimit || 6))
      .map(({ student, subject }) => ({ student: student.name, subject: subject.name, reason: "غياب مرتفع" })),
    ...grades.lowStudents
  ].slice(0, 12);
  return {
    students: localStudents.length + managedStudentsCount,
    subjects: allSubjectsCount,
    institutions,
    teachers: Math.max(items.length, rows.length),
    lessons: localSchedule.length + managedLessons,
    lessonsToday,
    executedLessons: attendance.sessions,
    present: attendance.present,
    absent: attendance.absent,
    late: attendance.late,
    absentToday: attendance.absentToday,
    attendanceRate: totalRecords ? Math.round((attendance.present / totalRecords) * 100) : 0,
    teacherCommitment: teacherStats.length ? Math.round(teacherStats.reduce((sum, stat) => sum + stat.rate, 0) / teacherStats.length) : 0,
    lessonCompletion: (localSchedule.length + managedLessons) ? Math.min(100, Math.round((attendance.sessions / (localSchedule.length + managedLessons)) * 100)) : 0,
    mostAbsentSubject,
    behaviorCount: localBehavior.length + managedBehavior,
    topBehavior,
    behaviorActions: new Set(localBehavior.map((item) => item.action).filter(Boolean)).size,
    gradeAverage: grades.average,
    passed: grades.passed,
    failed: grades.failed,
    enteredGrades: grades.entered,
    missingGrades: grades.missing,
    incompleteSubjects: grades.incompleteSubjects,
    gradeRisk: grades.lowStudents.length,
    absenceRisk: atRisk.filter((item) => item.reason.includes("غياب")).length,
    atRisk,
    inactiveTeachers: teacherStats.filter((stat) => stat.records === 0),
    latestSync: rows.map((row) => row.updated_at).filter(Boolean).sort().pop()?.slice(0, 10) || "",
    bestSubject: grades.bestSubject,
    monthlyImprovement: attendance.present ? Math.min(100, Math.round((attendance.present / Math.max(1, totalRecords)) * 100)) : 0,
    monthlyDrop: attendance.absent ? Math.min(100, Math.round((attendance.absent / Math.max(1, totalRecords)) * 100)) : 0,
    monthsCount: new Set([...Object.keys(app.services.store.state?.attendance || {}).flatMap((subjectId) => Object.keys(app.services.store.state.attendance[subjectId] || {}).map((key) => String(key).slice(0, 7))), today.slice(0, 7)]).size
  };
}

function exportManagerReport(reportId, items = [], dataRows = []) {
  const summary = managerReportSummary(items, dataRows);
  const html = `
    <div class="stats-report manager-reports-pdf">
      ${reportId === "all"
        ? managerReportDefinitions().map((item) => managerReportPdfSection(item.id, summary)).join("")
        : managerReportPdfSection(reportId, summary)}
    </div>
  `;
  const title = reportId === "all" ? "التقرير الشامل للمشرف" : managerReportDefinitions().find((item) => item.id === reportId)?.title || "تقرير المشرف";
  exportReportPdf({ name: "قسم المشرف" }, html, title, { calendar: app.services.store.getSettings().dateCalendar });
}

function managerReportPdfSection(reportId, summary) {
  const title = reportId === "all" ? "التقرير الشامل" : managerReportDefinitions().find((item) => item.id === reportId)?.title || "تقرير";
  const rowsByReport = {
    attendance: [["إجمالي الطلاب", summary.students], ["الحضور", summary.present], ["الغياب", summary.absent], ["التأخير", summary.late], ["نسبة الحضور", `${summary.attendanceRate}%`], ["أكثر مادة غيابًا", summary.mostAbsentSubject || "لا يوجد"]],
    teachers: [["عدد المعلمين", summary.teachers], ["نسبة التحضير", `${summary.teacherCommitment}%`], ["الحصص المنفذة", summary.executedLessons], ["الالتزام", `${summary.teacherCommitment}%`]],
    achievement: [["متوسط الدرجات", `${summary.gradeAverage}%`], ["عدد الناجحين", summary.passed], ["عدد الراسبين", summary.failed], ["أفضل مادة", summary.bestSubject || "لا يوجد"]],
    risk: summary.atRisk.length ? summary.atRisk.map((item) => [item.student, item.subject, item.reason]) : [["لا يوجد", "-", "-"]],
    behavior: [["عدد المخالفات", summary.behaviorCount], ["أكثر مخالفة تكرارًا", summary.topBehavior || "لا يوجد"], ["الإجراءات المختلفة", summary.behaviorActions]],
    lessons: [["الحصص المجدولة", summary.lessons], ["الحصص المنفذة", summary.executedLessons], ["نسبة الإنجاز", `${summary.lessonCompletion}%`]],
    grades: [["الدرجات المدخلة", summary.enteredGrades], ["الدرجات الناقصة", summary.missingGrades], ["المواد غير المكتملة", summary.incompleteSubjects]],
    inactive: summary.inactiveTeachers.length ? summary.inactiveTeachers.map((item) => [item.name, item.records, `${item.rate}%`]) : [["لا يوجد", 0, "0%"]],
    daily: [["الحصص", summary.lessonsToday], ["المعلمون", summary.teachers], ["الغياب", summary.absentToday], ["التنبيهات", summary.atRisk.length]],
    monthly: [["نسبة التحسن", `${summary.monthlyImprovement}%`], ["نسبة الانخفاض", `${summary.monthlyDrop}%`], ["أفضل مادة", summary.bestSubject || "لا يوجد"], ["المشاكل", summary.atRisk.length]],
    comparison: [["المواد", summary.subjects], ["المعلمون", summary.teachers], ["الجهات", summary.institutions], ["الأشهر", summary.monthsCount]]
  };
  const headers = ["risk", "inactive"].includes(reportId) ? ["الاسم", "البيان", "التصنيف"] : ["البند", "القيمة"];
  const rows = rowsByReport[reportId] || rowsByReport.attendance;
  return `
    <section class="report-section">
      <h2 class="pdf-section-title">${title}</h2>
      <table class="pdf-tight-table">
        <thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead>
        <tbody>
          ${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}
        </tbody>
      </table>
    </section>
  `;
}

function emptyAttendanceCounts() {
  return { present: 0, absent: 0, late: 0, absentToday: 0, sessions: 0, subjectAbsences: new Map() };
}

function countAttendanceRecords(attendance = {}, subjectNames = new Map()) {
  const result = emptyAttendanceCounts();
  const today = new Date().toISOString().slice(0, 10);
  Object.entries(attendance || {}).forEach(([subjectId, sessions]) => {
    Object.entries(sessions || {}).forEach(([sessionKey, values]) => {
      result.sessions += 1;
      Object.values(values || {}).forEach((status) => {
        if (status === "present") result.present += 1;
        if (status === "late") result.late += 1;
        if (status === "absent") {
          result.absent += 1;
          if (String(sessionKey).startsWith(today)) result.absentToday += 1;
          const current = result.subjectAbsences.get(subjectId) || { name: subjectNames.get(subjectId) || "مادة غير محددة", absent: 0 };
          current.absent += 1;
          result.subjectAbsences.set(subjectId, current);
        }
      });
    });
  });
  return result;
}

function mergeAttendanceCounts(a, b) {
  const result = {
    present: a.present + b.present,
    absent: a.absent + b.absent,
    late: a.late + b.late,
    absentToday: a.absentToday + b.absentToday,
    sessions: a.sessions + b.sessions,
    subjectAbsences: new Map(a.subjectAbsences)
  };
  b.subjectAbsences.forEach((value, key) => {
    const current = result.subjectAbsences.get(key) || { name: value.name, absent: 0 };
    current.absent += value.absent;
    result.subjectAbsences.set(key, current);
  });
  return result;
}

function emptyGradeSummary() {
  return { entered: 0, missing: 0, passed: 0, failed: 0, totalPercent: 0, counted: 0, average: 0, incompleteSubjects: 0, lowStudents: [], bestSubject: "" };
}

function collectGradeSummaryFromStore(subjects = []) {
  return subjects.reduce((summary, subject) => {
    const columns = app.services.store.getGradeColumns(subject.id);
    const students = app.services.store.getStudents(subject.id);
    return mergeGradeSummaries(summary, collectGradeSummary(subject, students, columns, (studentId) => app.services.store.getGrades(subject.id, studentId)));
  }, emptyGradeSummary());
}

function collectGradeSummaryFromData(data = {}) {
  return managedSubjects(data).reduce((summary, subject) => {
    const columns = data.gradeColumns?.[subject.id] || [];
    const students = managedStudents(data, subject.id);
    return mergeGradeSummaries(summary, collectGradeSummary(subject, students, columns, (studentId) => data.grades?.[subject.id]?.[studentId] || {}));
  }, emptyGradeSummary());
}

function collectGradeSummary(subject, students = [], columns = [], gradesGetter = () => ({})) {
  const summary = emptyGradeSummary();
  if (!columns.length) return summary;
  let subjectPercentTotal = 0;
  let subjectCounted = 0;
  students.forEach((student) => {
    const grades = gradesGetter(student.id);
    const max = columns.reduce((sum, column) => sum + reportNumber(column.max), 0);
    let total = 0;
    let hasGrade = false;
    columns.forEach((column) => {
      const value = grades[column.id];
      if (value === "" || value === undefined || value === null) {
        summary.missing += 1;
      } else {
        summary.entered += 1;
        hasGrade = true;
      }
      total += reportNumber(value);
    });
    if (!max || !hasGrade) return;
    const percent = Math.round((total / max) * 100);
    summary.totalPercent += percent;
    summary.counted += 1;
    subjectPercentTotal += percent;
    subjectCounted += 1;
    if (percent >= 50) summary.passed += 1;
    else {
      summary.failed += 1;
      summary.lowStudents.push({ student: student.name, subject: subject.name, reason: `درجات منخفضة ${percent}%` });
    }
  });
  if (students.length && summary.missing) summary.incompleteSubjects += 1;
  if (subjectCounted) {
    const average = Math.round(subjectPercentTotal / subjectCounted);
    summary.bestSubject = average >= 50 ? subject.name : summary.bestSubject;
  }
  return summary;
}

function mergeGradeSummaries(a, b) {
  const counted = a.counted + b.counted;
  return {
    entered: a.entered + b.entered,
    missing: a.missing + b.missing,
    passed: a.passed + b.passed,
    failed: a.failed + b.failed,
    totalPercent: a.totalPercent + b.totalPercent,
    counted,
    average: counted ? Math.round((a.totalPercent + b.totalPercent) / counted) : 0,
    incompleteSubjects: a.incompleteSubjects + b.incompleteSubjects,
    lowStudents: [...a.lowStudents, ...b.lowStudents],
    bestSubject: b.bestSubject || a.bestSubject
  };
}

function reportNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function topRepeated(values = []) {
  const counts = new Map();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

function managedSubjects(data) {
  return Array.isArray(data?.subjects) ? data.subjects : [];
}

function managedStudents(data, subjectId) {
  return Array.isArray(data?.students?.[subjectId]) ? data.students[subjectId] : [];
}

function managedSessionLabel(data, sessionId) {
  const lesson = (data.schedule || []).find((item) => item.id === sessionId);
  return lesson ? `${lesson.start || ""} - ${lesson.end || ""}`.trim() : sessionId;
}

function managedStatusBadge(status) {
  const labels = { present: "حاضر", absent: "غائب", late: "متأخر" };
  const classes = { present: "status-present", absent: "status-absent", late: "status-late" };
  return `<span class="status-badge ${classes[status] || ""}">${labels[status] || "-"}</span>`;
}

function studentRequestTypeLabel(type) {
  const labels = {
    add: "إضافة طالب",
    delete: "حذف طالب",
    transfer: "نقل طالب",
    update: "تعديل بيانات"
  };
  return labels[type] || "طلب طالب";
}

function managedEmptySynced(message) {
  return `<div class="empty-state compact"><i data-lucide="database"></i><h3>لا توجد بيانات</h3><p>${message}</p></div>`;
}

function managedEmptyInline(message) {
  return `<div class="empty-state compact"><i data-lucide="database"></i><h3>${message}</h3></div>`;
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ar-SA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function startManagerAutoRefresh(callback, interval = 9000) {
  clearManagerAutoRefresh();
  managerRefreshTimer = setInterval(() => {
    if (document.hidden || !location.hash.startsWith("#/manager") || qs(".modal-backdrop")) return;
    if (behaviorActiveTab === "form" && qs("#behavior-form")) return;
    callback();
  }, interval);
}

function clearManagerAutoRefresh() {
  if (!managerRefreshTimer) return;
  clearInterval(managerRefreshTimer);
  managerRefreshTimer = null;
}

function managedAccountName(item) {
  return item?.ownerName || (item?.accessMode === "delegate" ? "مندوب بدون اسم" : "معلم بدون اسم");
}

function readPinnedManagerStore() {
  try {
    const value = JSON.parse(localStorage.getItem(MANAGER_PINNED_ITEMS_KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function writePinnedManagerStore(value = {}) {
  localStorage.setItem(MANAGER_PINNED_ITEMS_KEY, JSON.stringify(value));
}

function getPinnedManagerItems(parentCode) {
  const normalizedParent = normalizeCodeInput(parentCode);
  const stored = readPinnedManagerStore();
  return mergeManagerItems(normalizedParent, [
    ...(managerPinnedItems.get(normalizedParent) || []),
    ...(Array.isArray(stored[normalizedParent]) ? stored[normalizedParent] : [])
  ]);
}

function pinManagerItems(parentCode, items = []) {
  const normalizedParent = normalizeCodeInput(parentCode);
  if (!normalizedParent) return;
  const next = mergeManagerItems(normalizedParent, [
    ...getPinnedManagerItems(normalizedParent),
    ...items
  ]);
  managerPinnedItems.set(normalizedParent, next);
  const stored = readPinnedManagerStore();
  stored[normalizedParent] = next;
  writePinnedManagerStore(stored);
}

function unpinManagerItem(parentCode, code) {
  const normalizedParent = normalizeCodeInput(parentCode);
  const normalizedCode = normalizeCodeInput(code);
  const next = getPinnedManagerItems(normalizedParent).filter((item) => normalizeCodeInput(item.code) !== normalizedCode);
  managerPinnedItems.set(normalizedParent, next);
  const stored = readPinnedManagerStore();
  stored[normalizedParent] = next;
  writePinnedManagerStore(stored);
}

function mergeManagerItems(parentCode, items = []) {
  const normalizedParent = normalizeCodeInput(parentCode);
  const map = new Map();
  items.filter(Boolean).forEach((item) => {
    const code = normalizeCodeInput(item.code);
    if (!code) return;
    const parent = normalizeCodeInput(item.parentCode || item.parent_code || normalizedParent);
    if (normalizedParent && parent && parent !== normalizedParent) return;
    map.set(code, {
      ...map.get(code),
      ...item,
      code,
      parentCode: parent || normalizedParent
    });
  });
  return [...map.values()].sort((a, b) => new Date(b.createdAt || b.activatedAt || 0) - new Date(a.createdAt || a.activatedAt || 0));
}

function enrichManagerUsageFromSync(items = [], rows = []) {
  const rowsByCode = new Map((rows || []).map((row) => [normalizeCodeInput(row.code), row]));
  return items.map((item) => {
    const row = rowsByCode.get(normalizeCodeInput(item.code));
    const data = row?.data && typeof row.data === "object" ? row.data : {};
    if (!data.childDeviceId && !data.childActivatedAt) return item;
    return {
      ...item,
      deviceId: item.deviceId || data.childDeviceId || "synced-device",
      activatedAt: item.activatedAt || data.childActivatedAt || row.updated_at || ""
    };
  });
}

function isDefaultTeacherProfileName(value) {
  const name = String(value || "").trim();
  return !name || name === "المعلم" || name === "د. أحمد" || name === "م.أمين سمير أمين اليوسفي";
}

function openManagedCodeEditModal(item) {
  if (!item) return;
  app.services.modal.open({
    title: "تعديل الكود التابع",
    body: `
      <form class="form-grid" id="managed-code-edit-form">
        <label>اسم المعلم أو المندوب
          <input class="field" name="ownerName" value="${escapeAttribute(item.ownerName || "")}" placeholder="مثال: أحمد محمد" required pattern="[\\p{L}\\s.'-]{2,}" title="اكتب اسمًا فقط بدون أرقام" />
        </label>
        <label>الصلاحية
          <select class="select-field" name="accessMode">
            <option value="teacher" ${item.accessMode === "teacher" ? "selected" : ""}>معلم</option>
            <option value="delegate" ${item.accessMode === "delegate" ? "selected" : ""}>مندوب تحضير</option>
          </select>
        </label>
      </form>
    `,
    actions: [
      { label: "إلغاء", action: "close" },
      { label: "حفظ التعديل", variant: "primary", action: async (root) => {
        const form = root.querySelector("#managed-code-edit-form");
        if (!form.reportValidity()) return false;
        const data = Object.fromEntries(new FormData(form));
        const result = await app.services.license.updateManagedCode(item.code, data);
        app.services.toast.show(result.message, result.ok ? "success" : "error");
        if (result.ok) renderManagerPage([], "manage");
        return result.ok;
      }}
    ]
  });
  renderIcons();
}

function openTeacherPermissionsModal(item) {
  if (!item) return;
  const permissions = normalizeTeacherPermissions(item.permissions);
  app.services.modal.open({
    title: "صلاحيات المعلم",
    body: `
      <form class="form-grid" id="teacher-permissions-form">
        <div class="smart-note compact-note">
          <i data-lucide="shield-check"></i>
          <span>حدد ما يستطيع المعلم التابع استخدامه. المعلم المستقل يبقى بصلاحياته الكاملة، أما المعلم التابع فيأخذ ما يحدده المشرف هنا.</span>
        </div>
        <h4 class="permission-title">الأقسام</h4>
        <div class="permission-grid">
          ${TEACHER_PERMISSION_SECTIONS.map(([id, label, icon]) => `
            <label class="permission-card">
              <input type="checkbox" name="${id}" ${permissions[id] ? "checked" : ""} />
              <i data-lucide="${icon}"></i>
              <span>${label}</span>
            </label>
          `).join("")}
        </div>
        <h4 class="permission-title">إجراءات الطلاب والمواد</h4>
        <div class="permission-grid permission-action-grid">
          ${TEACHER_ACTION_PERMISSIONS.map(([id, label, icon, description]) => `
            <label class="permission-card">
              <input type="checkbox" name="${id}" ${permissions[id] ? "checked" : ""} />
              <i data-lucide="${icon}"></i>
              <span>${label}</span>
              <small>${description}</small>
            </label>
          `).join("")}
        </div>
      </form>
    `,
    actions: [
      { label: "إلغاء", action: "close" },
      { label: "حفظ الصلاحيات", variant: "primary", action: async (root) => {
        const form = root.querySelector("#teacher-permissions-form");
        const data = Object.fromEntries(new FormData(form));
        const next = Object.fromEntries(ALL_TEACHER_PERMISSION_IDS.map((id) => [id, Boolean(data[id])]));
        const result = await app.services.license.updateManagedCodePermissions(item.code, next);
        app.services.toast.show(result.message, result.ok ? "success" : "error");
        renderManagerPage([], "manage");
        return true;
      }}
    ]
  });
  renderIcons();
}

function applyAccessMode(mode) {
  const shell = qs("#app-shell");
  const activeLicense = app.services.license.getActiveLicense();
  const isManagedDelegate = mode === "delegate" && isManagedChildAccount(activeLicense);
  shell.classList.toggle("role-admin-mode", mode === "admin");
  shell.classList.toggle("role-teacher-mode", mode === "teacher");
  shell.classList.toggle("role-delegate-mode", isManagedDelegate);
  shell.classList.toggle("role-independent-delegate-mode", mode === "delegate" && !isManagedDelegate);
  shell.classList.toggle("role-readonly-mode", mode === "readonly");
  const titleHint = document.querySelector(".topbar-title .eyebrow");
  if (titleHint) {
    titleHint.textContent = mode === "admin"
      ? "لوحة تحكم المشرف"
      : mode === "delegate"
        ? "لوحة تحكم المندوب"
        : "لوحة تحكم المعلم";
  }
  // روابط المشرف موجودة في HTML، لكن يتم إخفاؤها حسب الصلاحية حتى لا تظهر للمعلم أو المندوب.
  document.querySelectorAll(".manager-only-link").forEach((element) => {
    element.hidden = mode !== "admin";
  });
  applyTeacherPermissions(mode);
}

function permissionForRoute(first, tab) {
  if (first === "subjects") return "subjects";
  if (first === "students") return "students";
  if (first === "attendance") return "attendance";
  if (first === "schedule") return "schedule";
  if (first === "grades") return "grades";
  if (first === "analytics") return "stats";
  if (first === "settings") return "settings";
  if (first === "subject") {
    const subjectTab = tab || "students";
    if (subjectTab === "sheet" || subjectTab === "attendance") return "attendance";
    if (subjectTab === "stats") return "stats";
    return subjectTab;
  }
  return "";
}

function isRouteAllowedByPermissions(first, tab, license = app.services.license.getActiveLicense()) {
  if (license?.accessMode === "delegate" && !isManagedChildAccount(license)) {
    const allowedRoutes = new Set(["home", "subjects", "students", "attendance", "schedule", "settings"]);
    if (first === "subject") return ["students", "attendance", "sheet", "settings", ""].includes(tab || "");
    return allowedRoutes.has(first);
  }
  if (!isManagedTeacherLicense(license)) return true;
  const key = permissionForRoute(first, tab);
  if (!key) return true;
  const permissions = license.permissions;
  if (!permissions) return true;
  return Boolean(permissions[key]);
}

function firstAllowedHash(license = app.services.license.getActiveLicense()) {
  if (!isManagedTeacherLicense(license) || !license.permissions) return "#/home";
  const first = TEACHER_PERMISSION_SECTIONS.find(([id]) => license.permissions[id]);
  if (!first) return "#/home";
  const route = first[0] === "stats" ? "analytics" : first[0];
  return `#/${route}`;
}

function isManagedTeacherLicense(license = app.services.license.getActiveLicense()) {
  return isManagedTeacherAccount(license);
}

function applyTeacherPermissions(mode) {
  const license = app.services.license.getActiveLicense();
  const permissions = isManagedTeacherLicense(license) ? license?.permissions : null;
  // كل رابط يحمل data-permission يتم إخفاؤه إذا أغلق المشرف هذا القسم للمعلم التابع.
  document.querySelectorAll("[data-permission]").forEach((element) => {
    const key = element.dataset.permission;
    element.hidden = Boolean(permissions && !permissions[key]);
  });
}

async function syncAccessModeFromLicense(settings) {
  await app.services.license.checkAccess().catch(() => {});
  const license = app.services.license.getActiveLicense();
  if (!license?.accessMode) return;
  const profileName = license.ownerName || license.customerName || "";
  // اسم الحساب القادم من كود التفعيل هو الاسم الرسمي للحساب، لذلك نزامنه مع واجهة المعلم.
  const patch = {
    ...(settings.accessMode !== license.accessMode ? {
      accessMode: license.accessMode,
      readOnlyMode: license.accessMode === "readonly"
    } : {}),
    ...(profileName && settings.teacherName !== profileName ? { teacherName: profileName } : {})
  };
  if (!Object.keys(patch).length) return;
  await app.services.store.updateSettings(patch);
  settings.accessMode = license.accessMode;
  settings.readOnlyMode = license.accessMode === "readonly";
  if (patch.teacherName) updateTeacherChip();
}

async function refreshCurrentLicensePermissions() {
  if (!app.services.license?.isActive?.()) return;
  if (permissionRefreshInFlight) return;
  permissionRefreshInFlight = true;
  const settings = app.services.store.getSettings();
  const before = settings.accessMode || (settings.readOnlyMode ? "readonly" : "teacher");
  try {
    // نستخدم قفلًا بسيطًا حتى لا تتكرر طلبات تحديث الصلاحيات في نفس اللحظة.
    await syncAccessModeFromLicense(settings);
    const license = app.services.license.getActiveLicense();
    const after = license?.accessMode || settings.accessMode || (settings.readOnlyMode ? "readonly" : "teacher");
    if (before !== after) app.services.toast.show("تم تحديث صلاحية الحساب تلقائيًا", "success");
    applyAccessMode(after);
    qs("#app-shell").classList.toggle("read-only-mode", Boolean(settings.readOnlyMode || app.services.store.getCurrentAcademicYear?.()?.archived));
  } finally {
    permissionRefreshInFlight = false;
  }
}

async function safeCheckAccess() {
  const localAccess = app.services.license.isActive();
  if (localAccess) {
    refreshCurrentLicensePermissions();
    return true;
  }
  return false;
}

function applyTheme(mode) {
  const theme = mode === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : mode;
  document.documentElement.dataset.theme = theme || "light";
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      location.reload();
    });
    const registration = await navigator.serviceWorker.register("./sw.js");
    if (registration.waiting) promptAppUpdate(registration);
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) promptAppUpdate(registration);
      });
    });
    setInterval(() => registration.update().catch(() => {}), 5 * 60 * 1000);
  } catch (error) {
    console.warn("Service worker registration failed", error);
  }
}

function renderSubjectShortcutPicker(targetTab, subjects) {
  const labels = {
    students: "الطلاب",
    attendance: "التحضير",
    grades: "الدرجات",
    analytics: "الإحصائيات"
  };
  setPageTitle(labels[targetTab] || "اختيار مادة");
  qs("#view").innerHTML = `
    <section class="panel shortcut-picker">
      <div class="panel-header">
        <div>
          <span class="eyebrow">اختيار المادة</span>
          <h2>اختر المادة للانتقال إلى ${labels[targetTab] || "القسم"}</h2>
        </div>
      </div>
      ${subjects.length ? `
        <div class="subject-choice-grid">
          ${subjects.map((subject) => `
            <button class="subject-choice-card" data-shortcut-subject="${subject.id}">
              <i data-lucide="book-open"></i>
              <strong>${escapeHtml(subject.name)}</strong>
              <span>${escapeHtml(subject.code || "بدون كود")} · ${subject.studentsCount} طالب</span>
            </button>
          `).join("")}
        </div>
      ` : `<div class="empty-state"><i data-lucide="book-plus"></i><h3>لا توجد مواد مضافة</h3><p>أضف مادة أولًا ثم ارجع لهذا القسم.</p></div>`}
    </section>
  `;
  document.querySelectorAll("[data-shortcut-subject]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = targetTab === "analytics" ? "stats" : targetTab;
      location.hash = `#/subject/${button.dataset.shortcutSubject}/${target}`;
    });
  });
  renderIcons();
}

function openGlobalSearch(query) {
  if (!query) return;
  const activeLicense = app.services.license.getActiveLicense();
  const results = app.services.store.globalSearch(query, activeLicense);
  const total = results.institutions.length + results.subjects.length + results.students.length + results.lessons.length;
  app.services.modal.open({
    title: `بحث شامل: ${escapeHtml(query)}`,
    body: total ? `
      <div class="global-search-results">
        ${searchSection("الجهات", results.institutions.map((item) => ({
          icon: "building-2",
          title: item.name,
          meta: item.type || "جهة تعليمية",
          action: "#/schedule"
        })))}
        ${searchSection("المواد", results.subjects.map((item) => ({
          icon: "book-open",
          title: item.name,
          meta: `${item.code || "بدون رمز"} · ${item.studentsCount} طالب`,
          action: `#/subject/${item.id}/students`
        })))}
        ${searchSection("الطلاب", results.students.map((item) => ({
          icon: "user",
          title: item.name,
          meta: item.subject ? `${item.subject.name} · غياب ${item.absenceCount} · تأخير ${item.lateCount}` : "طالب",
          action: item.subject ? `#/subject/${item.subject.id}/students` : "#/students"
        })))}
        ${searchSection("الحصص", results.lessons.map((item) => ({
          icon: "clock",
          title: `${item.day} · ${item.start} - ${item.end}`,
          meta: `${app.services.store.getSubject(item.subjectId, activeLicense)?.name || "مادة"} · ${item.room || "بدون قاعة"}`,
          action: "#/schedule"
        })))}
      </div>
    ` : `<div class="empty-state compact"><i data-lucide="search-x"></i><h3>لا توجد نتائج</h3><p>جرّب البحث باسم طالب أو مادة أو جهة.</p></div>`,
    actions: [{ label: "إغلاق", variant: "primary", action: "close" }]
  });
  document.querySelectorAll("[data-search-action]").forEach((button) => button.addEventListener("click", () => {
    app.services.modal.close();
    location.hash = button.dataset.searchAction;
  }));
  renderIcons();
}

function searchSection(title, rows) {
  if (!rows.length) return "";
  return `
    <section class="search-section">
      <h3>${title}</h3>
      <div class="search-result-list">
        ${rows.slice(0, 12).map((row) => `
          <button class="search-result-row" data-search-action="${row.action}">
            <i data-lucide="${row.icon}"></i>
            <span><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(row.meta)}</small></span>
          </button>
        `).join("")}
      </div>
    </section>
  `;
}

function openHelpGuide() {
  const activeLicense = app.services.license.getActiveLicense();
  const role = location.hash.startsWith("#/admin") ? "owner" : (activeLicense?.accessMode || "teacher");
  const guide = helpGuideForRole(role, activeLicense);
  app.services.modal.open({
    title: guide.title,
    body: `
      <div class="help-intro">
        <i data-lucide="${guide.icon}"></i>
        <div>
          <span class="eyebrow">${guide.badge}</span>
          <h3>${guide.heading}</h3>
          <p>${guide.summary}</p>
        </div>
      </div>
      <div class="help-guide role-help-guide">
        ${guide.items.map((item) => `
          <article>
            <h3><i data-lucide="${item.icon}"></i>${item.title}</h3>
            <p>${item.text}</p>
          </article>
        `).join("")}
      </div>
    `,
    actions: [{ label: "فهمت", variant: "primary", action: "close" }]
  });
  renderIcons();
}

// محتوى المساعدة مقسّم حسب نوع الحساب حتى يرى المستخدم التعليمات المناسبة لصلاحيته.
// ????? ???????? ???? ?? ????? ??????? ??? ???? ??????? ?? ??? ???? ?????? ????? ???????.
function helpGuideForRole(role, license = null) {
  if (role === "owner") return ownerHelpGuide();
  if (role === "admin") return supervisorHelpGuide(license);
  if (role === "delegate") return delegateHelpGuide(license);
  return teacherHelpGuide(license);
}

function promptAppUpdate(registration) {
  if (!registration.waiting || document.body.dataset.updatePrompt === "shown") return;
  document.body.dataset.updatePrompt = "shown";
  app.services.modal.open({
    title: "تحديث جديد للتطبيق",
    body: `
      <div class="empty-state compact confirm-state">
        <div class="confirm-icon update-icon spinning-update-icon"><i data-lucide="refresh-cw"></i></div>
        <h3>يوجد إصدار جديد</h3>
        <p>سيتم تحديث التطبيق تلقائيًا خلال لحظات.</p>
        <p>يرجى الانتظار حتى يتم فتح النسخة الجديدة.</p>
      </div>
    `,
    actions: []
  });
  renderIcons();
  setTimeout(() => registration.waiting?.postMessage({ type: "SKIP_WAITING" }), 1500);
}

function renderActivation() {
  const activeLicense = app.services.license.getActiveLicense();
  const pricing = app.services.license.getActivationPricing();
  const defaultCurrency = pricing.currency || "SAR";
  const defaultQuote = app.services.license.calculateActivationPrice("teacher", "week", 1, defaultCurrency);
  const freeTrialUsed = app.services.license.hasUsedFreeTrial?.() || false;
  const activationMessage = activeLicense
    ? `ينتهي الاشتراك في ${new Intl.DateTimeFormat("ar-SA", { dateStyle: "medium" }).format(new Date(activeLicense.expiresAt))}`
    : freeTrialUsed
      ? "انتهت التجربة المجانية على هذا الجهاز. اطلب التفعيل أو أدخل كود اشتراك للمتابعة."
      : "التطبيق يحتاج إلى كود تفعيل. يمكنك تجربة يوم مجاني أو طلب التفعيل.";
  setPageTitle("تفعيل التطبيق");
  qs("#view").innerHTML = `
    <section class="license-page premium-activation-page">
      <article class="license-card premium-activation-card" id="license-card">
        <div class="activation-hero">
          <div class="activation-top-actions">
            <button class="activation-help-pill" id="activation-support-button" type="button" aria-label="الدعم">
              <span>الدعم</span>
              <i data-lucide="headphones"></i>
            </button>
          </div>
          <div class="activation-logo-halo">
            <img class="license-logo" src="./assets/yusr-logo.png" alt="" />
          </div>
        </div>
        <div class="activation-welcome">
          <span class="eyebrow">تفعيل يُسر</span>
          <h2>${activeLicense ? "التطبيق مفعّل" : "مرحبًا بك 👋"}</h2>
          <p class="muted">${activeLicense ? activationMessage : "فعّل تطبيقك واستمتع بكافة المميزات"}</p>
        </div>
        ${activeLicense
          ? `<button class="activation-gradient-button activation-open-button" id="open-active-app" type="button"><span>فتح التطبيق الآن</span><i data-lucide="rocket"></i></button>`
          : `
            <div class="activation-choice-grid">
              <article class="activation-choice-card" data-open-payment-request>
                <div>
                  <strong>طلب التفعيل</strong>
                  <span>اطلب كود التفعيل واستمتع </span>
                </div>
                <span class="activation-card-illustration request-illustration" aria-hidden="true"><span></span></span>
                <button class="activation-mini-button" type="button" id="show-request-form"><i data-lucide="chevron-left"></i>طلب التفعيل</button>
              </article>
              <article class="activation-choice-card gift-card ${freeTrialUsed ? "trial-used-card" : ""}">
                <div>
                  <strong>استخدام مجاني</strong>
                  <span>${freeTrialUsed ? "استخدمت التجربة المجانية لهذا الجهاز" : "جرّب التطبيق مجانًا لمدة يوم واحد"}</span>
                </div>
                <span class="activation-card-illustration gift-illustration" aria-hidden="true"><span></span></span>
                <button class="activation-mini-button filled ${freeTrialUsed ? "trial-used-button" : ""}" type="button" id="${freeTrialUsed ? "free-trial-used-button" : "free-trial-button"}"><i data-lucide="${freeTrialUsed ? "circle-alert" : "zap"}"></i>استخدام مجاني</button>
              </article>
            </div>
            <form class="activation-code-panel" id="activation-form">
              <div class="activation-section-title">
                <i data-lucide="shield-check"></i>
                <div>
                  <strong>تفعيل التطبيق</strong>
                  <span>أدخل كود التفعيل الخاص بك</span>
                </div>
              </div>
              <label class="activation-code-input">
                <i data-lucide="key-round"></i>
                <input name="code" class="license-input" placeholder="أدخل كود التفعيل" required />
              </label>
              <button class="activation-gradient-button"><i data-lucide="shield-check"></i>تفعيل التطبيق</button>
              <button class="activation-install-help" id="show-install-guide" type="button">
                <i data-lucide="circle-help"></i>
                <span>كيف أثبت التطبيق؟</span>
              </button>
            </form>
            <form class="activation-request-form" id="activation-request-form" hidden>
              <input type="hidden" name="accountRole" id="activation-role" value="teacher" />
              <input type="hidden" name="currency" id="activation-currency" value="${defaultCurrency}" />
              <div class="payment-box activation-payment-card">
                <strong id="plan-price">السعر: ${defaultQuote.label}</strong>
                <button class="activation-payment-title" type="button" id="show-payment-details"><i data-lucide="wallet"></i><span>طرق الدفع</span><small>اختر طريقة الدفع المناسبة لك</small><i data-lucide="chevron-left"></i></button>
              </div>
              <section class="activation-payment-screen" id="activation-payment-screen" hidden>
                <div class="payment-screen-hero">
                  <button class="payment-back-button" type="button" id="payment-back-button" aria-label="رجوع"><i data-lucide="arrow-right"></i></button>
                  <div>
                    <h3>طرق الدفع</h3>
                    <p>اختر طريقة الدفع المناسبة لك</p>
                  </div>
                </div>
                <div class="activation-divider-title"><span></span><strong>اختر نوع المستخدم</strong><span></span></div>
                <div class="account-role-picker" role="radiogroup" aria-label="نوع الحساب">
                  <button type="button" class="account-role-card active" data-activation-role="teacher">
                    <i data-lucide="graduation-cap"></i>
                    <strong>معلم</strong>
                  </button>
                  <button type="button" class="account-role-card" data-activation-role="admin">
                    <i data-lucide="shield-check"></i>
                    <strong>مشرف</strong>
                  </button>
                  <button type="button" class="account-role-card" data-activation-role="delegate">
                    <i data-lucide="clipboard-check"></i>
                    <strong>مندوب</strong>
                  </button>
                </div>
                <div class="activation-divider-title"><span></span><strong>اختر نوع الاشتراك</strong><span></span></div>
                <label class="activation-select-row">
                  <i data-lucide="calendar-days"></i>
                  <select class="select-field" name="requestedPlan">
                    ${activationPlanOptions("teacher", pricing, "", 1, defaultCurrency)}
                  </select>
                </label>
                <div class="currency-display activation-soft-row">
                  <i data-lucide="badge-dollar-sign"></i>
                  <span>عملة التسعير</span>
                  <strong id="activation-currency-label">${defaultCurrency === "YER" ? "ريال يمني" : "ريال سعودي"}</strong>
                </div>
                <label class="teacher-slots-field" id="teacher-slots-field" hidden>عدد المعلمين المطلوب إضافتهم
                  <input class="field" name="teacherSlots" id="teacher-slots" type="text" inputmode="numeric" pattern="[0-9]*" value="0" />
                </label>
                <div class="plan-preview activation-soft-row" id="plan-preview">
                  <span>الباقة المختارة</span>
                  <strong>${defaultQuote.role.label} · ${defaultQuote.plan.label}</strong>
                  <p>${defaultQuote.label}</p>
                </div>
                <label class="activation-name-field payment-name-field">الاسم الذي سيتم تحويل الدفع منه
                  <input name="customerName" required placeholder="أدخل الاسم الكامل" pattern="[\\p{L}\\s.'-]{2,}" title="اكتب الاسم فقط بدون أرقام أو رموز" />
                </label>
                <div class="payment-list">
                  <article class="payment-method payment-app-card">
                    <header>
                      <img class="payment-app-icon" src="./assets/payments/alkuraimi.png" alt="" />
                      <div>
                        <h4>الكريمي</h4>
                        <small>تحويل عبر تطبيق الكريمي</small>
                      </div>
                    </header>
                    <div class="payment-accounts">
                      <div><span class="currency-chip yemen">🇾🇪</span><span>يمني</span><strong dir="ltr">3044964421</strong><button type="button" class="copy-account-button" data-copy-account="3044964421" aria-label="نسخ حساب يمني"><i data-lucide="copy"></i></button><b></b></div>
                      <div><span class="currency-chip saudi">🇸🇦</span><span>سعودي</span><strong dir="ltr">3046866826</strong><button type="button" class="copy-account-button" data-copy-account="3046866826" aria-label="نسخ حساب سعودي"><i data-lucide="copy"></i></button><b></b></div>
                      <div><span class="currency-chip dollar">$</span><span>دولار</span><strong dir="ltr">3155726538</strong><button type="button" class="copy-account-button" data-copy-account="3155726538" aria-label="نسخ حساب دولار"><i data-lucide="copy"></i></button><b></b></div>
                    </div>
                  </article>
                  <article class="payment-method payment-app-card">
                    <header>
                      <img class="payment-app-icon" src="./assets/payments/jeeb.png" alt="" />
                      <div>
                        <h4>جيب</h4>
                        <small>تحويل عبر محفظة الجوال</small>
                      </div>
                    </header>
                    <div class="payment-accounts">
                      <div><span class="currency-chip wallet"><i data-lucide="wallet"></i></span><span>جوال</span><strong dir="ltr">778530052</strong><button type="button" class="copy-account-button" data-copy-account="778530052" aria-label="نسخ حساب جيب"><i data-lucide="copy"></i></button><b></b></div>
                    </div>
                  </article>
                  <article class="payment-method payment-app-card">
                    <header>
                      <img class="payment-app-icon" src="./assets/payments/floosak.png" alt="" />
                      <div>
                        <h4>فلوسك</h4>
                        <small>تحويل عبر تطبيق فلوسك</small>
                      </div>
                    </header>
                    <div class="payment-accounts">
                      <div><span class="currency-chip wallet"><i data-lucide="wallet"></i></span><span>جوال</span><strong dir="ltr">778530052</strong><button type="button" class="copy-account-button" data-copy-account="778530052" aria-label="نسخ حساب فلوسك"><i data-lucide="copy"></i></button><b></b></div>
                    </div>
                  </article>
                </div>
                <div class="activation-info-box">
                  <i data-lucide="info"></i>
                  <ul>
                    <li>بعد التحويل يرجى الضغط على تم الدفع.</li>
                    <li>تأكد من كتابة الاسم الصحيح عند التحويل.</li>
                    <li>سيتم إنشاء كود مؤقت حتى يتم اعتماد الاشتراك.</li>
                  </ul>
                </div>
                <button class="activation-gradient-button activation-paid-button" type="submit"><i data-lucide="badge-check"></i>تم الدفع</button>
              </section>
            </form>
            <div class="license-code-box" id="temporary-code-box" hidden></div>
          `}
      </article>
    </section>
  `;
  qs("#free-trial-button")?.addEventListener("click", async () => {
    const result = await app.services.license.startFreeTrial();
    app.services.toast.show(result.message, result.valid ? "success" : "error");
    if (result.valid) location.hash = "#/home";
  });
  qs("#free-trial-used-button")?.addEventListener("click", () => {
    app.services.toast.show("لا تستطيع الدخول بالوضع المجاني مرة أخرى. التجربة المجانية متاحة ليوم واحد فقط لكل جهاز.", "warning");
  });
  qs("#activation-support-button")?.addEventListener("click", () => openActivationSupport());
  qs("#show-install-guide")?.addEventListener("click", () => openInstallGuide());
  qs("#open-active-app")?.addEventListener("click", async () => {
    const openButton = qs("#open-active-app");
    const resetOpenLoading = setButtonLoading(openButton, "جاري فتح التطبيق...");
    try {
      await app.services.license.checkAccess?.().catch(() => {});
      if (!app.services.license.isActive()) {
        app.services.toast.show("انتهى التفعيل. أدخل كود تفعيل جديد للمتابعة.", "error");
        renderActivation();
        return;
      }
      openHomeNow();
    } finally {
      resetOpenLoading();
    }
  });
  const openActivationPaymentScreen = () => {
    const form = qs("#activation-request-form");
    const screen = qs("#activation-payment-screen");
    if (!form || !screen) return;
    form.hidden = false;
    form.classList.add("payment-screen-open");
    screen.hidden = false;
    (screen || form).scrollIntoView({ behavior: "smooth", block: "start" });
    updateActivationPlanPreview();
    renderIcons();
  };
  qs("#show-request-form")?.addEventListener("click", openActivationPaymentScreen);
  qs("[data-open-payment-request]")?.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    openActivationPaymentScreen();
  });
  qs("#show-payment-details")?.addEventListener("click", () => {
    const form = qs("#activation-request-form");
    const screen = qs("#activation-payment-screen");
    if (!form || !screen) return;
    form.classList.add("payment-screen-open");
    screen.hidden = false;
    screen.scrollIntoView({ behavior: "smooth", block: "start" });
    renderIcons();
  });
  qs("#payment-back-button")?.addEventListener("click", () => {
    const form = qs("#activation-request-form");
    const screen = qs("#activation-payment-screen");
    if (!form || !screen) return;
    screen.hidden = true;
    form.classList.remove("payment-screen-open");
    form.hidden = true;
    qs("#license-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  const syncPlanPreview = () => updateActivationPlanPreview();
  document.querySelectorAll("[data-activation-role]").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll("[data-activation-role]").forEach((item) => item.classList.toggle("active", item === button));
    const roleInput = qs("#activation-role");
    if (roleInput) roleInput.value = button.dataset.activationRole;
    const planSelect = qs('select[name="requestedPlan"]');
    const slots = qs("#teacher-slots")?.value ?? 0;
    const currency = qs("#activation-currency")?.value || "SAR";
    planSelect.innerHTML = activationPlanOptions(button.dataset.activationRole, app.services.license.getActivationPricing(), "", slots, currency);
    syncPlanPreview();
  }));
  qs('select[name="requestedPlan"]')?.addEventListener("change", syncPlanPreview);
  qs("#activation-currency")?.addEventListener("change", () => {
    const role = qs("#activation-role")?.value || "teacher";
    const planSelect = qs('select[name="requestedPlan"]');
    const slots = qs("#teacher-slots")?.value ?? 0;
    const currency = qs("#activation-currency")?.value || "SAR";
    if (planSelect) planSelect.innerHTML = activationPlanOptions(role, app.services.license.getActivationPricing(), planSelect.value, slots, currency);
    syncPlanPreview();
  });
  qs("#teacher-slots")?.addEventListener("input", () => {
    const input = qs("#teacher-slots");
    input.value = input.value.replace(/\D/g, "");
    const role = qs("#activation-role")?.value || "teacher";
    const planSelect = qs('select[name="requestedPlan"]');
    const slots = qs("#teacher-slots")?.value ?? 0;
    const currency = qs("#activation-currency")?.value || "SAR";
    if (planSelect) planSelect.innerHTML = activationPlanOptions(role, app.services.license.getActivationPricing(), planSelect.value, slots, currency);
    syncPlanPreview();
  });
  qs("#teacher-slots")?.addEventListener("focus", (event) => {
    if (event.target.value === "0") event.target.value = "";
  });
  qs("#teacher-slots")?.addEventListener("blur", (event) => {
    event.target.value = event.target.value.replace(/\D/g, "");
    if (event.target.value === "") {
      event.target.value = "0";
      updateActivationPlanPreview();
    }
  });
  qs('input[name="customerName"]')?.addEventListener("input", (event) => {
    event.target.value = event.target.value.replace(/[^\p{L}\s.'-]/gu, "");
  });
  app.services.license.loadRemoteActivationPricing?.().then(() => {
    const remotePricing = app.services.license.getActivationPricing();
    const currencyInput = qs("#activation-currency");
    if (currencyInput) currencyInput.value = remotePricing.currency || "SAR";
    const currencyLabel = qs("#activation-currency-label");
    if (currencyLabel) currencyLabel.textContent = remotePricing.currency === "YER" ? "ريال يمني" : "ريال سعودي";
    const role = qs("#activation-role")?.value || "teacher";
    const planSelect = qs('select[name="requestedPlan"]');
    const slots = qs("#teacher-slots")?.value ?? 0;
    const currency = remotePricing.currency || "SAR";
    if (planSelect) planSelect.innerHTML = activationPlanOptions(role, remotePricing, planSelect.value, slots, currency);
    updateActivationPlanPreview();
  }).catch(() => {});
  document.querySelectorAll("[data-copy-account]").forEach((button) => button.addEventListener("click", async () => {
    await copyText(button.dataset.copyAccount);
    app.services.toast.show("تم نسخ رقم الحساب", "success");
  }));
  qs("#activation-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    const submitButton = event.submitter || event.target.querySelector("button");
    const resetLoading = setButtonLoading(submitButton, "جاري التفعيل...");
    try {
      const result = await app.services.license.activate(data.code);
      if (!result.valid) {
        app.services.toast.show(result.message, "error");
        return;
      }
      if (result.accessMode) {
        const activeAfterActivation = app.services.license.getActiveLicense();
        await app.services.store.switchAccount(activeAfterActivation?.code || data.code, {
          ...(result.ownerName ? { teacherName: result.ownerName } : {}),
          accessMode: result.accessMode,
          readOnlyMode: result.accessMode === "readonly"
        });
        if (result.ownerName) updateTeacherChip();
        applyAccessMode(result.accessMode);
      }
      app.services.toast.show(result.message, "success");
      app.services.sync.scheduleManagedAccountSync(0);
      openHomeNow();
    } finally {
      resetLoading();
    }
  });
  qs("#activation-request-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const ok = await app.services.modal.confirm({
      title: "تأكيد الدفع",
      message: "هل أنت متأكد من إتمام عملية التحويل؟",
      confirmLabel: "نعم",
      cancelLabel: "إلغاء",
      danger: false
    });
    if (!ok) return;
    const data = Object.fromEntries(new FormData(event.target));
    const submitButton = event.submitter || event.target.querySelector("button.primary-button");
    const resetLoading = setButtonLoading(submitButton, "جاري حفظ الطلب...");
    try {
      const result = await app.services.license.createActivationRequest(data);
      if (!result.ok) return app.services.toast.show(result.message, "error");
      await app.services.store.updateSettings({ teacherName: result.request.customerName });
      updateTeacherChip();
      const requestForm = qs("#activation-request-form");
      const paymentScreen = qs("#activation-payment-screen");
      if (paymentScreen) paymentScreen.hidden = true;
      if (requestForm) {
        requestForm.classList.remove("payment-screen-open");
        requestForm.hidden = true;
      }
      qs("#temporary-code-box").hidden = false;
      if (result.needsPaymentReview) {
        qs("#temporary-code-box").innerHTML = `
          <span>تحقق من الدفع</span>
          <strong>بانتظار موافقة صاحب التطبيق</strong>
          <p class="muted">للأسف في المرة الأولى لم يتم تأكيد الدفع. هذه المرة لن يتم فتح التطبيق حتى يسمح صاحب التطبيق بعد مراجعة التحويل.</p>
          <div class="activation-temp-actions">
            <button class="status-button" id="copy-temp-code" type="button">نسخ رقم الطلب</button>
          </div>
        `;
        qs("#copy-temp-code").addEventListener("click", async () => {
          await copyText(result.request.code);
          app.services.toast.show("تم نسخ رقم الطلب", "success");
        });
        app.services.toast.show(result.message, "error");
        return;
      }
      qs("#temporary-code-box").innerHTML = `
        <div class="temporary-code-card">
          <span class="temporary-code-label">كود مؤقت لمدة يوم واحد</span>
          <strong class="temporary-code-value">${result.request.code}</strong>
          <div class="activation-temp-actions">
            <button class="status-button" id="copy-temp-code" type="button"><i data-lucide="copy"></i>نسخ الكود</button>
            <button class="primary-button compact-action" id="open-temp-app" type="button"><span>فتح التطبيق الآن</span><i data-lucide="rocket"></i></button>
          </div>
        </div>
      `;
      renderIcons();
      qs("#copy-temp-code").addEventListener("click", async () => {
        await copyText(result.request.code);
        app.services.toast.show("تم نسخ الكود المؤقت", "success");
      });
      qs("#open-temp-app").addEventListener("click", async () => {
        const openButton = qs("#open-temp-app");
        const resetOpenLoading = setButtonLoading(openButton, "جاري فتح التطبيق...");
        try {
          const activation = app.services.license.activateTemporaryRequest(result.request);
          if (!activation.valid) {
            app.services.toast.show(activation.message, "error");
            return;
          }
          const activeAfterTemporary = app.services.license.getActiveLicense();
          await app.services.store.switchAccount(activeAfterTemporary?.code || result.request.code, {
            ...(activation.ownerName ? { teacherName: activation.ownerName } : {}),
            accessMode: activation.accessMode || "teacher",
            readOnlyMode: activation.accessMode === "readonly"
          });
          if (activation.ownerName) updateTeacherChip();
          applyAccessMode(activation.accessMode || "teacher");
          app.services.toast.show("تم تفعيل الكود المؤقت لمدة يوم واحد", "success");
          app.services.sync.scheduleManagedAccountSync(0);
          openHomeNow();
        } catch (error) {
          app.services.toast.show(`تعذر فتح التطبيق: ${readableError(error)}`, "error");
        } finally {
          resetOpenLoading();
        }
      });
      app.services.toast.show("تم إنشاء الطلب وحفظ الكود المؤقت", "success");
      requestAnimationFrame(() => {
        qs("#temporary-code-box")?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    } catch (error) {
      app.services.toast.show(`تعذر حفظ الطلب: ${readableError(error)}`, "error");
    } finally {
      resetLoading();
    }
  });
  updateActivationPlanPreview();
  renderIcons();
}

function openActivationSupport() {
  const options = [
    ["activation", "مشكلة في التفعيل", "تعذر إدخال الكود أو فتح التطبيق.", "key-round"],
    ["payment", "مشكلة في الدفع", "تواصل ببيانات الحوالة واسم المحول.", "credit-card"],
    ["plans", "استفسار عن الاشتراكات", "عرض أسعار المعلم والمشرف والمندوب.", "badge-dollar-sign"],
    ["technical", "مشكلة تقنية", "الحضور أو الدرجات أو PDF أو خطأ داخل التطبيق.", "triangle-alert"],
    ["direct", "التواصل المباشر", "فتح واتساب للتواصل مع الدعم مباشرة.", "message-circle"]
  ];
  app.services.modal.open({
    title: "الدعم",
    body: `
      <div class="activation-support-modal">
        <p class="muted">كيف يمكننا مساعدتك؟ اختر نوع الطلب وسيتم تجهيز رسالة واتساب مرتبة.</p>
        <div class="support-option-grid">
          ${options.map(([id, title, text, icon]) => `
            <button class="support-option-card" type="button" data-support-type="${id}">
              <i data-lucide="${icon}"></i>
              <strong>${title}</strong>
              <span>${text}</span>
            </button>
          `).join("")}
        </div>
      </div>
    `
  });
  app.services.modal.root.querySelectorAll("[data-support-type]").forEach((button) => {
    button.addEventListener("click", () => openSupportType(button.dataset.supportType));
  });
  renderIcons();
}

function openSupportType(type) {
  if (type === "direct") {
    openWhatsAppSupport(["مرحبًا، أريد التواصل مع دعم تطبيق يُسر."]);
    return;
  }
  if (type === "plans") return openSupportPlans();

  const problemOptions = type === "technical"
    ? `
      <label>نوع المشكلة
        <select class="field" name="problemType">
          <option>التطبيق لا يفتح</option>
          <option>خطأ أثناء التفعيل</option>
          <option>مشكلة في الحضور</option>
          <option>مشكلة في الدرجات</option>
          <option>مشكلة في التصدير PDF</option>
          <option>مشكلة أخرى</option>
        </select>
      </label>
    `
    : "";
  const roleAndPlan = type === "activation"
    ? `
      <label>نوع الحساب
        <select class="field" name="role" id="support-role-select">
          <option value="teacher">معلم</option>
          <option value="admin">مشرف</option>
          <option value="delegate">مندوب</option>
        </select>
      </label>
      <label>نوع الاشتراك
        <select class="field" name="plan" id="support-plan-select">
          ${supportPlanOptions("teacher")}
        </select>
      </label>
    `
    : "";
  const paymentHint = type === "payment"
    ? `<p class="support-attachment-hint"><i data-lucide="image-plus"></i>إذا لديك صورة للحوالة، افتح واتساب ثم أرفقها داخل المحادثة.</p>`
    : "";
  app.services.modal.open({
    title: type === "payment" ? "مشكلة في الدفع" : type === "technical" ? "مشكلة تقنية" : "مشكلة في التفعيل",
    body: `
      <form class="support-form" id="support-form">
        <label>الاسم
          <input class="field" name="name" placeholder="اكتب اسمك الكامل" required />
        </label>
        ${roleAndPlan}
        ${problemOptions}
        ${type === "payment" ? `<label>اسم المحول<input class="field" name="payerName" placeholder="اكتب الاسم الذي تم التحويل به" required /></label>` : ""}
        <label>وصف المشكلة
          <textarea class="field" name="description" rows="4" placeholder="اكتب التفاصيل هنا"></textarea>
        </label>
        ${paymentHint}
        <button class="primary-button full-width" type="submit"><i data-lucide="send"></i>إرسال للدعم واتساب</button>
      </form>
    `
  });
  const form = app.services.modal.root.querySelector("#support-form");
  const roleSelect = app.services.modal.root.querySelector("#support-role-select");
  const planSelect = app.services.modal.root.querySelector("#support-plan-select");
  roleSelect?.addEventListener("change", () => {
    if (!planSelect) return;
    planSelect.innerHTML = supportPlanOptions(roleSelect.value);
  });
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const title = type === "payment" ? "مشكلة في الدفع" : type === "technical" ? "مشكلة تقنية" : "مشكلة في التفعيل";
    const lines = [
      `طلب دعم: ${title}`,
      `الاسم: ${data.name || "-"}`,
      data.role ? `نوع الحساب: ${supportRoleLabel(data.role)}` : "",
      data.plan ? `نوع الاشتراك: ${supportPlanLabel(data.plan)}` : "",
      data.payerName ? `اسم المحول: ${data.payerName}` : "",
      data.problemType ? `نوع المشكلة: ${data.problemType}` : "",
      `وصف المشكلة: ${data.description || "-"}`
    ].filter(Boolean);
    openWhatsAppSupport(lines);
  });
  renderIcons();
}

function openSupportPlans() {
  const pricing = app.services.license.getActivationPricing();
  const currency = pricing.currency || "SAR";
  const roles = [
    ["teacher", "المعلم", "إدارة المواد والطلاب والتحضير والدرجات حسب الصلاحية."],
    ["admin", "المشرف", "إدارة المعلمين والمندوبين والتقارير والسلوك والمواظبة."],
    ["delegate", "المندوب", "متابعة الحضور والحصص والطلاب حسب الصلاحية."]
  ];
  const plans = ["week", "month", "year"];
  app.services.modal.open({
    title: "أسعار الاشتراكات",
    body: `
      <div class="support-plans">
        ${roles.map(([role, label, text]) => `
          <article>
            <h3>${label}</h3>
            <p>${text}</p>
            <div class="support-price-list">
              ${plans.filter((plan) => !(role === "admin" && plan === "week")).map((plan) => {
                const quote = app.services.license.calculateActivationPrice(role, plan, 0, currency);
                return `<span><b>${quote.plan.label}</b><strong>${quote.label}</strong></span>`;
              }).join("")}
            </div>
            ${role === "admin" ? `<small>اشتراك المشرف يزيد حسب عدد المعلمين الإضافيين كما هو محدد في صفحة الدفع.</small>` : ""}
          </article>
        `).join("")}
        <button class="primary-button full-width" id="support-open-payment" type="button"><i data-lucide="wallet"></i>الانتقال إلى صفحة الدفع</button>
      </div>
    `
  });
  app.services.modal.root.querySelector("#support-open-payment")?.addEventListener("click", () => {
    app.services.modal.close();
    qs("#show-request-form")?.click();
  });
  renderIcons();
}

function supportPlanOptions(role = "teacher") {
  const plans = role === "admin"
    ? [["month", "شهري"], ["year", "سنوي"]]
    : [["week", "أسبوعي"], ["month", "شهري"], ["year", "سنوي"]];
  return plans.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
}

function supportRoleLabel(role) {
  if (role === "admin") return "مشرف";
  if (role === "delegate") return "مندوب";
  return "معلم";
}

function supportPlanLabel(plan) {
  if (plan === "week") return "أسبوعي";
  if (plan === "month") return "شهري";
  if (plan === "year") return "سنوي";
  return plan || "-";
}

function openWhatsAppSupport(lines) {
  const text = encodeURIComponent(lines.join("\n"));
  window.open(`https://wa.me/967778530052?text=${text}`, "_blank", "noopener");
}

function openInstallGuide() {
  const steps = [
    ["step-1.png", "الخطوة 1", "افتح رابط التطبيق من متصفح Google Chrome."],
    ["step-2.png", "الخطوة 2", "اضغط على قائمة المتصفح من الأعلى أو الأسفل حسب نوع الهاتف."],
    ["step-3.png", "الخطوة 3", "اختر تثبيت التطبيق أو إضافة إلى الشاشة الرئيسية."],
    ["step-4.png", "الخطوة 4", "اضغط تثبيت لتأكيد إضافة تطبيق يُسر."],
    ["step-5.png", "الخطوة 5", "سيظهر تطبيق يُسر على الشاشة الرئيسية مثل أي تطبيق عادي."]
  ];
  app.services.modal.open({
    title: "كيف أثبت التطبيق؟",
    body: `
      <div class="install-guide-modal" data-step="0" data-direction="next">
        <div class="install-guide-phone">
          ${steps.map(([image, title, text], index) => `
            <figure class="install-guide-slide ${index === 0 ? "active" : ""}" data-install-slide="${index}">
              <img src="./assets/install-guide/${image}" alt="${title}" />
              <figcaption>
                <strong>${title}</strong>
                <span>${text}</span>
              </figcaption>
            </figure>
          `).join("")}
        </div>
        <div class="install-guide-controls">
          <button class="ghost-button" id="install-prev" type="button"><i data-lucide="chevron-right"></i>السابق</button>
          <div class="install-guide-dots">${steps.map((_, index) => `<button class="${index === 0 ? "active" : ""}" data-install-dot="${index}" aria-label="خطوة ${index + 1}"></button>`).join("")}</div>
          <button class="primary-button" id="install-next" type="button">التالي<i data-lucide="chevron-left"></i></button>
        </div>
      </div>
    `
  });
  let step = 0;
  const root = app.services.modal.root;
  const update = (nextStep) => {
    const boundedStep = Math.max(0, Math.min(steps.length - 1, nextStep));
    const guide = root.querySelector(".install-guide-modal");
    if (guide) {
      guide.dataset.direction = boundedStep >= step ? "next" : "prev";
      guide.dataset.step = String(boundedStep);
    }
    step = boundedStep;
    root.querySelectorAll("[data-install-slide]").forEach((slide, index) => slide.classList.toggle("active", index === step));
    root.querySelectorAll("[data-install-dot]").forEach((dot, index) => dot.classList.toggle("active", index === step));
    const next = root.querySelector("#install-next");
    const prev = root.querySelector("#install-prev");
    if (next) next.innerHTML = step === steps.length - 1 ? `تم<i data-lucide="check"></i>` : `التالي<i data-lucide="chevron-left"></i>`;
    if (prev) prev.disabled = step === 0;
    renderIcons();
  };
  root.querySelector("#install-next")?.addEventListener("click", () => {
    if (step === steps.length - 1) {
      cleanupInstallKeys();
      return app.services.modal.close();
    }
    update(step + 1);
  });
  root.querySelector("#install-prev")?.addEventListener("click", () => update(step - 1));
  root.querySelectorAll("[data-install-dot]").forEach((dot) => dot.addEventListener("click", () => update(Number(dot.dataset.installDot))));
  const handleInstallKeys = (event) => {
    if (!root.querySelector(".install-guide-modal")) return;
    if (event.key === "ArrowLeft") update(step + 1);
    if (event.key === "ArrowRight") update(step - 1);
  };
  document.addEventListener("keydown", handleInstallKeys);
  const cleanupInstallKeys = () => document.removeEventListener("keydown", handleInstallKeys);
  root.querySelector("[data-modal-close]")?.addEventListener("click", cleanupInstallKeys, { once: true });
  const phone = root.querySelector(".install-guide-phone");
  let swipeStartX = 0;
  let swipeStartY = 0;
  phone?.addEventListener("touchstart", (event) => {
    const touch = event.touches?.[0];
    if (!touch) return;
    swipeStartX = touch.clientX;
    swipeStartY = touch.clientY;
  }, { passive: true });
  phone?.addEventListener("touchend", (event) => {
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    const deltaX = touch.clientX - swipeStartX;
    const deltaY = touch.clientY - swipeStartY;
    if (Math.abs(deltaX) < 42 || Math.abs(deltaX) < Math.abs(deltaY)) return;
    update(step + (deltaX > 0 ? -1 : 1));
  }, { passive: true });
  update(0);
  renderIcons();
}

function updateActivationPlanPreview() {
  const role = qs("#activation-role")?.value || "teacher";
  const plan = qs('select[name="requestedPlan"]')?.value || "week";
  const slots = qs("#teacher-slots")?.value ?? 0;
  const currency = qs("#activation-currency")?.value || "SAR";
  const slotsField = qs("#teacher-slots-field");
  if (slotsField) {
    const showSlots = role === "admin";
    slotsField.hidden = !showSlots;
    slotsField.style.display = showSlots ? "" : "none";
  }
  const quote = app.services.license.calculateActivationPrice(role, plan, slots, currency);
  const price = qs("#plan-price");
  const preview = qs("#plan-preview");
  if (price) price.textContent = `السعر: ${quote.label}`;
  if (preview) {
    preview.innerHTML = `
      <span>الباقة المختارة</span>
      <strong>${quote.role.label} · ${quote.plan.label}${quote.role.id === "admin" ? ` · ${quote.teacherSlots} معلم إضافي` : ""}</strong>
      <p>${quote.label}${quote.role.id === "admin" && quote.teacherSlots > 0 ? " شامل زيادة المعلمين" : ""}</p>
    `;
  }
}

function activationPlanOptions(role, pricing, selected = "", teacherSlots = 0, currency = qs("#activation-currency")?.value || "SAR") {
  const plans = role === "admin"
    ? [["month", "شهر"], ["year", "سنة"]]
    : [["week", "أسبوع"], ["month", "شهر"], ["year", "سنة"]];
  return plans.map(([value, label]) => {
    const quote = app.services.license.calculateActivationPrice(role, value, teacherSlots, currency);
    const shortLabel = value === "week" ? "أسبوعي" : value === "month" ? "شهري" : value === "year" ? "سنوي" : label;
    return `<option value="${value}" ${value === selected ? "selected" : ""}>${shortLabel} - ${quote.label}</option>`;
  }).join("");
}

function setButtonLoading(button, label = "جاري التنفيذ...") {
  if (!button) return () => {};
  const original = button.innerHTML;
  const wasDisabled = button.disabled;
  button.disabled = true;
  button.classList.add("is-loading");
  button.innerHTML = `<span class="button-spinner" aria-hidden="true"></span><span>${label}</span>`;
  return () => {
    button.disabled = wasDisabled;
    button.classList.remove("is-loading");
    button.innerHTML = original;
    renderIcons();
  };
}

function openHomeNow() {
  if (location.hash === "#/home") {
    route();
    return;
  }
  location.hash = "#/home";
}

function readableError(error) {
  const message = String(error?.message || error || "");
  if (message.includes("row-level security")) return "صلاحيات RLS في Supabase تمنع حفظ الطلب";
  if (message.includes("foreign key")) return "هناك علاقة غير مكتملة مع جدول licenses";
  if (message.includes("activation_requests")) return "جدول activation_requests غير جاهز";
  if (message.includes("duplicate key")) return "يوجد طلب بنفس البيانات مسبقًا";
  return message.slice(0, 140) || "خطأ غير معروف";
}

async function copyText(text) {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {}
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

bootstrap();
