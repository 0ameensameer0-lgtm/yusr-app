export class SyncService {
  constructor(store, firebase, toast, license) {
    this.store = store;
    this.firebase = firebase;
    this.toast = toast;
    this.license = license;
    this.syncTimer = null;
    this.periodicTimer = null;
    this.syncInProgress = false;
    this.syncPromise = null;
    this.lastAssignmentMarker = "";
    this.lastPublishedAssignmentMarkers = new Map();
    this.lastSyncError = "";
  }

  async start() {
    window.addEventListener("online", () => {
      this.toast.show("عاد الاتصال، ستتم مزامنة البيانات تلقائيًا", "success");
      this.scheduleManagedAccountSync(200);
    });
    window.addEventListener("offline", () => this.toast.show("أنت تعمل دون اتصال، سيتم الحفظ محليًا", "info"));
    if (!navigator.onLine) this.toast.show("الوضع دون اتصال مفعل", "info");

    // أي تعديل في المواد أو الطلاب أو التحضير يشغل مزامنة قصيرة بعد توقف الكتابة.
    window.addEventListener("store-updated", () => {
      const mode = this.license?.getActiveLicense?.()?.accessMode;
      this.scheduleManagedAccountSync(mode === "admin" ? 150 : 600);
    });
    this.scheduleManagedAccountSync(800);
    this.periodicTimer = setInterval(() => this.scheduleManagedAccountSync(200), 30000);
  }

  scheduleManagedAccountSync(delay = 1200) {
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => this.syncManagedAccountData(), delay);
  }

  async syncManagedAccountData() {
    if (this.syncInProgress) return this.syncPromise;
    const activeLicense = this.license?.getActiveLicense?.();
    if (!activeLicense) return;

    this.syncInProgress = true;
    this.syncPromise = (async () => {
      try {
        if (activeLicense.accessMode === "admin") {
          await this.publishSupervisorAssignments(activeLicense);
        } else if (isManagedChildLicense(activeLicense)) {
          await this.applySupervisorAssignments(activeLicense);
          await this.publishChildProgress(activeLicense);
        }
        this.lastSyncError = "";
      } catch (error) {
        this.rememberSyncError(error);
      } finally {
        this.syncInProgress = false;
        this.syncPromise = null;
      }
    })();
    return this.syncPromise;
  }

  async publishSupervisorAssignments(activeLicense) {
    const parentCode = normalizeCode(activeLicense.code);
    if (!parentCode) return;
    const accounts = await this.license.listManagedCodesWithUsage(parentCode).catch(() => []);
    if (!accounts.length) return;
    if (accounts.length === 1) {
      const onlyAccount = accounts[0];
      this.store.assignUnlinkedSubjectsToAccount?.(onlyAccount.code, onlyAccount.ownerName || "");
    }

    for (const account of accounts) {
      const accountCode = normalizeCode(account.code);
      if (!accountCode) continue;
      const assignment = this.store.exportAssignmentForAccount(accountCode, account.ownerName || "");
      const assignmentMarker = assignmentSignature(assignment.data);
      if (this.lastPublishedAssignmentMarkers.get(accountCode) === assignmentMarker) continue;
      const existingRow = await this.license.getManagedAccountData(accountCode).catch(() => null);
      const existingData = existingRow?.data && typeof existingRow.data === "object" ? existingRow.data : {};
      const nextData = {
        ...existingData,
        institutions: assignment.data.institutions || [],
        subjects: assignment.data.subjects || [],
        students: mergeStudentsBySubject(assignment.data.students || {}, existingData.students || {}),
        schedule: assignment.data.schedule || [],
        gradeColumns: assignment.data.gradeColumns || {},
        assignmentUpdatedAt: new Date().toISOString(),
        settings: {
          ...(existingData.settings || {}),
          teacherName: account.ownerName || existingData.settings?.teacherName || ""
        }
      };

      const saveResult = await this.license.saveManagedAccountData({
        code: accountCode,
        parentCode,
        ownerName: account.ownerName || existingRow?.owner_name || "",
        accessMode: account.accessMode || "teacher",
        data: nextData
      });
      if (!saveResult?.remoteSkipped && !saveResult?.localOnly) this.lastPublishedAssignmentMarkers.set(accountCode, assignmentMarker);
    }
  }

  async applySupervisorAssignments(activeLicense) {
    const row = await this.license.getManagedAccountData(activeLicense.code).catch(() => null);
    const data = row?.data && typeof row.data === "object" ? row.data : null;
    if (!data || !Array.isArray(data.subjects)) {
      await this.applyManagedOwnerName(activeLicense, row?.owner_name);
      return;
    }

    const marker = [
      data.assignmentUpdatedAt || row?.updated_at || "",
      data.subjects.map((subject) => subject.id).join("|"),
      Object.values(data.students || {}).flat().length,
      (data.schedule || []).length
    ].join("::");
    if (marker === this.lastAssignmentMarker) {
      await this.applyManagedOwnerName(activeLicense, row?.owner_name);
      return;
    }

    const result = await this.store.importAssignmentForActiveAccount({
      app: "yusr-teacher-assignment",
      version: 1,
      accountCode: activeLicense.code,
      accountName: row?.owner_name || activeLicense.ownerName || "",
      data: {
        institutions: data.institutions || [],
        subjects: data.subjects || [],
        students: data.students || {},
        schedule: data.schedule || [],
        gradeColumns: data.gradeColumns || {},
        studentRequests: data.studentRequests || []
      }
    }, activeLicense);

    if (result.ok) {
      this.lastAssignmentMarker = marker;
      window.dispatchEvent(new CustomEvent("managed-assignment-updated"));
    }
    await this.applyManagedOwnerName(activeLicense, row?.owner_name);
  }

  async publishChildProgress(activeLicense) {
    const parentCode = normalizeCode(activeLicense.parentCode);
    if (!parentCode) return;
    const state = this.store.exportState().data;
    const ownerName = String(activeLicense.ownerName || state.settings?.teacherName || "").trim();
    state.childActivatedAt = activeLicense.activatedAt || new Date().toISOString();
    state.childDeviceId = activeLicense.deviceId || this.license.getDeviceId?.() || "";
    state.settings = {
      ...(state.settings || {}),
      teacherName: ownerName || state.settings?.teacherName || ""
    };

    await this.license.saveManagedAccountData({
      code: activeLicense.code,
      parentCode,
      accessMode: activeLicense.accessMode,
      ownerName,
      data: state
    });
  }

  async applyManagedOwnerName(activeLicense, rowName = "") {
    const ownerName = String(rowName || activeLicense.ownerName || "").trim();
    if (!ownerName) return;
    const currentName = String(this.store.getSettings().teacherName || "").trim();
    if (currentName === ownerName) return;
    await this.store.updateSettings({ teacherName: ownerName });
  }

  rememberSyncError(error) {
    const message = String(error?.message || error || "");
    if (message && message !== this.lastSyncError) {
      this.lastSyncError = message;
      console.warn(syncErrorMessage(message), error);
    }
  }
}

function isManagedChildLicense(license = null) {
  const mode = license?.accessMode;
  return Boolean(["teacher", "delegate"].includes(mode) && normalizeCode(license?.parentCode));
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function mergeStudentsBySubject(primary = {}, secondary = {}) {
  const subjectIds = new Set([...Object.keys(primary || {}), ...Object.keys(secondary || {})]);
  return Object.fromEntries([...subjectIds].map((subjectId) => [
    subjectId,
    mergeStudentRows(primary?.[subjectId] || [], secondary?.[subjectId] || [], subjectId)
  ]));
}

function mergeStudentRows(primaryRows = [], secondaryRows = [], subjectId = "") {
  const merged = [];
  const seenIds = new Set();
  const seenNames = new Set();
  const add = (student) => {
    if (!student || typeof student !== "object") return;
    const id = String(student.id || "").trim();
    const nameKey = normalizeStudentName(student.name);
    if ((id && seenIds.has(id)) || (nameKey && seenNames.has(nameKey))) return;
    const nextId = id || crypto.randomUUID();
    merged.push({ ...student, id: nextId, subjectId: student.subjectId || subjectId });
    seenIds.add(nextId);
    if (nameKey) seenNames.add(nameKey);
  };
  primaryRows.forEach(add);
  secondaryRows.forEach(add);
  return merged;
}

function normalizeStudentName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ar");
}

function assignmentSignature(data = {}) {
  const subjects = (data.subjects || []).map((subject) => ({
    id: subject.id,
    name: subject.name,
    assignedTeacherCode: normalizeCode(subject.assignedTeacherCode)
  }));
  const students = Object.fromEntries(Object.entries(data.students || {}).map(([subjectId, list]) => [
    subjectId,
    (list || []).map((student) => [student.id, student.name, student.notes, student.guardianPhone])
  ]));
  const schedule = (data.schedule || []).map((item) => [item.subjectId, item.day, item.start, item.end, item.sessionId]);
  const gradeColumns = Object.fromEntries(Object.entries(data.gradeColumns || {}).map(([subjectId, columns]) => [subjectId, (columns || []).map((column) => [column.id, column.name, column.max])]));
  return JSON.stringify({ subjects, students, schedule, gradeColumns });
}

function syncErrorMessage(message) {
  const lower = String(message || "").toLowerCase();
  if (lower.includes("row-level security") || lower.includes("violates row-level security")) {
    return "جدول managed_account_data موجود، لكن RLS يمنع حفظ بيانات الحسابات التابعة. عطّل RLS للجدول أو أضف سياسات الإضافة والتحديث.";
  }
  if (lower.includes("schema cache") || lower.includes("could not find")) {
    return "جدول managed_account_data أُضيف للتو. انتظر دقيقة ثم افتح التطبيق من جديد حتى يتحدث Supabase.";
  }
  if (lower.includes("invalid input") || lower.includes("json")) {
    return "تأكد أن عمود data نوعه jsonb وقيمته الافتراضية {} في managed_account_data.";
  }
  if (lower.includes("duplicate") || lower.includes("conflict")) {
    return "تأكد أن عمود code هو Primary key في جدول managed_account_data حتى يتم تحديث بيانات الحساب بدل تكرارها.";
  }
  return "تعذر مزامنة الحسابات التابعة. تأكد من جدول managed_account_data وصلاحياته في Supabase.";
}
