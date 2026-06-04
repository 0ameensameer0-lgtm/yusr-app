import { demoSubjects, defaultGradeColumns, defaultSchedule, defaultSettings } from "../utils/demo-data.js";
import { safeNumber } from "../utils/dom.js?v=35";

const STORAGE_KEY = "yusr-app-state-v1";
const ACCOUNT_STORAGE_PREFIX = "yusr-app-state-account-v1:";
const ACTIVE_STORE_ACCOUNT_KEY = "yusr-store-active-account-v1";
const DEMO_CLEANUP_VERSION = 2;
const DEFAULT_TEACHER_NAME = "م.أمين سمير أمين اليوسفي";

export async function createStore(firebase, licenseService = null) {
  const accountCode = normalizeCode(licenseService?.getActiveLicense?.()?.code || "");
  const saved = readStoredState(accountCode);
  const { state, changed } = prepareState(saved || createInitialState());
  const store = new Store(state, firebase, accountCode);
  if (changed) store.persist({ silent: true });
  return store;
}

class Store {
  constructor(state, firebase, accountCode = "") {
    this.state = state;
    this.firebase = firebase;
    this.accountCode = normalizeCode(accountCode);
  }

  storageKey() {
    return storageKeyForAccount(this.accountCode);
  }

  persist({ silent = false } = {}) {
    this.state.updatedAt = new Date().toISOString();
    localStorage.setItem(this.storageKey(), JSON.stringify(this.state));
    if (this.accountCode) localStorage.setItem(ACTIVE_STORE_ACCOUNT_KEY, this.accountCode);
    if (!silent) window.dispatchEvent(new CustomEvent("store-updated"));
  }

  async switchAccount(accountCode = "", settingsPatch = {}) {
    const normalized = normalizeCode(accountCode);
    if (normalized === this.accountCode) {
      if (Object.keys(settingsPatch || {}).length) await this.updateSettings(settingsPatch);
      return { ok: true, switched: false };
    }
    const saved = readStoredState(normalized);
    const { state } = prepareState(saved || createInitialState());
    this.accountCode = normalized;
    this.state = state;
    if (Object.keys(settingsPatch || {}).length) {
      this.state.settings = { ...this.state.settings, ...settingsPatch };
    }
    this.persist();
    return { ok: true, switched: true };
  }

  getSettings() { return this.state.settings; }
  async updateSettings(patch) {
    this.state.settings = { ...this.state.settings, ...patch };
    this.persist();
  }

  exportState() {
    return {
      app: "yusr",
      version: 1,
      exportedAt: new Date().toISOString(),
      data: structuredClone(this.state)
    };
  }

  async importState(payload) {
    const data = payload?.data || payload;
    if (!data || typeof data !== "object") return { ok: false, reason: "invalid" };
    const next = {
      ...createInitialState(),
      ...structuredClone(data),
      settings: { ...structuredClone(defaultSettings), ...(data.settings || {}) },
      subjects: Array.isArray(data.subjects) ? data.subjects : [],
      students: data.students && typeof data.students === "object" ? data.students : {},
      attendance: data.attendance && typeof data.attendance === "object" ? data.attendance : {},
      schedule: Array.isArray(data.schedule) ? data.schedule : [],
      institutions: Array.isArray(data.institutions) ? data.institutions : [],
      gradeColumns: data.gradeColumns && typeof data.gradeColumns === "object" ? data.gradeColumns : {},
      grades: data.grades && typeof data.grades === "object" ? data.grades : {},
      studentRequests: Array.isArray(data.studentRequests) ? data.studentRequests : [],
      behaviorViolations: Array.isArray(data.behaviorViolations) ? data.behaviorViolations : [],
      academicYears: Array.isArray(data.academicYears) ? data.academicYears : []
    };
    normalizeInstitutionScopes(next);
    this.state = next;
    this.persist();
    return { ok: true };
  }

  getAcademicYears() {
    this.ensureAcademicYears();
    return [...this.state.academicYears].sort((a, b) => String(b.label).localeCompare(String(a.label), "ar"));
  }

  getCurrentAcademicYear() {
    this.ensureAcademicYears();
    const currentId = this.state.settings.currentAcademicYearId;
    return this.state.academicYears.find((year) => year.id === currentId) || this.state.academicYears[0];
  }

  ensureAcademicYears() {
    this.state.academicYears ||= [];
    const currentLabel = this.state.settings.currentAcademicYearLabel || academicYearLabel();
    if (!this.state.academicYears.length) {
      const id = crypto.randomUUID();
      this.state.academicYears.push({
        id,
        label: currentLabel,
        status: "active",
        createdAt: new Date().toISOString(),
        archived: false,
        snapshot: null
      });
      this.state.settings.currentAcademicYearId = id;
      this.state.settings.currentAcademicYearLabel = currentLabel;
      this.persist({ silent: true });
    }
  }

  async startNewAcademicYear() {
    this.ensureAcademicYears();
    const current = this.getCurrentAcademicYear();
    if (current && !current.snapshot) {
      current.snapshot = this.academicSnapshot();
      current.status = current.status === "archived" ? "archived" : "saved";
      current.updatedAt = new Date().toISOString();
    }
    const label = nextAcademicYearLabel(current?.label || academicYearLabel());
    const id = crypto.randomUUID();
    this.state.academicYears.forEach((year) => {
      if (year.status === "active") year.status = year.archived ? "archived" : "saved";
    });
    this.state.academicYears.push({
      id,
      label,
      status: "active",
      archived: false,
      createdAt: new Date().toISOString(),
      snapshot: this.emptyAcademicSnapshot()
    });
    this.state.settings.currentAcademicYearId = id;
    this.state.settings.currentAcademicYearLabel = label;
    this.state.attendance = {};
    this.state.grades = {};
    this.persist();
    return { ok: true, label };
  }

  async archiveCurrentAcademicYear() {
    this.ensureAcademicYears();
    const current = this.getCurrentAcademicYear();
    if (!current) return { ok: false };
    current.archived = true;
    current.status = "archived";
    current.archivedAt = new Date().toISOString();
    current.snapshot = this.academicSnapshot();
    this.persist();
    return { ok: true, label: current.label };
  }

  previewAcademicTransfer(options = {}) {
    const source = this.getAcademicYears().find((year) => year.id === options.fromYearId);
    const snapshot = source?.snapshot || {};
    return {
      students: options.students ? Object.values(snapshot.students || {}).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0) : 0,
      subjects: options.subjects ? (snapshot.subjects || []).length : 0,
      teachers: options.teachers ? (snapshot.managedCodes || []).length : 0,
      lessons: options.lessons ? (snapshot.schedule || []).length : 0
    };
  }

  async transferAcademicYearData(options = {}) {
    const source = this.getAcademicYears().find((year) => year.id === options.fromYearId);
    const snapshot = source?.snapshot;
    if (!snapshot) return { ok: false, reason: "missing-source" };
    const duplicateMode = options.duplicateMode || "skip";
    if (options.subjects) {
      const existing = new Set((this.state.subjects || []).map((item) => normalizeName(item.name)));
      (snapshot.subjects || []).forEach((subject) => {
        const key = normalizeName(subject.name);
        const currentIndex = (this.state.subjects || []).findIndex((item) => normalizeName(item.name) === key);
        if (currentIndex >= 0 && duplicateMode === "update") this.state.subjects[currentIndex] = { ...this.state.subjects[currentIndex], ...subject };
        else if (!existing.has(key)) this.state.subjects.push({ ...subject });
      });
    }
    if (options.students) {
      Object.entries(snapshot.students || {}).forEach(([subjectId, list]) => {
        this.state.students[subjectId] ||= [];
        const existing = new Set(this.state.students[subjectId].map((student) => normalizeName(student.name)));
        (list || []).forEach((student) => {
          const key = normalizeName(student.name);
          const index = this.state.students[subjectId].findIndex((item) => normalizeName(item.name) === key);
          if (index >= 0 && duplicateMode === "update") this.state.students[subjectId][index] = { ...this.state.students[subjectId][index], ...student };
          else if (!existing.has(key)) this.state.students[subjectId].push({ ...student });
        });
      });
    }
    if (options.lessons) {
      const existing = new Set((this.state.schedule || []).map((lesson) => `${lesson.day}-${lesson.start}-${lesson.end}-${lesson.subjectId}`));
      (snapshot.schedule || []).forEach((lesson) => {
        const key = `${lesson.day}-${lesson.start}-${lesson.end}-${lesson.subjectId}`;
        if (!existing.has(key) || duplicateMode === "update") this.state.schedule.push({ ...lesson, id: crypto.randomUUID() });
      });
    }
    this.persist();
    return { ok: true, preview: this.previewAcademicTransfer(options) };
  }

  academicSnapshot() {
    return {
      subjects: structuredClone(this.state.subjects || []),
      students: structuredClone(this.state.students || {}),
      schedule: structuredClone(this.state.schedule || []),
      attendance: structuredClone(this.state.attendance || {}),
      grades: structuredClone(this.state.grades || {}),
      gradeColumns: structuredClone(this.state.gradeColumns || {}),
      institutions: structuredClone(this.state.institutions || {}),
      studentRequests: structuredClone(this.state.studentRequests || []),
      behaviorViolations: structuredClone(this.state.behaviorViolations || []),
      savedAt: new Date().toISOString()
    };
  }

  emptyAcademicSnapshot() {
    return {
      subjects: [],
      students: {},
      schedule: [],
      attendance: {},
      grades: {},
      gradeColumns: {},
      institutions: [],
      studentRequests: [],
      behaviorViolations: [],
      savedAt: new Date().toISOString()
    };
  }

  getInstitutionSummary(institutionId = undefined, license = null) {
    const scopeId = institutionId === undefined ? this.getActiveInstitutionId(license) : institutionId;
    const subjects = this.getSubjects(scopeId, license);
    const studentsCount = subjects.reduce((sum, subject) => sum + subject.studentsCount, 0);
    const attendanceRate = subjects.length
      ? Math.round(subjects.reduce((sum, subject) => sum + subject.attendanceRate, 0) / subjects.length)
      : 0;
    const lessons = this.getSchedule(scopeId, license);
    return {
      subjectsCount: subjects.length,
      studentsCount,
      attendanceRate,
      lessonsCount: lessons.length,
      nextLesson: lessons[0] || null
    };
  }

  globalSearch(query, license = null) {
    const term = normalizeName(query);
    if (!term) return { institutions: [], subjects: [], students: [], lessons: [] };
    const includes = (value) => normalizeName(value).includes(term);
    const visibleSubjects = this.filterSubjectsByLicense(this.state.subjects || [], license);
    const visibleSubjectIds = new Set(visibleSubjects.map((subject) => subject.id));
    const institutionIds = new Set(visibleSubjects.map((subject) => subject.institutionId).filter(Boolean));
    const institutions = this.getInstitutions(license).filter((item) => includes(item.name) || includes(item.type));
    const subjects = visibleSubjects
      .filter((subject) => includes(subject.name) || includes(subject.code) || includes(subject.room))
      .map((subject) => ({ ...subject, studentsCount: this.getStudents(subject.id).length, attendanceRate: this.getAttendanceRate(subject.id) }));
    const students = Object.entries(this.state.students || {}).flatMap(([subjectId, list]) => {
      if (!visibleSubjectIds.has(subjectId)) return [];
      const subject = this.getSubject(subjectId);
      return (list || [])
        .filter((student) => includes(student.name) || includes(student.notes))
        .map((student) => ({ ...student, subject }));
    });
    const lessons = this.getSchedule(null, license).filter((lesson) => {
      const subject = this.getSubject(lesson.subjectId);
      return includes(lesson.day) || includes(lesson.start) || includes(lesson.end) || includes(lesson.room) || includes(subject?.name);
    });
    return { institutions, subjects, students, lessons };
  }

  getActiveInstitutionId(license = null) {
    const institutions = this.getInstitutions(license);
    const activeId = this.state.settings.activeInstitutionId;
    if (activeId && institutions.some((item) => item.id === activeId)) return activeId;
    return institutions[0]?.id || null;
  }

  getActiveInstitution(license = null) {
    const activeId = this.getActiveInstitutionId(license);
    return this.getInstitutions(license).find((item) => item.id === activeId) || null;
  }

  async setActiveInstitution(id) {
    this.state.settings.activeInstitutionId = id || null;
    this.persist();
  }

  getSubjects(institutionId = undefined, license = null) {
    const scopeId = institutionId === undefined ? this.getActiveInstitutionId(license) : institutionId;
    return this.filterSubjectsByLicense(this.state.subjects || [], license)
      .filter((subject) => !scopeId || subject.institutionId === scopeId)
      .map((subject) => ({ ...subject, studentsCount: this.getStudents(subject.id).length, attendanceRate: this.getAttendanceRate(subject.id) }));
  }

  getSchedule(institutionId = null, license = null) {
    const order = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
    const allowedSubjectIds = this.allowedSubjectIdsForLicense(license);
    return [...(this.state.schedule || [])]
      .filter((item) => !institutionId || item.institutionId === institutionId)
      .filter((item) => !allowedSubjectIds || allowedSubjectIds.has(item.subjectId))
      .sort((a, b) => {
      const byDay = order.indexOf(a.day) - order.indexOf(b.day);
      return byDay || String(a.start || "").localeCompare(String(b.start || ""));
    });
  }

  getInstitutions(license = null) {
    const institutions = [...(this.state.institutions || [])].sort((a, b) => a.name.localeCompare(b.name, "ar"));
    if (!shouldRestrictSubjectScope(license)) return institutions;
    const institutionIds = new Set(this.filterSubjectsByLicense(this.state.subjects || [], license).map((subject) => subject.institutionId).filter(Boolean));
    return institutions.filter((item) => institutionIds.has(item.id));
  }

  async addInstitution(institution) {
    this.state.institutions ||= [];
    const id = crypto.randomUUID();
    this.state.institutions.push({ id, ...institution, createdAt: new Date().toISOString() });
    this.state.settings.activeInstitutionId = id;
    this.persist();
  }

  async updateInstitution(id, patch) {
    this.state.institutions = (this.state.institutions || []).map((item) => item.id === id ? { ...item, ...patch } : item);
    this.persist();
  }

  async deleteInstitution(id) {
    this.state.institutions = (this.state.institutions || []).filter((item) => item.id !== id);
    this.state.schedule = (this.state.schedule || []).filter((item) => item.institutionId !== id);
    this.state.subjects
      .filter((subject) => subject.institutionId === id)
      .map((subject) => subject.id)
      .forEach((subjectId) => this.deleteSubjectData(subjectId));
    this.state.subjects = this.state.subjects.filter((subject) => subject.institutionId !== id);
    if (this.state.settings.activeInstitutionId === id) {
      this.state.settings.activeInstitutionId = this.state.institutions[0]?.id || null;
    }
    this.persist();
  }

  async addScheduleItem(item) {
    this.state.schedule ||= [];
    this.state.schedule.push({ id: crypto.randomUUID(), ...item });
    this.persist();
  }

  async updateScheduleItem(id, patch) {
    this.state.schedule = (this.state.schedule || []).map((item) => item.id === id ? { ...item, ...patch } : item);
    this.persist();
  }

  async deleteScheduleItem(id) {
    this.state.schedule = (this.state.schedule || []).filter((item) => item.id !== id);
    this.persist();
  }

  getSubject(id, license = null) {
    const subject = this.state.subjects.find((item) => item.id === id);
    if (subject && shouldRestrictSubjectScope(license) && !this.isSubjectVisibleForLicense(subject, license)) return null;
    return subject ? { ...subject, studentsCount: this.getStudents(subject.id).length, attendanceRate: this.getAttendanceRate(subject.id) } : null;
  }

  async addSubject(subject) {
    const id = subject.id || crypto.randomUUID();
    const institutionId = subject.institutionId || this.getActiveInstitutionId();
    this.state.subjects.push({ id, ...subject, institutionId, createdAt: new Date().toISOString(), lastAttendanceAt: null });
    this.state.students[id] = [];
    this.state.gradeColumns[id] = structuredClone(defaultGradeColumns);
    this.state.grades[id] = {};
    this.persist();
    await this.firebase.saveDocument("subjects", id, { ...subject, institutionId });
  }

  async updateSubject(id, patch) {
    this.state.subjects = this.state.subjects.map((subject) => subject.id === id ? { ...subject, ...patch } : subject);
    this.persist();
  }

  assignUnlinkedSubjectsToAccount(accountCode, accountName = "") {
    const code = normalizeCode(accountCode);
    if (!code) return 0;
    let changed = 0;
    this.state.subjects = (this.state.subjects || []).map((subject) => {
      if (normalizeCode(subject.assignedTeacherCode)) return subject;
      changed += 1;
      return {
        ...subject,
        assignedTeacherCode: code,
        assignedTeacherName: accountName || subject.assignedTeacherName || "حساب تابع"
      };
    });
    if (changed) this.persist();
    return changed;
  }

  async deleteSubject(id) {
    this.state.subjects = this.state.subjects.filter((subject) => subject.id !== id);
    this.deleteSubjectData(id);
    this.state.schedule = (this.state.schedule || []).filter((item) => item.subjectId !== id);
    this.persist();
  }

  deleteSubjectData(id) {
    delete this.state.students[id];
    delete this.state.attendance[id];
    delete this.state.gradeColumns[id];
    delete this.state.grades[id];
  }

  getStudents(subjectId, query = "") {
    const settings = this.getSettings();
    let students = [...(this.state.students[subjectId] || [])];
    if (query) students = students.filter((student) => `${student.name} ${student.universityId || ""} ${student.guardianPhone || ""}`.includes(query));
    if (settings.studentSort === "absence") students.sort((a, b) => b.absenceCount - a.absenceCount);
    else if (settings.studentSort === "best") students.sort((a, b) => a.absenceCount - b.absenceCount || a.lateCount - b.lateCount);
    else students.sort((a, b) => a.name.localeCompare(b.name, "ar"));
    return students;
  }

  async addStudent(subjectId, student) {
    const name = String(student.name || "").trim();
    if (!name) return { ok: false, reason: "empty" };
    const exists = (this.state.students[subjectId] || []).some((item) => normalizeName(item.name) === normalizeName(name));
    if (exists) return { ok: false, reason: "duplicate" };
    const id = crypto.randomUUID();
    this.state.students[subjectId].push({ id, subjectId, absenceCount: 0, lateCount: 0, notes: "", guardianPhone: "", ...student, guardianPhone: normalizePhone(student.guardianPhone || student.phone || ""), name });
    this.persist();
    return { ok: true, id };
  }

  async updateStudent(subjectId, studentId, patch) {
    const name = String(patch.name || "").trim();
    if (!name) return { ok: false, reason: "empty" };
    const exists = (this.state.students[subjectId] || []).some((item) => item.id !== studentId && normalizeName(item.name) === normalizeName(name));
    if (exists) return { ok: false, reason: "duplicate" };
    this.state.students[subjectId] = this.state.students[subjectId].map((student) => student.id === studentId ? { ...student, ...patch, guardianPhone: normalizePhone(patch.guardianPhone || patch.phone || student.guardianPhone || ""), name } : student);
    this.persist();
    return { ok: true };
  }

  async importStudents(subjectId, rows) {
    const existing = new Set((this.state.students[subjectId] || []).map((student) => normalizeName(student.name)));
    const students = [];
    rows.forEach((entry) => {
      const item = typeof entry === "object" && entry !== null ? entry : { name: entry };
      const name = String(item.name || "").trim();
      if (!name) return;
      const key = normalizeName(name);
      if (existing.has(key)) return;
      existing.add(key);
      students.push({ id: crypto.randomUUID(), subjectId, name, guardianPhone: normalizePhone(item.guardianPhone || item.phone || ""), absenceCount: 0, lateCount: 0, notes: "" });
    });
    this.state.students[subjectId].push(...students);
    this.persist();
    return students.length;
  }

  async deleteStudent(subjectId, studentId) {
    this.state.students[subjectId] = this.state.students[subjectId].filter((student) => student.id !== studentId);
    delete this.state.grades[subjectId][studentId];
    this.persist();
  }

  async moveStudent(sourceSubjectId, studentId, targetSubjectId) {
    if (!sourceSubjectId || !targetSubjectId || sourceSubjectId === targetSubjectId) return { ok: false, reason: "same" };
    const sourceStudents = this.state.students[sourceSubjectId] || [];
    const student = sourceStudents.find((item) => item.id === studentId);
    if (!student) return { ok: false, reason: "missing" };
    this.state.students[targetSubjectId] ||= [];
    const duplicate = this.state.students[targetSubjectId].some((item) => normalizeName(item.name) === normalizeName(student.name));
    if (duplicate) return { ok: false, reason: "duplicate" };
    this.state.students[sourceSubjectId] = sourceStudents.filter((item) => item.id !== studentId);
    this.state.students[targetSubjectId].push({ ...student, subjectId: targetSubjectId });
    this.state.grades[targetSubjectId] ||= {};
    if (this.state.grades[sourceSubjectId]?.[studentId]) {
      this.state.grades[targetSubjectId][studentId] = this.state.grades[sourceSubjectId][studentId];
      delete this.state.grades[sourceSubjectId][studentId];
    }
    this.persist();
    return { ok: true };
  }

  exportAssignmentForAccount(accountCode, accountName = "") {
    const code = normalizeCode(accountCode);
    const subjects = (this.state.subjects || []).filter((subject) => normalizeCode(subject.assignedTeacherCode) === code);
    const subjectIds = new Set(subjects.map((subject) => subject.id));
    const institutionIds = new Set(subjects.map((subject) => subject.institutionId).filter(Boolean));
    const pickBySubject = (source = {}) => Object.fromEntries(Object.entries(source || {}).filter(([subjectId]) => subjectIds.has(subjectId)));
    return {
      app: "yusr-teacher-assignment",
      version: 1,
      exportedAt: new Date().toISOString(),
      accountCode: code,
      accountName,
      data: {
        institutions: (this.state.institutions || []).filter((item) => institutionIds.has(item.id)),
        subjects,
        students: pickBySubject(this.state.students),
        schedule: (this.state.schedule || []).filter((item) => subjectIds.has(item.subjectId)),
        gradeColumns: pickBySubject(this.state.gradeColumns)
      }
    };
  }

  async importAssignmentForActiveAccount(payload, license = null) {
    const source = payload?.app === "yusr-teacher-assignment" ? payload : null;
    if (!source?.data || typeof source.data !== "object") return { ok: false, reason: "invalid" };
    const activeCode = normalizeCode(license?.code);
    if (activeCode && source.accountCode && normalizeCode(source.accountCode) !== activeCode) return { ok: false, reason: "wrong-account" };
    const data = source.data;
    const subjects = Array.isArray(data.subjects) ? data.subjects : [];
    const accountName = String(source.accountName || source.ownerName || "").trim();
    if (accountName) {
      this.state.settings ||= {};
      this.state.settings.teacherName = accountName;
    }
    const subjectIds = new Set(subjects.map((subject) => subject.id).filter(Boolean));
    this.state.institutions ||= [];
    this.state.subjects ||= [];
    this.state.students ||= {};
    this.state.schedule ||= [];
    this.state.gradeColumns ||= {};
    this.state.grades ||= {};
    const previousAssignedIds = new Set(
      (this.state.subjects || [])
        .filter((subject) => normalizeCode(subject.assignedTeacherCode) === activeCode || subjectIds.has(subject.id))
        .map((subject) => subject.id)
        .filter(Boolean)
    );
    const removedSubjectIds = new Set([...previousAssignedIds].filter((id) => !subjectIds.has(id)));
    if (removedSubjectIds.size) {
      this.state.subjects = this.state.subjects.filter((subject) => !removedSubjectIds.has(subject.id));
      removedSubjectIds.forEach((subjectId) => {
        delete this.state.students[subjectId];
        delete this.state.gradeColumns[subjectId];
        delete this.state.grades[subjectId];
      });
    }
    const incomingInstitutionIds = new Set((Array.isArray(data.institutions) ? data.institutions : []).map((item) => item.id).filter(Boolean));
    const remainingInstitutionIds = new Set((this.state.subjects || []).map((subject) => subject.institutionId).filter(Boolean));
    if (activeCode) {
      this.state.institutions = this.state.institutions.filter((institution) => {
        return incomingInstitutionIds.has(institution.id) || remainingInstitutionIds.has(institution.id);
      });
    }
    (Array.isArray(data.institutions) ? data.institutions : []).forEach((institution) => {
      const index = this.state.institutions.findIndex((item) => item.id === institution.id);
      if (index >= 0) this.state.institutions[index] = { ...this.state.institutions[index], ...institution };
      else this.state.institutions.push(institution);
    });
    subjects.forEach((subject) => {
      const index = this.state.subjects.findIndex((item) => item.id === subject.id);
      if (index >= 0) this.state.subjects[index] = { ...this.state.subjects[index], ...subject };
      else this.state.subjects.push(subject);
      this.state.students[subject.id] = mergeStudentLists(
        this.state.students[subject.id] || [],
        Array.isArray(data.students?.[subject.id]) ? data.students[subject.id] : [],
        subject.id
      );
      this.state.gradeColumns[subject.id] = Array.isArray(data.gradeColumns?.[subject.id]) ? data.gradeColumns[subject.id] : (this.state.gradeColumns[subject.id] || structuredClone(defaultGradeColumns));
      this.state.grades[subject.id] ||= {};
    });
    const scheduleScopeIds = new Set([...previousAssignedIds, ...subjectIds]);
    this.state.schedule = [
      ...(this.state.schedule || []).filter((item) => !scheduleScopeIds.has(item.subjectId)),
      ...(Array.isArray(data.schedule) ? data.schedule.filter((item) => subjectIds.has(item.subjectId)) : [])
    ];
    if (Array.isArray(data.studentRequests)) {
      this.state.studentRequests = mergeStudentRequests(this.state.studentRequests, data.studentRequests);
    }
    normalizeInstitutionScopes(this.state);
    this.persist();
    return { ok: true, count: subjects.length };
  }

  allowedSubjectIdsForLicense(license = null) {
    if (!shouldRestrictSubjectScope(license)) return null;
    return new Set(this.filterSubjectsByLicense(this.state.subjects || [], license).map((subject) => subject.id));
  }

  filterSubjectsByLicense(subjects = [], license = null) {
    if (!shouldRestrictSubjectScope(license)) return [...subjects];
    return subjects.filter((subject) => this.isSubjectVisibleForLicense(subject, license));
  }

  isSubjectVisibleForLicense(subject, license = null) {
    if (!shouldRestrictSubjectScope(license)) return true;
    const accountCode = normalizeCode(license?.code);
    return Boolean(accountCode && normalizeCode(subject?.assignedTeacherCode) === accountCode);
  }

  async addStudentRequest(request) {
    this.state.studentRequests ||= [];
    const clean = {
      id: crypto.randomUUID(),
      type: request.type || "add",
      subjectId: request.subjectId || "",
      studentId: request.studentId || "",
      studentName: String(request.studentName || request.name || "").trim(),
      note: String(request.note || "").trim(),
      requestedBy: String(request.requestedBy || this.state.settings.teacherName || "").trim(),
      status: "pending",
      createdAt: new Date().toISOString()
    };
    if (!clean.studentName) return { ok: false, reason: "empty" };
    this.state.studentRequests.unshift(clean);
    this.persist();
    return { ok: true, request: clean };
  }

  async updateStudentRequest(requestId, patch = {}) {
    this.state.studentRequests ||= [];
    let updated = null;
    this.state.studentRequests = this.state.studentRequests.map((request) => {
      if (request.id !== requestId) return request;
      updated = { ...request, ...patch, updatedAt: new Date().toISOString() };
      return updated;
    });
    if (updated) this.persist();
    return { ok: Boolean(updated), request: updated };
  }

  getStudentRequests(subjectId = "") {
    const rows = Array.isArray(this.state.studentRequests) ? this.state.studentRequests : [];
    return rows
      .filter((request) => !subjectId || request.subjectId === subjectId)
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  }

  getBehaviorViolations(query = "") {
    const term = normalizeName(query);
    const rows = Array.isArray(this.state.behaviorViolations) ? this.state.behaviorViolations : [];
    return rows
      .filter((row) => {
        if (!term) return true;
        return [
          row.studentName,
          row.guardianPhone,
          row.institutionName,
          row.subjectName,
          row.teacherName,
          row.violationType,
          row.action,
          row.penalty,
          row.status,
          row.note
        ].some((value) => normalizeName(value).includes(term));
      })
      .sort((a, b) => String(b.date || b.createdAt || "").localeCompare(String(a.date || a.createdAt || "")));
  }

  async addBehaviorViolation(data = {}) {
    this.state.behaviorViolations ||= [];
    const clean = {
      id: crypto.randomUUID(),
      studentId: String(data.studentId || "").trim(),
      studentName: String(data.studentName || "").trim(),
      guardianPhone: normalizePhone(data.guardianPhone || ""),
      subjectId: String(data.subjectId || "").trim(),
      subjectName: String(data.subjectName || "").trim(),
      institutionId: String(data.institutionId || "").trim(),
      institutionName: String(data.institutionName || "").trim(),
      teacherCode: normalizeCode(data.teacherCode || ""),
      teacherName: String(data.teacherName || "").trim(),
      date: data.date || new Date().toISOString().slice(0, 10),
      degree: Math.min(6, Math.max(1, Number(data.degree || 1))),
      violationType: String(data.violationType || "").trim(),
      action: String(data.action || "").trim(),
      penalty: String(data.penalty || "").trim(),
      points: Math.max(0, Number(data.points || 0)),
      deductBehaviorGrade: Boolean(data.deductBehaviorGrade),
      behaviorDeductionApplied: 0,
      behaviorGradeColumn: "",
      status: data.status || "متابعة",
      note: String(data.note || "").trim(),
      createdAt: new Date().toISOString()
    };
    if (!clean.studentName || !clean.violationType) return { ok: false, reason: "empty" };
    if (clean.deductBehaviorGrade && clean.subjectId && clean.studentId && clean.points > 0) {
      const deduction = this.applyBehaviorViolationDeduction(clean.subjectId, clean.studentId, clean.points);
      clean.behaviorDeductionApplied = deduction.amount;
      clean.behaviorGradeColumn = deduction.columnLabel;
    }
    this.state.behaviorViolations.unshift(clean);
    this.persist();
    return { ok: true, item: clean };
  }

  applyBehaviorViolationDeduction(subjectId, studentId, points = 0) {
    const columns = this.state.gradeColumns?.[subjectId] || [];
    const column = columns.find((item) => normalizeName(item.label).includes("سلوك"));
    if (!column) return { amount: 0, columnLabel: "" };
    this.state.grades[subjectId] ||= {};
    this.state.grades[subjectId][studentId] ||= {};
    const max = safeNumber(column.max);
    const currentRaw = this.state.grades[subjectId][studentId][column.id];
    const current = currentRaw === undefined || currentRaw === null || currentRaw === "" ? max : safeNumber(currentRaw);
    const amount = Math.min(Math.max(0, safeNumber(points)), Math.max(0, current));
    this.state.grades[subjectId][studentId][column.id] = Math.max(0, current - amount);
    return { amount, columnLabel: column.label || "السلوك" };
  }

  async updateBehaviorViolation(id, patch = {}) {
    this.state.behaviorViolations ||= [];
    let updated = null;
    this.state.behaviorViolations = this.state.behaviorViolations.map((row) => {
      if (row.id !== id) return row;
      updated = { ...row, ...patch, updatedAt: new Date().toISOString() };
      return updated;
    });
    if (updated) this.persist();
    return { ok: Boolean(updated), item: updated };
  }

  async deleteBehaviorViolation(id) {
    this.state.behaviorViolations ||= [];
    const before = this.state.behaviorViolations.length;
    this.state.behaviorViolations = this.state.behaviorViolations.filter((row) => row.id !== id);
    const ok = this.state.behaviorViolations.length !== before;
    if (ok) this.persist();
    return { ok };
  }

  getTodayAttendance(subjectId, sessionId = "session-1") {
    const legacyKey = todayKey();
    const key = attendanceSessionKey(todayKey(), sessionId);
    this.state.attendance[subjectId] ||= {};
    if (!this.state.attendance[subjectId][key] && sessionId === "session-1" && this.state.attendance[subjectId][legacyKey]) {
      this.state.attendance[subjectId][key] = this.state.attendance[subjectId][legacyKey];
    }
    this.state.attendance[subjectId][key] ||= {};
    return this.state.attendance[subjectId][key];
  }

  async setAttendance(subjectId, studentId, status, sessionId = "session-1") {
    const session = this.getTodayAttendance(subjectId, sessionId);
    const students = this.state.students[subjectId];
    const student = students.find((item) => item.id === studentId);
    const previous = session[studentId];
    session[studentId] = status;
    if (student && previous !== status) {
      if (previous === "absent") student.absenceCount = Math.max(0, student.absenceCount - 1);
      if (previous === "late") student.lateCount = Math.max(0, student.lateCount - 1);
      if (status === "absent") student.absenceCount += 1;
      if (status === "late") student.lateCount += 1;
    }
    this.state.subjects = this.state.subjects.map((subject) => subject.id === subjectId ? { ...subject, lastAttendanceAt: new Date().toISOString() } : subject);
    this.persist();
  }

  async completeAttendance(subjectId, sessionId = "session-1") {
    if (this.state.settings.autoPresent) {
      const session = this.getTodayAttendance(subjectId, sessionId);
      this.getStudents(subjectId).forEach((student) => {
        if (!session[student.id]) session[student.id] = "present";
      });
    }
    this.persist();
  }

  async clearTodayAttendance(subjectId, sessionId = "session-1") {
    const session = this.getTodayAttendance(subjectId, sessionId);
    const students = this.state.students[subjectId] || [];
    Object.entries(session).forEach(([studentId, status]) => {
      const student = students.find((item) => item.id === studentId);
      if (!student) return;
      if (status === "absent") student.absenceCount = Math.max(0, student.absenceCount - 1);
      if (status === "late") student.lateCount = Math.max(0, student.lateCount - 1);
    });
    const key = attendanceSessionKey(todayKey(), sessionId);
    this.state.attendance[subjectId][key] = {};
    this.persist();
  }

  getAttendanceSummary(subjectId, sessionId = "session-1") {
    const session = this.getTodayAttendance(subjectId, sessionId);
    const students = this.state.students[subjectId] || [];
    return students.reduce((summary, student) => {
      const status = session[student.id] || "empty";
      summary[status] += 1;
      return summary;
    }, { present: 0, absent: 0, late: 0, empty: 0, total: students.length });
  }

  getMonthlyAttendance(subjectId, date = new Date()) {
    const calendar = this.state.settings.dateCalendar === "islamic" ? "islamic-umalqura" : "gregory";
    const monthDates = calendar === "islamic-umalqura" ? islamicMonthDates(date) : gregorianMonthDates(date);
    const days = monthDates.map((dayDate, index) => {
      const key = dateKey(dayDate);
      return {
        key,
        day: index + 1,
        weekday: new Intl.DateTimeFormat("ar-SA", { weekday: "short", calendar }).format(dayDate),
        label: new Intl.DateTimeFormat("ar-SA", { day: "numeric", month: "short", calendar }).format(dayDate)
      };
    });
    return {
      monthName: new Intl.DateTimeFormat("ar-SA", { month: "long", year: "numeric", calendar }).format(date),
      days,
      sessions: this.state.attendance[subjectId] || {},
      sessionKeys: this.getAttendanceSessionKeys(subjectId)
    };
  }

  getAttendanceSessionKeys(subjectId) {
    const sessions = this.state.attendance[subjectId] || {};
    return Object.keys(sessions).map((key) => parseAttendanceSessionKey(key));
  }

  getStudentAttendanceHistory(subjectId, studentId) {
    const sessions = this.state.attendance[subjectId] || {};
    return Object.entries(sessions)
      .map(([key, values]) => ({ ...parseAttendanceSessionKey(key), status: values?.[studentId] }))
      .filter((item) => item.status)
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  getAttendanceRate(subjectId) {
    const students = this.state.students[subjectId] || [];
    if (!students.length) return 0;
    const risk = students.reduce((sum, student) => sum + student.absenceCount, 0);
    return Math.max(0, Math.round(100 - (risk / (students.length * 12)) * 100));
  }

  getGradeColumns(subjectId) {
    return this.state.gradeColumns[subjectId] || [];
  }

  async addGradeColumn(subjectId, column) {
    this.state.gradeColumns[subjectId].push({ id: crypto.randomUUID(), ...column });
    this.persist();
  }

  async updateGradeColumn(subjectId, columnId, patch) {
    this.state.gradeColumns[subjectId] = this.state.gradeColumns[subjectId].map((column) => column.id === columnId ? { ...column, ...patch } : column);
    this.persist();
  }

  async deleteGradeColumn(subjectId, columnId) {
    this.state.gradeColumns[subjectId] = this.state.gradeColumns[subjectId].filter((column) => column.id !== columnId);
    Object.values(this.state.grades[subjectId]).forEach((studentGrades) => delete studentGrades[columnId]);
    this.persist();
  }

  async reorderGradeColumn(subjectId, fromId, toId) {
    const columns = [...this.state.gradeColumns[subjectId]];
    const fromIndex = columns.findIndex((column) => column.id === fromId);
    const toIndex = columns.findIndex((column) => column.id === toId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
    const [moved] = columns.splice(fromIndex, 1);
    columns.splice(toIndex, 0, moved);
    this.state.gradeColumns[subjectId] = columns;
    this.persist();
  }

  async moveGradeColumn(subjectId, columnId, direction) {
    const columns = [...this.state.gradeColumns[subjectId]];
    const index = columns.findIndex((column) => column.id === columnId);
    const nextIndex = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || nextIndex < 0 || nextIndex >= columns.length) return;
    [columns[index], columns[nextIndex]] = [columns[nextIndex], columns[index]];
    this.state.gradeColumns[subjectId] = columns;
    this.persist();
  }

  async setGrade(subjectId, studentId, columnId, value) {
    this.state.grades[subjectId][studentId] ||= {};
    const column = this.state.gradeColumns[subjectId]?.find((item) => item.id === columnId);
    const max = safeNumber(column?.max);
    const grade = Math.max(0, safeNumber(value));
    this.state.grades[subjectId][studentId][columnId] = max ? Math.min(grade, max) : grade;
    this.persist();
  }

  previewGradeBoost(subjectId, columnId, amount) {
    const columns = this.state.gradeColumns[subjectId] || [];
    const selected = columns.find((column) => column.id === columnId);
    if (!selected) return { rolloverCandidates: 0 };
    const students = this.state.students[subjectId] || [];
    const boost = Math.max(0, safeNumber(amount));
    const rolloverCandidates = students.filter((student) => {
      const grades = this.state.grades[subjectId]?.[student.id] || {};
      const selectedDeficit = Math.max(0, safeNumber(selected.max) - safeNumber(grades[selected.id]));
      if (selectedDeficit >= boost) return false;
      const remaining = boost - selectedDeficit;
      const otherDeficit = columns
        .filter((column) => column.id !== selected.id)
        .reduce((sum, column) => sum + Math.max(0, safeNumber(column.max) - safeNumber(grades[column.id])), 0);
      return remaining > 0 && otherDeficit > 0;
    }).length;
    return { rolloverCandidates };
  }

  async applyGradeBoost(subjectId, columnId, amount, options = {}) {
    const columns = this.state.gradeColumns[subjectId] || [];
    const selected = columns.find((column) => column.id === columnId);
    if (!selected) return { updatedStudents: 0, addedTotal: 0 };
    this.state.grades[subjectId] ||= {};
    const orderedColumns = [selected, ...columns.filter((column) => column.id !== selected.id)];
    const boost = Math.max(0, safeNumber(amount));
    let updatedStudents = 0;
    let addedTotal = 0;

    (this.state.students[subjectId] || []).forEach((student) => {
      this.state.grades[subjectId][student.id] ||= {};
      const grades = this.state.grades[subjectId][student.id];
      let remaining = boost;
      let addedForStudent = 0;
      for (const column of orderedColumns) {
        if (column.id !== selected.id && !options.allowRollover) continue;
        if (remaining <= 0) break;
        const max = safeNumber(column.max);
        const current = safeNumber(grades[column.id]);
        const available = Math.max(0, max - current);
        const addition = Math.min(remaining, available);
        if (addition <= 0) continue;
        grades[column.id] = current + addition;
        remaining -= addition;
        addedForStudent += addition;
      }
      if (addedForStudent > 0) {
        updatedStudents += 1;
        addedTotal += addedForStudent;
      }
    });
    this.persist();
    return { updatedStudents, addedTotal };
  }

  getGrades(subjectId, studentId) {
    return this.state.grades[subjectId]?.[studentId] || {};
  }

  getSmartAlerts() {
    const settings = this.getSettings();
    if (!settings.notifications) return [];
    return Object.values(this.state.students).flat().flatMap((student) => {
      const alerts = [];
      if (student.absenceCount >= settings.absenceLimit) alerts.push({ type: "risk", title: "تجاوز حد الغياب", message: `${student.name} وصل إلى ${student.absenceCount} غياب.` });
      if (student.lateCount >= 4) alerts.push({ type: "warning", title: "كثرة التأخير", message: `${student.name} لديه ${student.lateCount} حالات تأخير.` });
      return alerts;
    });
  }
}

function storageKeyForAccount(accountCode = "") {
  const code = normalizeCode(accountCode);
  return code ? `${ACCOUNT_STORAGE_PREFIX}${code}` : STORAGE_KEY;
}

function academicYearLabel(date = new Date()) {
  const start = date.getFullYear();
  return `${start}–${start + 1}`;
}

function nextAcademicYearLabel(label = academicYearLabel()) {
  const match = String(label).match(/(\d{4})\D+(\d{4})/);
  if (!match) return academicYearLabel(new Date(new Date().setFullYear(new Date().getFullYear() + 1)));
  const start = Number(match[1]) + 1;
  return `${start}–${start + 1}`;
}

function readStoredState(accountCode = "") {
  const key = storageKeyForAccount(accountCode);
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null");
    if (saved && typeof saved === "object") return saved;
  } catch {}
  if (!normalizeCode(accountCode)) {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch {
      return null;
    }
  }
  return null;
}

function prepareState(input) {
  const state = input && typeof input === "object" ? input : createInitialState();
  let changed = false;
  state.settings = { ...structuredClone(defaultSettings), ...(state.settings || {}) };
  const updatedTeacherName = isOldDefaultTeacherName(state.settings.teacherName);
  if (updatedTeacherName) {
    state.settings.teacherName = DEFAULT_TEACHER_NAME;
    changed = true;
  }
  state.subjects = Array.isArray(state.subjects) ? state.subjects : [];
  state.students = state.students && typeof state.students === "object" ? state.students : {};
  state.attendance = state.attendance && typeof state.attendance === "object" ? state.attendance : {};
  state.schedule = Array.isArray(state.schedule) ? state.schedule : [];
  state.institutions = Array.isArray(state.institutions) ? state.institutions : [];
  state.gradeColumns = state.gradeColumns && typeof state.gradeColumns === "object" ? state.gradeColumns : {};
  state.grades = state.grades && typeof state.grades === "object" ? state.grades : {};
  state.studentRequests = Array.isArray(state.studentRequests) ? state.studentRequests : [];
  state.behaviorViolations = Array.isArray(state.behaviorViolations) ? state.behaviorViolations : [];
  state.academicYears = Array.isArray(state.academicYears) ? state.academicYears : [];
  state.settings.currentAcademicYearLabel ||= academicYearLabel();
  const desiredAcademicLabel = academicYearLabel();
  const legacyAcademicLabel = `${new Date().getFullYear() - 1}-${new Date().getFullYear()}`;
  if (state.settings.currentAcademicYearLabel === legacyAcademicLabel && !state.academicYears.some((year) => year.archived || year.snapshot)) {
    state.settings.currentAcademicYearLabel = desiredAcademicLabel;
    state.academicYears.forEach((year) => {
      if (year.status === "active") year.label = desiredAcademicLabel;
    });
    changed = true;
  }
  if (!state.academicYears.length) {
    const id = crypto.randomUUID();
    state.academicYears.push({
      id,
      label: state.settings.currentAcademicYearLabel,
      status: "active",
      archived: false,
      createdAt: new Date().toISOString(),
      snapshot: null
    });
    state.settings.currentAcademicYearId = id;
    changed = true;
  }
  state.outbox = Array.isArray(state.outbox) ? state.outbox : [];
  if (cleanupDemoStudents(state)) changed = true;
  if (normalizeInstitutionScopes(state)) changed = true;
  return { state, changed };
}

function createInitialState() {
  return {
    settings: structuredClone(defaultSettings),
    subjects: [],
    students: {},
    attendance: {},
    schedule: [],
    institutions: [],
    gradeColumns: {},
    grades: {},
    studentRequests: [],
    behaviorViolations: [],
    academicYears: [],
    outbox: [],
    demoCleanupVersion: DEMO_CLEANUP_VERSION,
    updatedAt: new Date().toISOString()
  };
}

function normalizeInstitutionScopes(state) {
  let changed = false;
  state.settings ||= {};
  state.institutions ||= [];
  state.subjects ||= [];
  if (!state.institutions.length) {
    if (state.settings.activeInstitutionId) {
      state.settings.activeInstitutionId = null;
      changed = true;
    }
    return changed;
  }
  const institutionIds = new Set(state.institutions.map((item) => item.id));
  const fallbackId = state.settings.activeInstitutionId && institutionIds.has(state.settings.activeInstitutionId)
    ? state.settings.activeInstitutionId
    : state.institutions[0].id;
  state.subjects = state.subjects.map((subject) => {
    if (subject.institutionId && institutionIds.has(subject.institutionId)) return subject;
    changed = true;
    return { ...subject, institutionId: fallbackId };
  });
  state.schedule = (state.schedule || []).filter((lesson) => {
    if (!lesson.institutionId || institutionIds.has(lesson.institutionId)) return true;
    changed = true;
    return false;
  });
  if (state.settings.activeInstitutionId !== fallbackId) {
    state.settings.activeInstitutionId = fallbackId;
    changed = true;
  }
  return changed;
}

function cleanupDemoStudents(state) {
  if (state.demoCleanupVersion >= DEMO_CLEANUP_VERSION) return false;
  let changed = false;
  state.students ||= {};
  state.grades ||= {};
  (state.subjects || []).forEach((subject) => {
    const subjectId = subject.id;
    const demoPrefix = `${subjectId}-student-`;
    const currentStudents = state.students[subjectId] || [];
    const demoIds = currentStudents
      .filter((student) => String(student.id || "").startsWith(demoPrefix))
      .map((student) => student.id);
    if (!demoIds.length) return;
    changed = true;
    state.students[subjectId] = currentStudents.filter((student) => !demoIds.includes(student.id));
    demoIds.forEach((studentId) => delete state.grades[subjectId]?.[studentId]);
  });
  const demoIds = new Set(demoSubjects.map((subject) => subject.id));
  const beforeSubjects = (state.subjects || []).length;
  state.subjects = (state.subjects || []).filter((subject) => {
    if (!demoIds.has(subject.id)) return true;
    const hasStudents = (state.students[subject.id] || []).length > 0;
    const hasAttendance = Object.keys(state.attendance?.[subject.id] || {}).length > 0;
    return hasStudents || hasAttendance;
  });
  if (state.subjects.length !== beforeSubjects) changed = true;
  const beforeSchedule = (state.schedule || []).length;
  const defaultScheduleIds = new Set(defaultSchedule.map((item) => item.id));
  state.schedule = (state.schedule || []).filter((item) => !defaultScheduleIds.has(item.id));
  if (state.schedule.length !== beforeSchedule) changed = true;
  state.demoCleanupVersion = DEMO_CLEANUP_VERSION;
  return changed;
}

function todayKey() {
  return dateKey(new Date());
}

function attendanceSessionKey(date, sessionId = "session-1") {
  return `${date}__${sessionId || "session-1"}`;
}

function parseAttendanceSessionKey(key) {
  const [date, sessionId = "session-1"] = String(key).split("__");
  return { key, date, sessionId };
}

function mergeStudentRequests(localRequests = [], incomingRequests = []) {
  const merged = new Map();
  [...(localRequests || []), ...(incomingRequests || [])].forEach((request) => {
    if (!request?.id) return;
    const current = merged.get(request.id);
    if (!current) {
      merged.set(request.id, request);
      return;
    }
    const currentTime = Date.parse(current.updatedAt || current.reviewedAt || current.createdAt || 0) || 0;
    const nextTime = Date.parse(request.updatedAt || request.reviewedAt || request.createdAt || 0) || 0;
    if (nextTime >= currentTime) merged.set(request.id, { ...current, ...request });
  });
  return [...merged.values()].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ar");
}

function mergeStudentLists(localStudents = [], incomingStudents = [], subjectId = "") {
  const merged = [];
  const seenIds = new Set();
  const seenNames = new Set();
  const addStudent = (student) => {
    if (!student || typeof student !== "object") return;
    const nameKey = normalizeName(student.name);
    const idKey = String(student.id || "").trim();
    if ((idKey && seenIds.has(idKey)) || (nameKey && seenNames.has(nameKey))) return;
    const next = {
      ...student,
      id: idKey || crypto.randomUUID(),
      subjectId: student.subjectId || subjectId,
      guardianPhone: normalizePhone(student.guardianPhone || student.phone || ""),
      absenceCount: Number(student.absenceCount || 0),
      lateCount: Number(student.lateCount || 0),
      notes: student.notes || ""
    };
    if (next.id) seenIds.add(next.id);
    if (nameKey) seenNames.add(nameKey);
    merged.push(next);
  };
  incomingStudents.forEach(addStudent);
  localStudents.forEach(addStudent);
  return merged;
}

function normalizeCode(code) {
  return String(code || "").trim().toUpperCase();
}

function normalizePhone(value) {
  return String(value || "").replace(/[^\d+]/g, "").trim();
}

function shouldRestrictSubjectScope(license = null) {
  const mode = license?.accessMode;
  const parentCode = normalizeCode(license?.parentCode);
  return Boolean(["teacher", "delegate"].includes(mode) && parentCode);
}

function isOldDefaultTeacherName(name) {
  const value = String(name || "").trim();
  return !value
    || value === "د. أحمد المعلم"
    || value === "د. أحمد المعلم"
    || value === "م.أمين سمير أمين اليوسفي"
    || value === "?.???? ???? ???? ???????";
}

function gregorianMonthDates(date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const daysCount = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: daysCount }, (_, index) => new Date(year, month, index + 1));
}

function islamicMonthDates(anchorDate) {
  const anchor = islamicParts(anchorDate);
  const dates = [];
  const scanStart = new Date(anchorDate);
  scanStart.setDate(scanStart.getDate() - 40);
  for (let offset = 0; offset < 90; offset += 1) {
    const date = new Date(scanStart);
    date.setDate(scanStart.getDate() + offset);
    const parts = islamicParts(date);
    if (parts.year === anchor.year && parts.month === anchor.month) dates.push(date);
  }
  return dates;
}

function islamicParts(date) {
  const parts = new Intl.DateTimeFormat("en-US-u-ca-islamic-umalqura", {
    year: "numeric",
    month: "numeric",
    day: "numeric"
  }).formatToParts(date);
  const value = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  return { year: value("year"), month: value("month"), day: value("day") };
}
