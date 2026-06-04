import { exportAttendanceCsv, exportGradesCsv, exportReportPdf } from "../services/export-service.js?v=123";
import { initials, qs, renderIcons, safeNumber, setPageTitle } from "../utils/dom.js?v=35";

const tabs = [
  ["students", "الطلاب", "users"],
  ["attendance", "التحضير", "check-check"],
  ["sheet", "الكشف", "calendar-days"],
  ["grades", "الدرجات", "table-properties"],
  ["stats", "الإحصائيات", "bar-chart-3"],
  ["settings", "الإعدادات", "settings"]
];

const weekDays = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

export class SubjectPage {
  constructor(app) {
    this.app = app;
    this.subjectId = null;
    this.activeTab = "students";
    this.query = "";
    this.searchTimer = null;
    this.attendanceSessionId = "";
    this.sheetSessionFilter = "";
    this.scheduleDay = "";
    this.sheetMonth = null;
    this.sheetYear = null;
    this.statsGroup = "attendance";
    this.statsView = "absent";
    this.statsColumnId = null;
    window.addEventListener("global-search", (event) => {
      if (!this.subjectId) return;
      this.query = event.detail;
      this.render(this.subjectId, this.activeTab);
    });
  }

  render(subjectId, tab = "students") {
    const activeLicense = this.app.services.license.getActiveLicense();
    const accessMode = this.app.services.store.getSettings().accessMode || "teacher";
    if (accessMode === "delegate" && this.isManagedDelegate(activeLicense) && tab !== "attendance") {
      location.hash = `#/subject/${subjectId}/attendance`;
      return;
    }
    const shouldResetDay = ["attendance", "sheet"].includes(tab) && (this.subjectId !== subjectId || this.activeTab !== tab);
    if (shouldResetDay) {
      this.scheduleDay = "";
      this.attendanceSessionId = "";
      this.sheetSessionFilter = "";
    }
    this.subjectId = subjectId;
    this.activeTab = tab;
    const subject = this.app.services.store.getSubject(subjectId, activeLicense);
    if (!subject) {
      this.app.services.toast.show("هذه المادة غير مرتبطة بهذا الحساب", "warning");
      return location.hash = "#/subjects";
    }
    setPageTitle(subject.name);

    qs("#view").innerHTML = `
      <section class="panel">
        <div class="panel-header">
          <div>
            <span class="eyebrow">${subject.code} · ${subject.room || "بدون قاعة"}</span>
            <h2>${subject.name}</h2>
          </div>
          <div class="toolbar-group">
            ${tab === "settings" ? "" : `<button class="ghost-button" id="export-report"><i data-lucide="file-text"></i>تصدير PDF</button>`}
            ${this.canManageSubjects() ? `<button class="danger-button" id="delete-subject"><i data-lucide="trash-2"></i>حذف المادة</button>` : ""}
            ${this.canAddStudents() ? `<button class="primary-button" id="add-student"><i data-lucide="user-plus"></i>إضافة طالب</button>` : this.canSendStudentRequests() ? `<button class="primary-button" id="request-student-change"><i data-lucide="send"></i>طلب طالب</button>` : ""}
          </div>
        </div>
        <div class="quick-stats">
          <article class="stat-card"><span>عدد الطلاب</span><strong>${subject.studentsCount}</strong></article>
          <article class="stat-card"><span>نسبة الحضور</span><strong>${subject.attendanceRate}%</strong></article>
          <article class="stat-card"><span>حد الغياب</span><strong>${this.app.services.store.getSettings().absenceLimit}</strong></article>
          <article class="stat-card"><span>تنبيهات المادة</span><strong>${this.subjectAlerts(subjectId).length}</strong></article>
        </div>
      </section>
      <nav class="tabs">${this.visibleTabs().map(([id, label, icon]) => `<button class="tab ${tab === id ? "active" : ""}" data-tab="${id}"><i data-lucide="${icon}"></i>${label}</button>`).join("")}</nav>
      <section id="subject-body"></section>
    `;

    document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => location.hash = `#/subject/${subjectId}/${button.dataset.tab}`));
    qs("#add-student")?.addEventListener("click", () => this.openStudentModal());
    qs("#request-student-change")?.addEventListener("click", () => this.openStudentRequestModal());
    qs("#delete-subject")?.addEventListener("click", () => this.openDeleteSubjectModal(subject));
    qs("#export-report")?.addEventListener("click", () => this.openPdfTemplateModal(subject));
    this.renderTab();
    renderIcons();
  }

  renderTab() {
    if (this.activeTab === "attendance") return this.renderAttendance();
    if (this.activeTab === "sheet") return this.renderAttendanceSheet();
    if (this.activeTab === "grades") return this.renderGrades();
    if (this.activeTab === "stats") return this.renderStats();
    if (this.activeTab === "settings") return this.renderSubjectSettings();
    return this.renderStudents();
  }

  visibleTabs() {
    const license = this.app.services.license.getActiveLicense();
    const accessMode = license?.accessMode || this.app.services.store.getSettings().accessMode || "teacher";
    if (accessMode === "delegate" && this.isManagedDelegate(license)) return tabs.filter(([id]) => id === "attendance");
    if (accessMode === "delegate") return tabs.filter(([id]) => ["students", "attendance", "sheet", "settings"].includes(id));
    if (this.isManagedAccount() && license?.permissions) {
      return tabs.filter(([id]) => {
        const key = id === "sheet" ? "attendance" : id === "stats" ? "stats" : id;
        return Boolean(license.permissions[key]);
      });
    }
    return tabs;
  }

  isManagedTeacher() {
    const license = this.app.services.license.getActiveLicense();
    return Boolean(license?.accessMode === "teacher" && license.parentCode);
  }

  isManagedDelegate(license = this.app.services.license.getActiveLicense()) {
    return Boolean(license?.accessMode === "delegate" && license.parentCode);
  }

  isManagedAccount() {
    const license = this.app.services.license.getActiveLicense();
    return Boolean(["teacher", "delegate"].includes(license?.accessMode) && license.parentCode);
  }

  isDelegate() {
    const license = this.app.services.license.getActiveLicense();
    return license?.accessMode === "delegate" || this.app.services.store.getSettings().accessMode === "delegate";
  }

  hasActionPermission(key, fallback = true) {
    const license = this.app.services.license.getActiveLicense();
    if (!this.isManagedAccount()) return true;
    return license?.permissions ? Boolean(license.permissions[key]) : fallback;
  }

  canAddStudents() {
    if (this.isDelegate()) return this.hasActionPermission("studentAdd", true);
    return this.hasActionPermission("studentAdd", !this.isManagedTeacher());
  }

  canEditStudents() {
    return this.hasActionPermission("studentEdit", true);
  }

  canDeleteStudents() {
    if (!this.isManagedAccount()) return true;
    return this.hasActionPermission("studentDelete", false);
  }

  canSendStudentRequests() {
    if (!this.isManagedAccount()) return false;
    return this.hasActionPermission("studentRequests", true);
  }

  canManageSubjects() {
    if (!this.isManagedAccount()) return true;
    return this.hasActionPermission("subjectManage", false);
  }

  canManageGradeColumns() {
    if (!this.isManagedAccount()) return true;
    return this.hasActionPermission("gradeColumnManage", true);
  }

  canUseGradeBoost() {
    if (!this.isManagedAccount()) return true;
    return this.hasActionPermission("gradeBoost", true);
  }

  renderStudents() {
    const students = this.app.services.store.getStudents(this.subjectId, this.query);
    qs("#subject-body").innerHTML = `
      <div class="toolbar">
        <div><span class="eyebrow">إدارة الطلاب</span><h2>قائمة الطلاب</h2></div>
        <div class="toolbar-group">
          ${this.canAddStudents() ? `<button class="ghost-button" id="import-students"><i data-lucide="upload"></i>استيراد Excel</button>` : ""}
          ${this.canSendStudentRequests() ? `<button class="ghost-button" id="request-student-from-list"><i data-lucide="send"></i>طلب إضافة/حذف</button>` : ""}
        </div>
      </div>
      <input class="field student-search-field" id="student-search" placeholder="بحث باسم الطالب..." value="${this.query}" />
      ${this.canSendStudentRequests() ? this.studentRequestsStatusPanel() : ""}
      <div class="students-list" id="students-list">${students.map((student) => this.studentCard(student, false)).join("")}</div>
    `;
    qs("#student-search").addEventListener("input", (event) => {
      this.query = event.target.value;
      this.updateStudentsList();
    });
    qs("#import-students")?.addEventListener("click", () => this.openImportStudentsModal());
    qs("#request-student-from-list")?.addEventListener("click", () => this.openStudentRequestModal());
    this.bindStudentActions();
    renderIcons();
  }

  studentRequestsStatusPanel() {
    const requests = this.app.services.store.getStudentRequests(this.subjectId).slice(0, 6);
    if (!requests.length) return "";
    const pendingCount = requests.filter((request) => !["approved", "rejected"].includes(request.status)).length;
    const labels = { pending: "بانتظار مراجعة المشرف", approved: "تم التنفيذ", rejected: "مرفوض" };
    const classes = { pending: "status-late", approved: "status-present", rejected: "status-absent" };
    return `
      <details class="student-request-status-panel">
        <summary>
          <span><i data-lucide="send"></i>حالة طلبات الإضافة والحذف</span>
          ${pendingCount ? `<b class="status-badge status-late">${pendingCount} بانتظار المراجعة</b>` : `<b class="status-badge status-present">لا توجد طلبات معلقة</b>`}
        </summary>
        <div class="request-status-list">
          ${requests.map((request) => {
            const status = request.status === "approved" || request.status === "rejected" ? request.status : "pending";
            return `
              <article>
                <strong>${request.studentName || "-"}</strong>
                <span>${request.type === "delete" ? "حذف طالب" : request.type === "update" ? "تعديل بيانات" : "إضافة طالب"}</span>
                <small>${request.resultMessage || request.note || "-"}</small>
                <b class="status-badge ${classes[status]}">${labels[status]}</b>
              </article>
            `;
          }).join("")}
        </div>
      </details>
    `;
  }

  updateStudentsList() {
    const students = this.app.services.store.getStudents(this.subjectId, this.query);
    qs("#students-list").innerHTML = students.map((student) => this.studentCard(student, false)).join("");
    this.bindStudentActions();
    renderIcons();
  }

  bindStudentActions() {
    document.querySelectorAll("[data-grade-view-student]").forEach((button) => button.addEventListener("click", () => {
      const student = this.app.services.store.getStudents(this.subjectId).find((item) => item.id === button.dataset.gradeViewStudent);
      this.query = student?.name || "";
      sessionStorage.setItem(`yusr-grade-focus-${this.subjectId}`, this.query);
      location.hash = `#/subject/${this.subjectId}/grades`;
    }));
    document.querySelectorAll("[data-edit-student]").forEach((button) => button.addEventListener("click", () => {
      const student = this.app.services.store.getStudents(this.subjectId).find((item) => item.id === button.dataset.editStudent);
      if (student) this.openStudentModal(student);
    }));
    document.querySelectorAll("[data-record-student]").forEach((button) => button.addEventListener("click", () => {
      const student = this.app.services.store.getStudents(this.subjectId).find((item) => item.id === button.dataset.recordStudent);
      if (student) this.openStudentRecord(student);
    }));
    document.querySelectorAll("[data-message-student]").forEach((button) => button.addEventListener("click", () => {
      const student = this.app.services.store.getStudents(this.subjectId).find((item) => item.id === button.dataset.messageStudent);
      if (student) this.openStudentMessageModal(student);
    }));
    document.querySelectorAll("[data-call-student]").forEach((button) => button.addEventListener("click", () => {
      const student = this.app.services.store.getStudents(this.subjectId).find((item) => item.id === button.dataset.callStudent);
      const phone = cleanPhone(student?.guardianPhone);
      if (!phone) return this.app.services.toast.show("لا يوجد رقم ولي أمر لهذا الطالب", "warning");
      window.location.href = `tel:${phone}`;
    }));
    document.querySelectorAll("[data-request-student]").forEach((button) => button.addEventListener("click", () => {
      const student = this.app.services.store.getStudents(this.subjectId).find((item) => item.id === button.dataset.requestStudent);
      this.openStudentRequestModal(student || null);
    }));
    document.querySelectorAll("[data-delete-student]").forEach((button) => button.addEventListener("click", async () => {
      if (!this.canDeleteStudents()) {
        this.app.services.toast.show("حذف الطلاب النهائي من صلاحيات المشرف. يمكنك إرسال طلب حذف بدلًا من ذلك.", "error");
        return;
      }
      const ok = await this.app.services.modal.confirm({
        title: "حذف الطالب",
        message: "هل تريد حذف هذا الطالب؟ سيتم حذف بياناته من قائمة الطلاب.",
        confirmLabel: "حذف",
        cancelLabel: "إلغاء",
        danger: true
      });
      if (!ok) return;
      await this.app.services.store.deleteStudent(this.subjectId, button.dataset.deleteStudent);
      this.app.services.toast.show("تم حذف الطالب", "success");
      this.updateStudentsList();
    }));
  }

  renderAttendance() {
    const settings = this.app.services.store.getSettings();
    const students = this.app.services.store.getStudents(this.subjectId, this.query);
    const sessions = this.attendanceSessionOptions();
    if (!sessions.some((session) => session.id === this.attendanceSessionId)) this.attendanceSessionId = "";
    const activeSession = sessions.find((session) => session.id === this.attendanceSessionId) || sessions[0];
    const attendance = this.app.services.store.getTodayAttendance(this.subjectId, this.attendanceSessionId);
    const summary = this.app.services.store.getAttendanceSummary(this.subjectId, this.attendanceSessionId);
    const subject = this.app.services.store.getSubject(this.subjectId, this.app.services.license.getActiveLicense());
    qs("#subject-body").innerHTML = `
      <section class="attendance-console">
        <article class="mini-stat present"><span>حاضر</span><strong>${summary.present}</strong></article>
        <article class="mini-stat absent"><span>غائب</span><strong>${summary.absent}</strong></article>
        <article class="mini-stat late"><span>متأخر</span><strong>${summary.late}</strong></article>
        <article class="mini-stat empty"><span>لم يحدد</span><strong>${summary.empty}</strong></article>
      </section>
      <div class="toolbar attendance-toolbar">
        <div class="attendance-heading">
          <span class="eyebrow">تحضير اليوم</span>
          <h2>${settings.attendanceMode === "swipe" ? "وضع السحب" : "وضع الأزرار"}</h2>
          <div class="segmented-control attendance-mode-control" aria-label="طريقة التحضير">
            <button class="${settings.attendanceMode === "buttons" ? "active" : ""}" data-mode-choice="buttons">الأزرار</button>
            <button class="${settings.attendanceMode === "swipe" ? "active" : ""}" data-mode-choice="swipe">السحب</button>
          </div>
        </div>
        <div class="toolbar-group attendance-toolbar-group">
          ${this.canAddStudents() ? `
            <button class="primary-button" id="add-attendance-student"><i data-lucide="user-plus"></i>إضافة طالب</button>
            <button class="ghost-button" id="import-attendance-students"><i data-lucide="upload"></i>استيراد Excel</button>
          ` : this.canSendStudentRequests() ? `<button class="ghost-button" id="request-attendance-student"><i data-lucide="send"></i>طلب طالب</button>` : ""}
          <select class="select-field" id="attendance-day">
            <option value="" ${this.scheduleDay ? "" : "selected"} disabled hidden>اختر اليوم</option>
            ${weekDays.map((day) => `<option value="${day}" ${day === this.scheduleDay ? "selected" : ""}>${day}</option>`).join("")}
          </select>
          <select class="select-field" id="attendance-session">
            <option value="" ${this.attendanceSessionId ? "" : "selected"} disabled hidden>اختر حصة</option>
            ${sessions.map((session) => `<option value="${session.id}" ${session.id === this.attendanceSessionId ? "selected" : ""}>${session.label}</option>`).join("")}
            ${sessions.length ? "" : `<option value="">لا توجد حصة مضافة</option>`}
          </select>
          ${sessions.length && this.attendanceSessionId ? `
            <div class="attendance-command-group">
              <button class="ghost-button" id="export-attendance"><i data-lucide="file-spreadsheet"></i>تصدير Excel</button>
              <button class="danger-button" id="clear-attendance"><i data-lucide="rotate-ccw"></i>مسح اليوم</button>
              <button class="primary-button" id="complete-attendance"><i data-lucide="save"></i>حفظ التحضير</button>
            </div>
          ` : ""}
        </div>
      </div>
      ${sessions.length && this.attendanceSessionId ? `
        <div class="smart-note"><i data-lucide="clock"></i><span>الحصة الحالية: ${activeSession.label}${activeSession.meta ? ` · ${activeSession.meta}` : ""}</span></div>
        ${settings.autoPresent ? `<div class="smart-note"><i data-lucide="sparkles"></i><span>الحضور التلقائي مفعل: حدد الغائبين والمتأخرين فقط، وسيتم تحويل الباقي إلى حاضر عند الحفظ.</span></div>` : ""}
        <input class="field attendance-search-field" id="attendance-search" placeholder="بحث سريع..." value="${this.query}" />
        <div class="students-list" id="attendance-list">${students.map((student) => this.studentCard(student, true, attendance[student.id], settings.attendanceMode)).join("")}</div>
      ` : this.scheduleDay ? (sessions.length ? `<div class="empty-state compact"><i data-lucide="calendar-check"></i><h3>اختر حصة</h3><p>اختر وقت الحصة من القائمة حتى تظهر أسماء الطلاب للتحضير.</p></div>` : `<div class="empty-state"><i data-lucide="calendar-days"></i><h3>لا توجد حصة مضافة</h3><p>أضف حصة لهذه المادة من قسم الحصص حتى يظهر التحضير هنا.</p></div>`) : `<div class="empty-state compact"><i data-lucide="calendar-days"></i><h3>اختر اليوم</h3><p>اختر يوم الحصة أولًا حتى تظهر الحصص المتاحة.</p></div>`}
    `;
    qs("#attendance-search")?.addEventListener("input", (event) => {
      this.query = event.target.value;
      this.updateAttendanceList();
    });
    qs("#add-attendance-student")?.addEventListener("click", () => this.openStudentModal());
    qs("#import-attendance-students")?.addEventListener("click", () => this.openImportStudentsModal());
    qs("#request-attendance-student")?.addEventListener("click", () => this.openStudentRequestModal());
    qs("#attendance-day").addEventListener("change", (event) => {
      this.scheduleDay = event.target.value;
      this.attendanceSessionId = "";
      this.renderAttendance();
    });
    qs("#attendance-session").addEventListener("change", (event) => {
      this.attendanceSessionId = event.target.value;
      this.renderAttendance();
    });
    document.querySelectorAll("[data-mode-choice]").forEach((button) => button.addEventListener("click", async () => {
      await this.app.services.store.updateSettings({ attendanceMode: button.dataset.modeChoice });
      this.renderAttendance();
    }));
    qs("#export-attendance")?.addEventListener("click", () => exportAttendanceCsv(subject, students, attendance));
    qs("#clear-attendance")?.addEventListener("click", async () => {
      await this.app.services.store.clearTodayAttendance(this.subjectId, this.attendanceSessionId);
      this.app.services.toast.show("تم مسح تحضير هذه الحصة", "success");
      this.renderAttendance();
    });
    qs("#complete-attendance")?.addEventListener("click", async () => {
      await this.app.services.store.completeAttendance(this.subjectId, this.attendanceSessionId);
      this.app.services.toast.show(settings.autoPresent ? "تم حفظ التحضير وتحديد الباقي حاضر" : "تم حفظ التحضير", "success");
      this.renderAttendance();
    });
    this.bindAttendanceButtons();
    if (settings.attendanceMode === "swipe") this.bindSwipeCards();
    renderIcons();
  }

  updateAttendanceList() {
    const settings = this.app.services.store.getSettings();
    const students = this.app.services.store.getStudents(this.subjectId, this.query);
    const attendance = this.app.services.store.getTodayAttendance(this.subjectId, this.attendanceSessionId);
    qs("#attendance-list").innerHTML = students.map((student) => this.studentCard(student, true, attendance[student.id], settings.attendanceMode)).join("");
    this.bindAttendanceButtons();
    if (settings.attendanceMode === "swipe") this.bindSwipeCards();
    renderIcons();
  }

  bindAttendanceButtons() {
    document.querySelectorAll("[data-status]").forEach((button) => button.addEventListener("click", async () => {
      await this.app.services.store.setAttendance(this.subjectId, button.dataset.student, button.dataset.status, this.attendanceSessionId);
      this.renderAttendance();
    }));
  }

  attendanceSessionOptions() {
    const activeLicense = this.app.services.license.getActiveLicense();
    const lessons = this.app.services.store.getSchedule(null, activeLicense)
      .filter((item) => item.subjectId === this.subjectId && sameWeekday(item.day, this.scheduleDay))
      .sort((a, b) => String(a.start || "").localeCompare(String(b.start || "")));
    if (lessons.length) {
      return lessons.map((lesson, index) => {
        const institution = this.app.services.store.getInstitutions(activeLicense).find((item) => item.id === lesson.institutionId);
        return {
          id: `lesson-${lesson.id}`,
          label: `${lesson.start} - ${lesson.end}`,
          meta: `${institution?.name || "بدون جهة"} · ${lesson.room || "بدون قاعة"}`
        };
      });
    }
    return [];
  }

  renderAttendanceSheet() {
    this.ensureSheetPeriod();
    const students = this.app.services.store.getStudents(this.subjectId, this.query);
    const settings = this.app.services.store.getSettings();
    const month = this.app.services.store.getMonthlyAttendance(this.subjectId, this.sheetDate());
    const sessionOptions = this.sheetSessionOptions();
    const allColumns = this.attendanceSheetColumns(month);
    if (!sessionOptions.some((session) => session.id === this.sheetSessionFilter)) this.sheetSessionFilter = "";
    const columns = this.filteredSheetColumns(allColumns);
    qs("#subject-body").innerHTML = `
      <div class="toolbar">
        <div><span class="eyebrow">كشف شهري</span><h2>${month.monthName}</h2></div>
        <div class="toolbar-group">
          <select class="select-field" id="sheet-month-filter">
            ${sheetMonthOptions(settings.dateCalendar, this.sheetYear).map((item) => `<option value="${item.value}" ${item.value === this.sheetMonth ? "selected" : ""}>${item.label}</option>`).join("")}
          </select>
          <select class="select-field" id="sheet-year-filter">
            ${sheetYearOptions(settings.dateCalendar, this.sheetYear).map((year) => `<option value="${year}" ${year === this.sheetYear ? "selected" : ""}>${formatSheetYear(year, settings.dateCalendar)}</option>`).join("")}
          </select>
          <select class="select-field" id="sheet-day-filter">
            <option value="" ${this.scheduleDay ? "" : "selected"} disabled hidden>اختر اليوم</option>
            ${weekDays.map((day) => `<option value="${day}" ${day === this.scheduleDay ? "selected" : ""}>${day}</option>`).join("")}
          </select>
          <select class="select-field" id="sheet-session-filter" ${sessionOptions.length ? "" : "disabled"}>
            <option value="" ${this.sheetSessionFilter ? "" : "selected"} disabled hidden>اختر حصة</option>
            ${sessionOptions.map((session) => `<option value="${session.id}" ${this.sheetSessionFilter === session.id ? "selected" : ""}>${session.label}</option>`).join("")}
          ${sessionOptions.length ? "" : `<option value="">لا توجد حصة مضافة</option>`}
          </select>
        </div>
      </div>
      <div class="smart-note"><i data-lucide="calendar-days"></i><span>${this.scheduleDay ? (sessionOptions.length ? "القائمة تعرض حصص اليوم فقط، والجدول يعرض كشف هذه الحصة من بداية الشهر." : "لا توجد حصة مضافة لهذه المادة في جدول حصص اليوم.") : "اختر اليوم أولًا ثم اختر الحصة لعرض الكشف."}</span></div>
      <input class="field sheet-search-field" id="sheet-search" placeholder="بحث باسم الطالب..." value="${this.query}" />
      ${columns.length ? `<div class="table-shell attendance-sheet">
        <table>
          <thead>
            <tr>
              <th class="sticky-num" rowspan="2">#</th>
              <th class="sticky-col" rowspan="2">الطالب</th>
              ${columns.map((column) => `<th class="sheet-date-head">${column.day.label}</th>`).join("")}
            </tr>
            <tr>
              ${columns.map((column) => `<th class="sheet-weekday-head">${column.day.weekday}<br><small>${column.sessionLabel}</small></th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${students.map((student, index) => `
              <tr>
                <td class="sticky-num">${index + 1}</td>
                <td class="sticky-col"><strong>${student.name}</strong></td>
                ${columns.map((column) => {
                  const status = this.attendanceSheetStatus(month, column, student.id);
                  return `<td><span class="sheet-status ${statusClass(status).replace("status-", "")}">${statusShortLabel(status)}</span></td>`;
                }).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>` : this.scheduleDay ? `<div class="empty-state"><i data-lucide="calendar-days"></i><h3>لا توجد حصة مضافة</h3><p>أضف حصة لهذه المادة في هذا اليوم من قسم الحصص حتى يظهر الكشف هنا.</p></div>` : `<div class="empty-state compact"><i data-lucide="calendar-days"></i><h3>اختر اليوم</h3><p>اختر اليوم ثم الحصة لعرض الكشف الشهري.</p></div>`}
    `;
    qs("#sheet-search").addEventListener("input", (event) => {
      this.query = event.target.value;
      this.updateAttendanceSheetBody();
    });
    qs("#sheet-month-filter").addEventListener("change", (event) => {
      this.sheetMonth = Number(event.target.value);
      this.sheetSessionFilter = "";
      this.renderAttendanceSheet();
    });
    qs("#sheet-year-filter").addEventListener("change", (event) => {
      this.sheetYear = Number(event.target.value);
      this.sheetSessionFilter = "";
      this.renderAttendanceSheet();
    });
    qs("#sheet-day-filter").addEventListener("change", (event) => {
      this.scheduleDay = event.target.value;
      this.sheetSessionFilter = "";
      this.renderAttendanceSheet();
    });
    qs("#sheet-session-filter").addEventListener("change", (event) => {
      this.sheetSessionFilter = event.target.value;
      this.renderAttendanceSheet();
    });
    renderIcons();
  }

  updateAttendanceSheetBody() {
    const students = this.app.services.store.getStudents(this.subjectId, this.query);
    const month = this.app.services.store.getMonthlyAttendance(this.subjectId, this.sheetDate());
    const columns = this.filteredSheetColumns(this.attendanceSheetColumns(month));
    const body = qs(".attendance-sheet tbody");
    body.innerHTML = students.map((student, index) => `
      <tr>
        <td class="sticky-num">${index + 1}</td>
        <td class="sticky-col"><strong>${student.name}</strong></td>
        ${columns.map((column) => {
          const status = this.attendanceSheetStatus(month, column, student.id);
          return `<td><span class="sheet-status ${statusClass(status).replace("status-", "")}">${statusShortLabel(status)}</span></td>`;
        }).join("")}
      </tr>
    `).join("");
  }

  attendanceSheetColumns(month) {
    const lessons = this.app.services.store.getSchedule(null, this.app.services.license.getActiveLicense())
      .filter((lesson) => lesson.subjectId === this.subjectId)
      .sort((a, b) => String(a.start || "").localeCompare(String(b.start || "")));
    return month.days.map((day) => {
      const weekday = fullWeekdayName(day.key);
      const scheduledLesson = lessons.find((item) => sameWeekday(item.day, weekday) && sameLessonTime(item, this.sheetSessionFilter));
      const recordedKey = this.recordedSheetSessionKey(month, day.key, this.sheetSessionFilter);
      const lesson = scheduledLesson || lessonFromAttendanceKey(recordedKey, lessons);
      const label = lesson ? `${lesson.start} - ${lesson.end}` : this.sheetSessionLabel();
      const keyCandidates = [
        recordedKey,
        scheduledLesson ? `${day.key}__lesson-${scheduledLesson.id}` : null,
        lesson ? `${day.key}__lesson-${lesson.id}` : null,
        this.sheetSessionFilter ? `${day.key}__${this.sheetSessionFilter}` : null,
        this.sheetSessionFilter ? `${day.key}__${normalizeTimeKey(this.sheetSessionFilter)}` : null,
        lesson ? `${day.key}__${lessonTimeKey(lesson)}` : null
      ].filter(Boolean);
      return {
        key: keyCandidates[0] || null,
        keys: [...new Set(keyCandidates)],
        legacyKey: null,
        day,
        sessionId: this.sheetSessionFilter,
        sessionLabel: label,
        sessionTime: label,
        sessionTimeKey: this.sheetSessionFilter
      };
    });
  }

  filteredSheetColumns(columns) {
    return this.sheetSessionFilter ? columns : [];
  }

  sheetSessionOptions() {
    const seen = new Map();
    const month = this.app.services.store.getMonthlyAttendance(this.subjectId, this.sheetDate());
    const activeLicense = this.app.services.license.getActiveLicense();
    const lessons = this.app.services.store.getSchedule(null, activeLicense).filter((lesson) => lesson.subjectId === this.subjectId);
    this.app.services.store.getSchedule(null, activeLicense)
      .filter((lesson) => lesson.subjectId === this.subjectId && sameWeekday(lesson.day, this.scheduleDay))
      .sort((a, b) => String(a.start || "").localeCompare(String(b.start || "")))
      .forEach((lesson) => {
        const key = lessonTimeKey(lesson);
        if (!seen.has(key)) seen.set(key, `${lesson.start} - ${lesson.end}`);
      });
    month.days
      .filter((day) => sameWeekday(fullWeekdayName(day.key), this.scheduleDay))
      .forEach((day) => {
        Object.keys(month.sessions || {})
          .filter((key) => key.startsWith(`${day.key}__`))
          .forEach((key) => {
            const lesson = lessonFromAttendanceKey(key, lessons);
            const sessionId = parseSheetSessionId(key);
            if (!lesson && !isTimeSessionId(sessionId)) return;
            const timeKey = lesson ? lessonTimeKey(lesson) : sessionId;
            const label = lesson ? `${lesson.start} - ${lesson.end}` : this.attendanceSessionLabel(sessionId);
            if (!seen.has(timeKey)) seen.set(timeKey, label);
          });
      });
    return [...seen.entries()].map(([id, label]) => ({ id, label }));
  }

  attendanceSheetStatus(month, column, studentId) {
    const keys = column.keys?.length ? column.keys : [column.key, column.legacyKey].filter(Boolean);
    for (const key of keys) {
      const status = month.sessions[key]?.[studentId];
      if (status) return status;
    }
    return "empty";
  }

  ensureSheetPeriod() {
    if (this.sheetMonth && this.sheetYear) return;
    const settings = this.app.services.store.getSettings();
    const parts = calendarMonthParts(new Date(), settings.dateCalendar);
    this.sheetMonth = parts.month;
    this.sheetYear = parts.year;
  }

  sheetDate() {
    const settings = this.app.services.store.getSettings();
    this.ensureSheetPeriod();
    return dateForCalendarMonth(this.sheetYear, this.sheetMonth, settings.dateCalendar);
  }

  recordedSheetSessionKey(month, date, timeKey) {
    if (!timeKey) return null;
    if (month.sessions?.[`${date}__${timeKey}`]) return `${date}__${timeKey}`;
    const lessonId = selectedLessonId(timeKey);
    if (lessonId && month.sessions?.[`${date}__lesson-${lessonId}`]) return `${date}__lesson-${lessonId}`;
    const lessons = this.app.services.store.getSchedule(null, this.app.services.license.getActiveLicense()).filter((lesson) => lesson.subjectId === this.subjectId);
    return Object.keys(month.sessions || {}).find((key) => {
      if (!key.startsWith(`${date}__`)) return false;
      const sessionId = parseSheetSessionId(key);
      if (normalizeTimeKey(sessionId) === normalizeTimeKey(timeKey)) return true;
      const lesson = lessonFromAttendanceKey(key, lessons);
      return lesson && sameLessonTime(lesson, timeKey);
    }) || null;
  }

  sheetSessionLabel() {
    return this.sheetSessionOptions().find((session) => session.id === this.sheetSessionFilter)?.label || "لا توجد حصة مضافة";
  }

  attendanceSessionLabel(sessionId) {
    const manual = {
      "session-1": "حصة محفوظة",
      "session-2": "حصة محفوظة",
      "session-3": "حصة محفوظة"
    };
    if (manual[sessionId]) return manual[sessionId];
    if (sessionId?.startsWith("lesson-")) {
      const lessonId = sessionId.replace("lesson-", "");
      const lesson = this.app.services.store.getSchedule(null, this.app.services.license.getActiveLicense()).find((item) => item.id === lessonId);
      if (lesson) return `${lesson.start}-${lesson.end}`;
    }
    if (/^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(normalizeTimeKey(sessionId))) {
      return normalizeTimeKey(sessionId).replace("-", " - ");
    }
    return "لا توجد حصة مضافة";
  }

  renderGrades() {
    const pendingFocus = sessionStorage.getItem(`yusr-grade-focus-${this.subjectId}`);
    if (pendingFocus) {
      this.query = pendingFocus;
      sessionStorage.removeItem(`yusr-grade-focus-${this.subjectId}`);
    }
    const subject = this.app.services.store.getSubject(this.subjectId, this.app.services.license.getActiveLicense());
    const students = this.app.services.store.getStudents(this.subjectId, this.query);
    const columns = this.app.services.store.getGradeColumns(this.subjectId);
    const canManageColumns = this.canManageGradeColumns();
    const canUseBoost = this.canUseGradeBoost();
    qs("#subject-body").innerHTML = `
      <div class="toolbar">
        <div><span class="eyebrow">الدرجات</span><h2>جدول درجات ديناميكي</h2></div>
        <div class="toolbar-group">
          ${canManageColumns ? `<button class="ghost-button grades-add-column-desktop" id="add-column"><i data-lucide="columns-3"></i>إضافة عمود</button>` : ""}
          ${canUseBoost ? `<button class="ghost-button" id="grade-boost"><i data-lucide="sparkles"></i>منح تحسين</button>` : ""}
          <button class="ghost-button" id="export-grades"><i data-lucide="file-spreadsheet"></i>تصدير Excel</button>
        </div>
      </div>
      <input class="field grades-search-field grades-search-desktop" data-grades-search placeholder="بحث عن طالب..." value="${this.query}" />
      <div class="table-shell">
        <table>
          <thead><tr><th>الطالب</th><th>الحضور</th>${columns.map((column) => `<th ${canManageColumns ? `draggable="true" data-column-head="${column.id}"` : ""}>${canManageColumns ? `<span class="drag-handle">⋮⋮</span>` : ""} ${column.label}<br><small>${column.max} درجة</small>${canManageColumns ? `<div class="toolbar-group"><button class="status-button" data-edit-column="${column.id}">تعديل</button><button class="status-button" data-remove-column="${column.id}">حذف</button></div>` : ""}</th>`).join("")}<th>المجموع</th></tr></thead>
          <tbody>
            ${this.gradeRowsHtml(students, columns)}
          </tbody>
        </table>
      </div>
      ${canManageColumns ? `<section class="panel compact-panel grade-column-manager">
        <div class="panel-header">
          <div><span class="eyebrow">أعمدة الدرجات</span><h3>تعديل الأعمدة</h3></div>
          <button class="primary-button" id="add-column-mobile"><i data-lucide="columns-3"></i>إضافة عمود</button>
        </div>
        <div class="grade-column-list">
          ${columns.length ? columns.map((column, index) => `
            <article class="grade-column-item">
              <div><strong>${column.label}</strong><span>${column.max} درجة</span></div>
              <div class="grade-column-actions">
                <button class="status-button" data-move-column="${column.id}" data-move-direction="up" ${index === 0 ? "disabled" : ""}>أعلى</button>
                <button class="status-button" data-move-column="${column.id}" data-move-direction="down" ${index === columns.length - 1 ? "disabled" : ""}>أسفل</button>
                <button class="status-button" data-edit-column="${column.id}">تعديل</button>
                <button class="status-button danger-text" data-remove-column="${column.id}">حذف</button>
              </div>
            </article>
          `).join("") : `<div class="empty-state compact"><i data-lucide="columns-3"></i><h3>لا توجد أعمدة بعد</h3></div>`}
        </div>
      </section>` : ""}
      <input class="field grades-search-field grades-search-mobile" data-grades-search placeholder="بحث عن طالب..." value="${this.query}" />
      <div class="grades-mobile">${this.gradeCardsHtml(students, columns)}</div>
    `;
    qs("#add-column")?.addEventListener("click", () => this.openColumnModal());
    qs("#add-column-mobile")?.addEventListener("click", () => this.openColumnModal());
    qs("#grade-boost")?.addEventListener("click", () => this.openGradeBoostModal());
    qs("#export-grades").addEventListener("click", () => exportGradesCsv(subject, students, columns, (studentId) => this.app.services.store.getGrades(this.subjectId, studentId)));
    document.querySelectorAll("[data-grades-search]").forEach((input) => input.addEventListener("input", (event) => {
      this.query = event.target.value;
      this.updateGradesResults();
    }));
    document.querySelectorAll("[data-edit-column]").forEach((button) => button.addEventListener("click", () => this.openColumnModal(columns.find((column) => column.id === button.dataset.editColumn))));
    document.querySelectorAll("[data-remove-column]").forEach((button) => button.addEventListener("click", async () => {
      const column = columns.find((item) => item.id === button.dataset.removeColumn);
      const ok = await this.app.services.modal.confirm({
        title: "حذف عمود الدرجات",
        message: `هل تريد حذف عمود ${column?.label || "الدرجات"}؟ سيتم حذف درجات هذا العمود من جميع الطلاب.`,
        confirmLabel: "حذف العمود",
        cancelLabel: "إلغاء",
        danger: true
      });
      if (!ok) return;
      await this.app.services.store.deleteGradeColumn(this.subjectId, button.dataset.removeColumn);
      this.app.services.toast.show("تم حذف عمود الدرجات", "success");
      this.renderGrades();
    }));
    document.querySelectorAll("[data-move-column]").forEach((button) => button.addEventListener("click", async () => {
      const currentIndex = columns.findIndex((column) => column.id === button.dataset.moveColumn);
      const targetIndex = button.dataset.moveDirection === "up" ? currentIndex - 1 : currentIndex + 1;
      const target = columns[targetIndex];
      if (!target) return;
      await this.app.services.store.reorderGradeColumn(this.subjectId, button.dataset.moveColumn, target.id);
      this.renderGrades();
    }));
    document.querySelectorAll("[data-column-head]").forEach((head) => {
      head.addEventListener("dragstart", (event) => event.dataTransfer.setData("text/plain", head.dataset.columnHead));
      head.addEventListener("dragover", (event) => event.preventDefault());
      head.addEventListener("drop", async (event) => {
        event.preventDefault();
        await this.app.services.store.reorderGradeColumn(this.subjectId, event.dataTransfer.getData("text/plain"), head.dataset.columnHead);
        this.renderGrades();
      });
    });
    this.bindGradeInputs();
    renderIcons();
  }

  updateGradesResults() {
    const students = this.app.services.store.getStudents(this.subjectId, this.query);
    const columns = this.app.services.store.getGradeColumns(this.subjectId);
    document.querySelectorAll("[data-grades-search]").forEach((input) => {
      if (input.value !== this.query) input.value = this.query;
    });
    qs(".table-shell tbody").innerHTML = this.gradeRowsHtml(students, columns);
    qs(".grades-mobile").innerHTML = this.gradeCardsHtml(students, columns);
    this.bindGradeInputs();
  }

  gradeRowsHtml(students, columns) {
    return students.map((student) => {
      const grades = this.app.services.store.getGrades(this.subjectId, student.id);
      const total = columns.reduce((sum, column) => sum + safeNumber(grades[column.id]), 0);
      return `<tr><td>${student.name}</td><td>${Math.max(0, 100 - student.absenceCount * 5)}%</td>${columns.map((column) => `<td><input type="number" min="0" max="${column.max}" value="${grades[column.id] ?? 0}" data-grade-student="${student.id}" data-grade-column="${column.id}" /></td>`).join("")}<td><strong data-grade-total="${student.id}">${total}</strong></td></tr>`;
    }).join("");
  }

  gradeCardsHtml(students, columns) {
    return students.map((student) => {
      const grades = this.app.services.store.getGrades(this.subjectId, student.id);
      const total = columns.reduce((sum, column) => sum + safeNumber(grades[column.id]), 0);
      return `
        <article class="grade-card">
          <div class="card-header">
            <div><h3>${student.name}</h3></div>
          </div>
          <div class="grade-fields">
            ${columns.map((column) => `<label>${column.label}<input type="number" min="0" max="${column.max}" value="${grades[column.id] ?? 0}" data-grade-student="${student.id}" data-grade-column="${column.id}" /></label>`).join("")}
          </div>
          <div class="grade-total-row"><span>المجموع</span><strong data-grade-total="${student.id}">${total}</strong></div>
        </article>
      `;
    }).join("");
  }

  bindGradeInputs() {
    document.querySelectorAll("[data-grade-student]").forEach((input) => {
      input.addEventListener("focus", () => {
        if (input.value === "0") input.value = "";
      });
      input.addEventListener("blur", () => {
        if (String(input.value).trim() === "") input.value = "0";
      });
      input.addEventListener("input", async () => {
        const columns = this.app.services.store.getGradeColumns(this.subjectId);
        const column = columns.find((item) => item.id === input.dataset.gradeColumn);
        const max = safeNumber(column?.max);
        const value = safeNumber(input.value);
        if (max && value > max) {
          input.value = max;
          this.app.services.toast.show(`لا يمكن إدخال درجة أكبر من ${max} في ${column.label}`, "error");
        }
        if (value < 0) input.value = 0;
        await this.app.services.store.setGrade(this.subjectId, input.dataset.gradeStudent, input.dataset.gradeColumn, input.value);
        this.updateVisibleGradeTotals(input.dataset.gradeStudent);
      });
    });
  }

  renderStats() {
    const students = this.app.services.store.getStudents(this.subjectId);
    const columns = this.app.services.store.getGradeColumns(this.subjectId);
    const presentRate = this.app.services.store.getAttendanceRate(this.subjectId);
    const gradeRows = this.gradeStatsRows(students, columns);
    const gradedRows = gradeRows.filter((row) => row.hasGrades);
    const failedRows = gradeRows.filter((row) => row.failed);
    const passedRows = gradeRows.filter((row) => row.hasGrades && !row.failed);
    const maxTotal = columns.reduce((sum, column) => sum + safeNumber(column.max), 0);
    const average = gradedRows.length ? Math.round(gradedRows.reduce((sum, row) => sum + row.percent, 0) / gradedRows.length) : 0;
    if (!this.statsColumnId || !columns.some((column) => column.id === this.statsColumnId)) this.statsColumnId = columns[0]?.id || null;
    const groupViews = statsViewsForGroup(this.statsGroup);
    if (!groupViews.some(([id]) => id === this.statsView)) this.statsView = groupViews[0]?.[0] || "absent";
    qs("#subject-body").innerHTML = `
      <div class="analytics-layout">
        <article class="panel stat-insight">
          <span class="eyebrow">نسبة الحضور العامة</span>
          <strong>${presentRate}%</strong>
          <div class="progress"><span style="width:${presentRate}%"></span></div>
        </article>
        <article class="panel stat-insight success">
          <span class="eyebrow">الطلاب الناجحون</span>
          <strong>${passedRows.length}</strong>
          <p class="muted">${gradedRows.length ? `${Math.round((passedRows.length / gradedRows.length) * 100)}% من الطلاب المدخلة درجاتهم` : "لم تدخل درجات بعد"}</p>
        </article>
        <article class="panel stat-insight danger">
          <span class="eyebrow">الطلاب الراسبون</span>
          <strong>${failedRows.length}</strong>
          <p class="muted">الرسوب يعتمد على المجموع</p>
        </article>
        <article class="panel stat-insight">
          <span class="eyebrow">متوسط الدرجات</span>
          <strong>${average}%</strong>
          <p class="muted">من ${maxTotal || 0} درجة</p>
        </article>
        <article class="panel stats-browser">
          <div class="panel-header"><h3>تفاصيل الإحصائيات</h3></div>
          <div class="stats-group-tabs">
            ${statsGroupTab("attendance", "قسم الحضور", this.statsGroup)}
            ${statsGroupTab("performance", "قسم الأداء", this.statsGroup)}
            ${statsGroupTab("analysis", "قسم التحليل", this.statsGroup)}
          </div>
          <div class="stats-tabs">
            ${groupViews.map(([id, label]) => statsTab(id, label, this.statsView)).join("")}
          </div>
          <div class="stats-detail">${this.statsDetailHtml(students, columns, gradeRows)}</div>
        </article>
      </div>
    `;
    document.querySelectorAll("[data-stats-group]").forEach((button) => button.addEventListener("click", () => {
      this.statsGroup = button.dataset.statsGroup;
      this.statsView = statsViewsForGroup(this.statsGroup)[0]?.[0] || "absent";
      this.renderStats();
    }));
    document.querySelectorAll("[data-stats-view]").forEach((button) => button.addEventListener("click", () => {
      this.statsView = button.dataset.statsView;
      this.renderStats();
    }));
    qs("#stats-column-select")?.addEventListener("change", (event) => {
      this.statsColumnId = event.target.value;
      this.renderStats();
    });
    renderIcons();
  }

  gradeStatsRows(students, columns) {
    const maxTotal = columns.reduce((sum, column) => sum + safeNumber(column.max), 0);
    const passMark = maxTotal * 0.5;
    return students.map((student) => {
      const grades = this.app.services.store.getGrades(this.subjectId, student.id);
      const hasGrades = columns.some((column) => Object.hasOwn(grades, column.id));
      const total = columns.reduce((sum, column) => sum + safeNumber(grades[column.id]), 0);
      const percent = hasGrades && maxTotal ? Math.round((total / maxTotal) * 100) : 0;
      return { student, grades, hasGrades, total, percent, failed: hasGrades && total < passMark };
    });
  }

  statsDetailHtml(students, columns, gradeRows) {
    const settings = this.app.services.store.getSettings();
    if (this.statsView === "absent") {
      const rows = students.filter((student) => student.absenceCount >= settings.absenceLimit).sort((a, b) => b.absenceCount - a.absenceCount);
      return this.rankingPanel("الطلاب الأكثر غيابًا", rows, "absenceCount", "غياب", "status-absent");
    }
    if (this.statsView === "late") {
      const rows = students.filter((student) => student.lateCount > 0).sort((a, b) => b.lateCount - a.lateCount);
      return this.rankingPanel("التأخير", rows, "lateCount", "تأخير", "status-late");
    }
    if (this.statsView === "best") {
      const rows = [...students].sort((a, b) => a.absenceCount - b.absenceCount || a.lateCount - b.lateCount);
      return this.rankingPanel("أفضل الطلاب حضورًا", rows, "absenceCount", "غياب", "status-present");
    }
    if (this.statsView === "failed") {
      const rows = gradeRows.filter((row) => row.failed).sort((a, b) => a.total - b.total);
      return this.gradeStatsTable("الرسوب", rows);
    }
    if (this.statsView === "risk") {
      const rows = gradeRows.filter((row) => row.hasGrades && row.percent < 60).sort((a, b) => a.total - b.total);
      return this.gradeStatsTable("الطلاب المعرضون للخطر", rows);
    }
    if (this.statsView === "column") return this.columnStatsHtml(columns, gradeRows);
    return this.distributionStatsHtml(gradeRows);
  }

  gradeStatsTable(title, rows) {
    return `<article class="panel"><div class="panel-header"><h3>${title}</h3></div><div class="table-shell"><table><thead><tr><th>#</th><th>الطالب</th><th>المجموع</th><th>النسبة</th><th>الحالة</th></tr></thead><tbody>${rows.length ? rows.map((row, index) => `<tr><td>${index + 1}</td><td>${row.student.name}</td><td>${row.total}</td><td>${row.percent}%</td><td>${row.failed ? "راسب" : "بحاجة متابعة"}</td></tr>`).join("") : `<tr><td colspan="5">لا توجد بيانات لعرضها</td></tr>`}</tbody></table></div></article>`;
  }

  distributionStatsHtml(rows) {
    const graded = rows.filter((row) => row.hasGrades);
    const groups = [
      ["ممتاز", graded.filter((row) => row.percent >= 90)],
      ["جيد جدًا", graded.filter((row) => row.percent >= 80 && row.percent < 90)],
      ["جيد", graded.filter((row) => row.percent >= 70 && row.percent < 80)],
      ["مقبول", graded.filter((row) => row.percent >= 50 && row.percent < 70)],
      ["راسب", graded.filter((row) => row.failed)]
    ];
    const max = Math.max(1, ...groups.map(([, items]) => items.length));
    return `<article class="panel"><div class="panel-header"><h3>توزيع الدرجات</h3></div><div class="distribution-tables">${groups.map(([label, items]) => `
      <section class="distribution-table-card">
        <div class="distribution-table-head">
          <strong>${label}</strong>
          <span>${studentCountLabel(items.length)}</span>
        </div>
        <div class="distribution-bar"><span style="width:${Math.round((items.length / max) * 100)}%"></span></div>
        <div class="table-shell compact-table">
          <table>
            <thead><tr><th>#</th><th>الطالب</th><th>المجموع</th><th>النسبة</th></tr></thead>
            <tbody>${items.length ? items.map((row, index) => `<tr><td>${index + 1}</td><td>${row.student.name}</td><td>${row.total}</td><td>${row.percent}%</td></tr>`).join("") : `<tr><td colspan="4">لا يوجد</td></tr>`}</tbody>
          </table>
        </div>
      </section>
    `).join("")}</div></article>`;
  }

  columnStatsHtml(columns, rows) {
    if (!columns.length) return `<div class="empty-state compact"><i data-lucide="table-properties"></i><h3>لا توجد أعمدة درجات</h3></div>`;
    const column = columns.find((item) => item.id === this.statsColumnId) || columns[0];
    const values = rows.map((row) => ({ row, value: safeNumber(row.grades[column.id]), hasGrade: Object.hasOwn(row.grades, column.id) }));
    const needsSupport = values.filter((item) => item.hasGrade && item.value < column.max / 2);
    const good = values.filter((item) => item.hasGrade && item.value >= column.max / 2);
    const list = (items, empty) => items.length ? items.map((item) => `<li class="grade-mini-row"><strong>${item.row.student.name}</strong><span>${item.value} / ${column.max}</span></li>`).join("") : `<li class="muted">${empty}</li>`;
    return `<article class="panel"><div class="panel-header"><h3>تحليل عمود الدرجات</h3><select class="select-field compact-select" id="stats-column-select">${columns.map((item) => `<option value="${item.id}" ${item.id === column.id ? "selected" : ""}>${item.label}</option>`).join("")}</select></div><div class="column-analysis-grid"><div class="column-analysis-list"><h4>بحاجة دعم</h4><ul>${list(needsSupport, "لا يوجد")}</ul></div><div class="column-analysis-list"><h4>مستوى مطمئن</h4><ul>${list(good, "لا يوجد")}</ul></div></div></article>`;
  }

  renderSubjectSettings() {
    const subject = this.app.services.store.getSubject(this.subjectId, this.app.services.license.getActiveLicense());
    const settings = this.app.services.store.getSettings();
    const teacherOptions = this.assignmentOptions(subject?.assignedTeacherCode || "");
    qs("#subject-body").innerHTML = `
      <form class="settings-grid" id="subject-settings-form">
        <section class="settings-section">
          <h3>بيانات المادة</h3>
          <label>اسم المادة<input class="field" name="name" value="${subject.name}" /></label>
          <label>الفصل أو الشعبة<input class="field" name="className" value="${subject.className || ""}" placeholder="مثال: ثالث ثانوي / شعبة أ" /></label>
          <label>رمز المادة<input class="field" name="code" value="${subject.code}" /></label>
          <label>القاعة<input class="field" name="room" value="${subject.room || ""}" /></label>
          ${teacherOptions}
        </section>
        <section class="settings-section">
          <h3>طريقة التحضير</h3>
          <label>طريقة التحضير
            <select class="select-field" name="attendanceMode">
              <option value="swipe" ${settings.attendanceMode === "swipe" ? "selected" : ""}>السحب</option>
              <option value="buttons" ${settings.attendanceMode === "buttons" ? "selected" : ""}>الأزرار</option>
            </select>
          </label>
          <label>حد الغياب<input class="field" type="number" min="1" max="30" name="absenceLimit" value="${settings.absenceLimit}" /></label>
          ${this.switchRow("autoPresent", "تفعيل الحضور التلقائي للباقي", settings.autoPresent)}
        </section>
        <section class="settings-section">
          <h3>التنبيهات والبحث</h3>
          ${this.switchRow("notifications", "تفعيل التنبيهات", settings.notifications)}
          ${this.switchRow("quickSearch", "تفعيل البحث السريع", settings.quickSearch)}
          <label>ترتيب الطلاب
            <select class="select-field" name="studentSort">
              <option value="alpha" ${settings.studentSort === "alpha" ? "selected" : ""}>أبجدي</option>
              <option value="absence" ${settings.studentSort === "absence" ? "selected" : ""}>الأكثر غيابًا</option>
              <option value="best" ${settings.studentSort === "best" ? "selected" : ""}>الأفضل حضورًا</option>
            </select>
          </label>
        </section>
        <section class="settings-section">
          <h3>الألوان الذكية</h3>
          <div class="legend-list">
            <span><i class="legend-dot present"></i>أخضر = حاضر</span>
            <span><i class="legend-dot absent"></i>أحمر = غائب</span>
            <span><i class="legend-dot late"></i>أصفر = متأخر</span>
          </div>
          <div class="toolbar-group">
            <button class="ghost-button" type="button" id="subject-help"><i data-lucide="circle-help"></i>المساعدة وتعليمات الاستخدام</button>
            <button class="primary-button subject-save"><i data-lucide="save"></i>حفظ الإعدادات</button>
          </div>
        </section>
      </form>
    `;
    qs("#subject-settings-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.target));
      await this.app.services.store.updateSubject(this.subjectId, {
        name: data.name,
        code: data.code,
        className: data.className,
        room: data.room,
        ...this.assignmentPatch(data.assignedTeacherCode)
      });
      await this.app.services.store.updateSettings({
        attendanceMode: data.attendanceMode,
        absenceLimit: Number(data.absenceLimit),
        studentSort: data.studentSort,
        autoPresent: qs('[data-name="autoPresent"]').classList.contains("active"),
        notifications: qs('[data-name="notifications"]').classList.contains("active"),
        quickSearch: qs('[data-name="quickSearch"]').classList.contains("active")
      });
      this.app.services.sync.scheduleManagedAccountSync(0);
      this.app.services.toast.show("تم حفظ إعدادات المادة", "success");
      this.render(this.subjectId, "settings");
    });
    document.querySelectorAll(".switch").forEach((button) => button.addEventListener("click", () => button.classList.toggle("active")));
    qs("#subject-help").addEventListener("click", () => this.openHelpGuide());
    renderIcons();
  }

  assignmentOptions(selectedCode = "") {
    if (this.app.services.license.getActiveLicense()?.accessMode !== "admin") return "";
    const active = this.app.services.license.getActiveLicense();
    const teachers = mergeTeacherOptions(this.app.services.license.listManagedCodes(active?.code).filter((item) => ["teacher", "delegate"].includes(item.accessMode)));
    const selected = selectedCode || (teachers.length === 1 ? teachers[0].code : "");
    return `
      <label>الحساب المرتبط
        <select class="select-field" name="assignedTeacherCode" ${teachers.length ? "required" : ""}>
          <option value="" ${selected ? "" : "selected"} disabled>${teachers.length ? "اختر المعلم أو المندوب" : "لا توجد أكواد تابعة"}</option>
          ${teachers.map((teacher) => `<option value="${teacher.code}" ${teacher.code === selected ? "selected" : ""}>${teacher.name}</option>`).join("")}
        </select>
      </label>
      <p class="muted">المادة المرتبطة تظهر للحساب المحدد فقط، مع طلابها وحصصها.</p>
    `;
  }

  assignmentPatch(code = "") {
    if (this.app.services.license.getActiveLicense()?.accessMode !== "admin") return {};
    const selectedCode = String(code || "").trim().toUpperCase();
    if (!selectedCode) return { assignedTeacherCode: "", assignedTeacherName: "" };
    const active = this.app.services.license.getActiveLicense();
    const teacher = this.app.services.license.listManagedCodes(active?.code).find((item) => String(item.code || "").trim().toUpperCase() === selectedCode);
    return {
      assignedTeacherCode: selectedCode,
      assignedTeacherName: teacher?.ownerName || teacher?.customerName || "حساب تابع"
    };
  }

  openHelpGuide() {
    this.app.services.modal.open({
      title: "المساعدة وتعليمات استخدام يُسر",
      body: `
        <div class="help-guide">
          <article><h3><i data-lucide="building-2"></i> الجهات التعليمية</h3><p>ابدأ بإضافة جهة من قسم الحصص، لأن المواد والطلاب والكشوفات تكون داخل جهة محددة.</p></article>
          <article><h3><i data-lucide="book-open"></i> المواد والطلاب</h3><p>بعد اختيار الجهة الحالية أضف المادة، ثم أضف الطلاب يدويًا أو عن طريق Excel.</p></article>
          <article><h3><i data-lucide="phone"></i> رقم ولي الأمر</h3><p>عند إضافة طالب اكتب رقم ولي الأمر حتى تعمل أزرار الاتصال ورسائل واتساب وSMS، ويمكن استيراد الرقم تلقائيًا من Excel.</p></article>
          <article><h3><i data-lucide="calendar-days"></i> جدول الحصص</h3><p>أضف وقت الحصة لكل مادة. التطبيق يمنع تداخل حصتين في نفس اليوم والوقت.</p></article>
          <article><h3><i data-lucide="check-check"></i> التحضير</h3><p>اختر اليوم ثم الحصة، وبعدها حضر الطلاب بالأزرار أو السحب. بعد الحفظ يظهر التحضير في الكشف الشهري.</p></article>
          <article><h3><i data-lucide="send"></i> طلبات المعلم</h3><p>إذا كان الحساب تابعًا لمشرف، تظهر حالة طلبات الإضافة والحذف داخل زر قابل للفتح في صفحة الطلاب.</p></article>
          <article><h3><i data-lucide="table-properties"></i> الدرجات</h3><p>أضف أعمدة درجات مخصصة وحدد الدرجة العظمى. يمكن ترتيب الأعمدة وحساب المجموع تلقائيًا.</p></article>
          <article><h3><i data-lucide="bar-chart-3"></i> الإحصائيات والتصدير</h3><p>تفاصيل الإحصائيات مقسمة إلى الحضور، الأداء، والتحليل حتى لا تظهر كل الجداول دفعة واحدة.</p></article>
        </div>
      `,
      actions: [{ label: "فهمت", variant: "primary", action: "close" }]
    });
    renderIcons();
  }

  studentCard(student, attendanceMode = false, status = null, mode = "buttons") {
    const settings = this.app.services.store.getSettings();
    const riskClass = student.absenceCount >= settings.absenceLimit ? "risk" : student.lateCount >= 4 ? "warning" : "";
    const canEdit = this.canEditStudents();
    const canDelete = this.canDeleteStudents();
    const canRequest = this.canSendStudentRequests();
    const statusHtml = attendanceMode ? this.statusControls(student.id, status, mode) : `
      <span class="status-badge status-empty">غياب ${student.absenceCount} · تأخير ${student.lateCount}</span>
      <button class="ghost-button" data-grade-view-student="${student.id}"><i data-lucide="table-properties"></i>درجاته</button>
      <button class="ghost-button" data-record-student="${student.id}"><i data-lucide="history"></i>السجل</button>
      <button class="ghost-button" data-message-student="${student.id}"><i data-lucide="message-square-text"></i>رسالة</button>
      ${student.guardianPhone ? `<button class="ghost-button" data-call-student="${student.id}"><i data-lucide="phone"></i>اتصال</button>` : ""}
      ${canEdit ? `<button class="ghost-button" data-edit-student="${student.id}"><i data-lucide="pencil"></i>تعديل</button>` : ""}
      ${canRequest ? `<button class="ghost-button" data-request-student="${student.id}"><i data-lucide="send"></i>طلب</button>` : ""}
      ${canDelete ? `<button class="danger-button" data-delete-student="${student.id}"><i data-lucide="trash-2"></i>حذف</button>` : ""}
    `;
    return `
      <article class="student-card ${riskClass} ${attendanceMode && mode === "swipe" ? "swipe-card" : ""}" data-swipe-student="${student.id}">
        <div class="student-main">
          <span class="student-avatar">${initials(student.name)}</span>
          <div class="student-name"><strong>${student.name}</strong><span>غياب ${student.absenceCount} · تأخير ${student.lateCount}${student.guardianPhone ? ` · ولي الأمر ${student.guardianPhone}` : ""}</span>${student.notes ? `<small class="student-note">${student.notes}</small>` : ""}</div>
        </div>
        <div class="student-actions ${attendanceMode ? "attendance-actions" : "student-management-actions"}">${statusHtml}</div>
      </article>
    `;
  }

  rankingPanel(title, students, field, suffix, badgeClass) {
    return `
      <article class="panel ranking-panel">
        <div class="panel-header"><h3>${title}</h3></div>
        <div class="ranking-list">
          ${students.length ? students.map((student, index) => `
            <div class="ranking-row">
              <span class="rank">${index + 1}</span>
              <strong>${student.name}</strong>
              <span class="status-badge ${badgeClass}">${student[field]} ${suffix}</span>
            </div>
          `).join("") : `<div class="empty-state compact"><i data-lucide="circle-check"></i><h3>لا توجد بيانات لعرضها</h3></div>`}
        </div>
      </article>
    `;
  }

  scheduleSearchRender(callback) {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(callback, 180);
  }

  statusControls(studentId, status, mode) {
    if (mode === "swipe") return `<span class="status-badge ${statusClass(status)}">${statusLabel(status)}</span><span class="swipe-hint">اسحب يمينًا للحضور، يسارًا للغياب، ضغط مطوّل للتأخير</span>`;
    return `
      <button class="status-button present ${status === "present" ? "active" : ""}" data-student="${studentId}" data-status="present">حاضر</button>
      <button class="status-button absent ${status === "absent" ? "active" : ""}" data-student="${studentId}" data-status="absent">غائب</button>
      <button class="status-button late ${status === "late" ? "active" : ""}" data-student="${studentId}" data-status="late">متأخر</button>
    `;
  }

  switchRow(name, label, checked) {
    return `<div class="switch-row"><span>${label}</span><button class="switch ${checked ? "active" : ""}" type="button" data-name="${name}" aria-label="${label}"><span></span></button></div>`;
  }

  bindSwipeCards() {
    document.querySelectorAll(".swipe-card").forEach((card) => {
      let startX = 0;
      let longPress;
      card.addEventListener("pointerdown", (event) => {
        startX = event.clientX;
        card.setPointerCapture(event.pointerId);
        longPress = setTimeout(async () => {
          await this.app.services.store.setAttendance(this.subjectId, card.dataset.swipeStudent, "late", this.attendanceSessionId);
          this.renderAttendance();
        }, 620);
      });
      card.addEventListener("pointermove", (event) => {
        const delta = event.clientX - startX;
        card.style.setProperty("--swipe-x", `${delta}px`);
        card.classList.toggle("swiping", Math.abs(delta) > 8);
        card.classList.toggle("feedback-present", delta > 50);
        card.classList.toggle("feedback-absent", delta < -50);
      });
      card.addEventListener("pointerup", async (event) => {
        clearTimeout(longPress);
        const delta = event.clientX - startX;
        if (delta > 80) await this.app.services.store.setAttendance(this.subjectId, card.dataset.swipeStudent, "present", this.attendanceSessionId);
        if (delta < -80) await this.app.services.store.setAttendance(this.subjectId, card.dataset.swipeStudent, "absent", this.attendanceSessionId);
        this.renderAttendance();
      });
    });
  }

  openStudentRecord(student) {
    const columns = this.app.services.store.getGradeColumns(this.subjectId);
    const grades = this.app.services.store.getGrades(this.subjectId, student.id);
    const history = this.app.services.store.getStudentAttendanceHistory(this.subjectId, student.id);
    const total = columns.reduce((sum, column) => sum + safeNumber(grades[column.id]), 0);
    const maxTotal = columns.reduce((sum, column) => sum + safeNumber(column.max), 0);
    this.app.services.modal.open({
      title: `سجل الطالب: ${student.name}`,
      body: `
        <div class="student-record">
          <section>
            <h3>ملخص الطالب</h3>
            <div class="record-summary">
              <span>الغياب <strong>${student.absenceCount}</strong></span>
              <span>التأخير <strong>${student.lateCount}</strong></span>
              <span>المجموع <strong>${maxTotal ? `${total} / ${maxTotal}` : "لم تدخل الدرجات"}</strong></span>
            </div>
            ${student.notes ? `<p class="muted">${student.notes}</p>` : ""}
          </section>
          <section>
            <h3>الدرجات</h3>
            <table class="mini-table"><thead><tr><th>العمود</th><th>الدرجة</th><th>العظمى</th></tr></thead><tbody>
              ${columns.length ? columns.map((column) => `<tr><td>${column.label}</td><td>${grades[column.id] ?? "-"}</td><td>${column.max}</td></tr>`).join("") : `<tr><td colspan="3">لا توجد أعمدة درجات</td></tr>`}
            </tbody></table>
          </section>
          <section>
            <h3>سجل التحضير</h3>
            <table class="mini-table"><thead><tr><th>التاريخ</th><th>الحصة</th><th>الحالة</th></tr></thead><tbody>
              ${history.length ? history.slice(0, 30).map((item) => `<tr><td>${item.date}</td><td>${this.attendanceSessionLabel(item.sessionId)}</td><td>${statusLabel(item.status)}</td></tr>`).join("") : `<tr><td colspan="3">لا يوجد سجل تحضير لهذا الطالب</td></tr>`}
            </tbody></table>
          </section>
        </div>
      `,
      actions: [
        { label: "إنشاء رسالة", action: () => {
          this.app.services.modal.close();
          setTimeout(() => this.openStudentMessageModal(student), 0);
          return false;
        } },
        { label: "إغلاق", variant: "primary", action: "close" }
      ]
    });
  }

  openStudentMessageModal(student) {
    const subject = this.app.services.store.getSubject(this.subjectId, this.app.services.license.getActiveLicense());
    const columns = this.app.services.store.getGradeColumns(this.subjectId);
    const grades = this.app.services.store.getGrades(this.subjectId, student.id);
    const total = columns.reduce((sum, column) => sum + safeNumber(grades[column.id]), 0);
    const maxTotal = columns.reduce((sum, column) => sum + safeNumber(column.max), 0);
    const guardianPhone = cleanPhone(student.guardianPhone);
    const templates = [
      `تنبيه بخصوص الطالب ${student.name}: لديه ${student.absenceCount} غياب و${student.lateCount} تأخير في مادة ${subject.name}. نرجو المتابعة.`,
      `تقرير مختصر: الطالب ${student.name} في مادة ${subject.name}، المجموع الحالي ${maxTotal ? `${total} من ${maxTotal}` : "لم تدخل الدرجات بعد"}، الغياب ${student.absenceCount}، التأخير ${student.lateCount}.`,
      `نرجو الاهتمام بالحضور في مادة ${subject.name}. الطالب ${student.name} يحتاج متابعة لتحسين الالتزام والنتيجة.`
    ];
    this.app.services.modal.open({
      title: `رسائل جاهزة: ${student.name}`,
      body: `${guardianPhone ? `<div class="smart-note compact-note"><i data-lucide="phone"></i><span>الرسائل والاتصال مرتبطة برقم ولي الأمر: ${guardianPhone}</span></div>` : `<div class="smart-note compact-note warning-note"><i data-lucide="phone-off"></i><span>لا يوجد رقم ولي أمر لهذا الطالب. أضف الرقم من زر تعديل الطالب.</span></div>`}
      <div class="message-template-list">${templates.map((text, index) => `
        <article class="message-template">
          <textarea readonly id="student-message-${index}">${text}</textarea>
          <div class="toolbar-group">
            <button class="ghost-button" data-edit-message="${index}"><i data-lucide="pencil"></i>تعديل</button>
            <button class="ghost-button" data-copy-message="${index}"><i data-lucide="copy"></i>نسخ</button>
            <button class="ghost-button" data-share-message="${index}" ${guardianPhone ? "" : "disabled"}><i data-lucide="send"></i>نوع الرسالة: واتساب</button>
            <button class="ghost-button" data-sms-message="${index}" ${guardianPhone ? "" : "disabled"}><i data-lucide="message-square-text"></i>نوع الرسالة: SMS</button>
            <button class="ghost-button" data-call-guardian ${guardianPhone ? "" : "disabled"}><i data-lucide="phone"></i>اتصال</button>
          </div>
        </article>
      `).join("")}</div>`,
      actions: [{ label: "إغلاق", variant: "primary", action: "close" }]
    });
    document.querySelectorAll("[data-edit-message]").forEach((button) => button.addEventListener("click", () => {
      const textarea = qs(`#student-message-${button.dataset.editMessage}`);
      const isReadonly = textarea.hasAttribute("readonly");
      if (isReadonly) {
        textarea.removeAttribute("readonly");
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        button.innerHTML = `<i data-lucide="check"></i>تم`;
      } else {
        textarea.setAttribute("readonly", "");
        button.innerHTML = `<i data-lucide="pencil"></i>تعديل`;
      }
      renderIcons();
    }));
    document.querySelectorAll("[data-copy-message]").forEach((button) => button.addEventListener("click", async () => {
      const text = qs(`#student-message-${button.dataset.copyMessage}`).value;
      await navigator.clipboard?.writeText(text);
      this.app.services.toast.show("تم نسخ الرسالة", "success");
    }));
    document.querySelectorAll("[data-share-message]").forEach((button) => button.addEventListener("click", () => {
      const text = qs(`#student-message-${button.dataset.shareMessage}`).value;
      if (!guardianPhone) return;
      window.open(`https://wa.me/${guardianPhone.replace(/^\+/, "")}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
    }));
    document.querySelectorAll("[data-sms-message]").forEach((button) => button.addEventListener("click", () => {
      const text = qs(`#student-message-${button.dataset.smsMessage}`).value;
      if (!guardianPhone) return;
      window.location.href = `sms:${guardianPhone}?body=${encodeURIComponent(text)}`;
    }));
    document.querySelectorAll("[data-call-guardian]").forEach((button) => button.addEventListener("click", () => {
      if (!guardianPhone) return;
      window.location.href = `tel:${guardianPhone}`;
    }));
    renderIcons();
  }

  openStudentModal(student = null) {
    if (!student && !this.canAddStudents()) {
      this.openStudentRequestModal();
      return;
    }
    if (student && !this.canEditStudents()) {
      this.app.services.toast.show("تعديل بيانات الطالب غير مفعل لهذا الحساب", "error");
      return;
    }
    this.app.services.modal.open({
      title: student ? "تعديل طالب" : "إضافة طالب",
      body: `<form class="form-grid" id="student-form">
        <label>اسم الطالب<input name="name" required placeholder="مثال: أحمد محمد" value="${student?.name || ""}" /></label>
        <label>رقم ولي الأمر<input name="guardianPhone" inputmode="tel" placeholder="مثال: 05xxxxxxxx أو 77xxxxxxx" value="${student?.guardianPhone || ""}" /></label>
        <label>ملاحظات<textarea name="notes">${student?.notes || ""}</textarea></label>
      </form>`,
      actions: [
        { label: "إلغاء", action: "close" },
        { label: "حفظ", variant: "primary", action: async (root) => {
          const form = root.querySelector("#student-form");
          if (!form.reportValidity()) return false;
          const payload = Object.fromEntries(new FormData(form));
          const result = student
            ? await this.app.services.store.updateStudent(this.subjectId, student.id, payload)
            : await this.app.services.store.addStudent(this.subjectId, payload);
          if (!result?.ok) {
            this.app.services.toast.show(result?.reason === "duplicate" ? "لا يمكن إضافة اسم طالب مكرر" : "تأكد من اسم الطالب", "error");
            return false;
          }
          this.app.services.toast.show(student ? "تم تعديل الطالب" : "تمت إضافة الطالب", "success");
          this.app.services.sync.scheduleManagedAccountSync(0);
          const subjectId = this.subjectId;
          const activeTab = this.activeTab;
          this.render(subjectId, activeTab);
          setTimeout(() => this.render(subjectId, activeTab), 0);
          return true;
        }}
      ]
    });
  }

  openImportStudentsModal() {
    if (!this.canAddStudents()) {
      this.openStudentRequestModal();
      return;
    }
    this.app.services.modal.open({
      title: "استيراد الطلاب",
      body: `
        <form class="form-grid" id="import-students-form">
          <label>ملف Excel أو CSV<input name="file" type="file" accept=".xlsx,.xls,.csv,.txt" /></label>
          <label>أو الصق الأسماء هنا<textarea name="names" placeholder="كل اسم في سطر، ويمكن كتابة رقم ولي الأمر بعد الاسم&#10;مثال: أمين سمير أمين اليوسفي 778530052"></textarea></label>
          <p class="muted">سيتم اكتشاف عمود الأسماء تلقائيًا حتى لو كان الملف يحتوي على عدة أعمدة. ويمكن من اللصق إضافة الاسم ورقم ولي الأمر في نفس السطر. الأسماء المكررة لن تتم إضافتها مرة أخرى.</p>
        </form>
      `,
      actions: [
        { label: "إلغاء", action: "close" },
        { label: "استيراد", variant: "primary", action: async (root) => {
          const form = root.querySelector("#import-students-form");
          const file = form.file.files[0];
          const pasted = form.names.value.split(/\r?\n/);
          const fileResult = file ? await this.readStudentRowsFile(file) : { rows: [], hasPhoneColumn: false };
          if (file && !fileResult.hasPhoneColumn) {
            const proceed = await this.app.services.modal.confirm({
              title: "استيراد بدون أرقام",
              message: "لم يتم العثور على عمود واضح لأرقام أولياء الأمور. هل تريد استيراد أسماء الطلاب فقط؟",
              confirmLabel: "استيراد الأسماء فقط",
              cancelLabel: "إلغاء"
            });
            if (!proceed) return false;
          }
          const pastedRows = pasted.map(parsePastedStudentLine).filter((item) => item.name);
          const added = await this.app.services.store.importStudents(this.subjectId, [...fileResult.rows, ...pastedRows]);
          this.app.services.toast.show(`تم استيراد ${added} طالب`, "success");
          this.app.services.sync.scheduleManagedAccountSync(0);
          this.render(this.subjectId, this.activeTab);
        }}
      ]
    });
  }

  async readStudentRowsFile(file) {
    if (file.name.match(/\.(xlsx|xls)$/i) && window.XLSX) {
      const buffer = await file.arrayBuffer();
      const workbook = window.XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
      return extractStudentsFromRows(rows);
    }
    const text = await file.text();
    const rows = text.split(/\r?\n/).map((line) => line.split(/[,\t;]/));
    return extractStudentsFromRows(rows);
  }

  updateVisibleGradeTotals(studentId) {
    const columns = this.app.services.store.getGradeColumns(this.subjectId);
    const grades = this.app.services.store.getGrades(this.subjectId, studentId);
    const total = columns.reduce((sum, column) => sum + safeNumber(grades[column.id]), 0);
    document.querySelectorAll(`[data-grade-total="${studentId}"]`).forEach((target) => {
      target.textContent = total;
    });
  }

  openStudentRequestModal(student = null) {
    if (!this.canSendStudentRequests()) {
      this.app.services.toast.show("طلبات المعلم غير مفعلة لهذا الحساب", "error");
      return;
    }
    const subject = this.app.services.store.getSubject(this.subjectId, this.app.services.license.getActiveLicense());
    this.app.services.modal.open({
      title: student ? `طلب بخصوص ${student.name}` : "طلب إضافة/حذف طالب",
      body: `
        <form class="form-grid" id="student-request-form">
          <p class="muted">سيصل الطلب للمشرف ضمن بيانات الحساب عند توفر المزامنة.</p>
          <label>نوع الطلب
            <select class="select-field" name="type">
              <option value="add">إضافة طالب</option>
              <option value="delete" ${student ? "selected" : ""}>حذف طالب</option>
              <option value="update">تعديل بيانات</option>
            </select>
          </label>
          <label>اسم الطالب<input name="studentName" required placeholder="اسم الطالب" value="${student?.name || ""}" /></label>
          <label>المادة/الفصل<input class="field" value="${subject?.name || ""}" disabled /></label>
          <label>ملاحظة الطلب<textarea name="note" placeholder="اكتب سبب الطلب أو أي تفاصيل يحتاجها المشرف"></textarea></label>
        </form>
      `,
      actions: [
        { label: "إلغاء", action: "close" },
        { label: "إرسال الطلب", variant: "primary", action: async (root) => {
          const form = root.querySelector("#student-request-form");
          if (!form.reportValidity()) return false;
          const data = Object.fromEntries(new FormData(form));
          const result = await this.app.services.store.addStudentRequest({
            ...data,
            subjectId: this.subjectId,
            studentId: student?.id || "",
            requestedBy: this.app.services.store.getSettings().teacherName
          });
          if (!result.ok) {
            this.app.services.toast.show("اكتب اسم الطالب أولًا", "error");
            return false;
          }
          this.app.services.toast.show("تم إرسال الطلب للمشرف", "success");
          this.app.services.sync.scheduleManagedAccountSync(0);
          return true;
        }}
      ]
    });
  }

  openGradeBoostModal() {
    const columns = this.app.services.store.getGradeColumns(this.subjectId);
    if (!columns.length) {
      this.app.services.toast.show("أضف عمود درجات أولًا", "error");
      return;
    }
    this.app.services.modal.open({
      title: "منح درجات تحسين",
      body: `
        <form class="form-grid" id="grade-boost-form">
          <p class="muted">تمنح الزيادة لكل الطلاب دون تجاوز الدرجة العظمى. وإذا اكتمل العمود المختار يمكن ترحيل الزيادة المتبقية لعمود آخر بعد التأكيد.</p>
          <label>مقدار التحسين<input name="amount" type="number" min="1" step="0.5" required value="2" /></label>
          <label>عمود التحسين
            <select class="select-field" name="columnId" required>
              ${columns.map((column) => `<option value="${column.id}">${column.label} · ${column.max} درجة</option>`).join("")}
            </select>
          </label>
        </form>
      `,
      actions: [
        { label: "إلغاء", action: "close" },
        { label: "تطبيق التحسين", variant: "primary", action: async (root) => {
          const form = root.querySelector("#grade-boost-form");
          if (!form.reportValidity()) return false;
          const data = Object.fromEntries(new FormData(form));
          const amount = safeNumber(data.amount);
          if (amount <= 0) return false;
          const preview = this.app.services.store.previewGradeBoost(this.subjectId, data.columnId, amount);
          let allowRollover = false;
          if (preview.rolloverCandidates > 0) {
            allowRollover = await this.app.services.modal.confirm({
              title: "ترحيل الزيادة المتبقية",
              message: `يوجد ${preview.rolloverCandidates} طالب لا يمكنه أخذ كامل التحسين في العمود المحدد. هل تريد ترحيل الزيادة المتبقية إلى أعمدة أخرى ناقصة؟`,
              confirmLabel: "نعم، رحّل الزيادة",
              cancelLabel: "لا، العمود المحدد فقط",
              danger: false
            });
          }
          const result = await this.app.services.store.applyGradeBoost(this.subjectId, data.columnId, amount, { allowRollover });
          if (result.updatedStudents) this.app.services.toast.show(`تم تحسين ${result.updatedStudents} طالب. المجموع المضاف: ${result.addedTotal} درجة`, "success");
          else this.app.services.toast.show("لم تتم إضافة درجات لأن الطلاب حصلوا على الدرجة الكاملة", "error");
          this.renderGrades();
          return true;
        }}
      ]
    });
  }

  openColumnModal(column = null) {
    if (!this.canManageGradeColumns()) {
      this.app.services.toast.show("إضافة وتعديل أعمدة الدرجات غير مفعّلة لهذا الحساب", "warning");
      return;
    }
    this.app.services.modal.open({
      title: column ? "تعديل عمود درجات" : "إضافة عمود درجات",
      body: `<form class="form-grid" id="column-form"><label>اسم العمود<input name="label" required placeholder="مثال: المشاركة" value="${column?.label || ""}" /></label><label>الدرجة العظمى<input name="max" type="number" min="1" required value="${column?.max || 10}" /></label></form>`,
      actions: [
        { label: "إلغاء", action: "close" },
        { label: "حفظ", variant: "primary", action: async (root) => {
          const form = root.querySelector("#column-form");
          if (!form.reportValidity()) return false;
          const data = Object.fromEntries(new FormData(form));
          if (column) await this.app.services.store.updateGradeColumn(this.subjectId, column.id, { label: data.label, max: Number(data.max) });
          else await this.app.services.store.addGradeColumn(this.subjectId, { label: data.label, max: Number(data.max) });
          this.renderGrades();
        }}
      ]
    });
  }

  openDeleteSubjectModal(subject) {
    if (!this.canManageSubjects()) {
      this.app.services.toast.show("حذف المواد والفصول من صلاحيات المشرف", "error");
      return;
    }
    this.app.services.modal.open({
      title: "حذف المادة",
      body: `
        <div class="empty-state compact">
          <i data-lucide="triangle-alert"></i>
          <h3>هل تريد حذف مادة ${subject.name}؟</h3>
          <p>سيتم حذف الطلاب والتحضير والدرجات المرتبطة بهذه المادة من هذا الجهاز.</p>
        </div>
      `,
      actions: [
        { label: "إلغاء", action: "close" },
        { label: "حذف المادة", variant: "danger", action: async () => {
          await this.app.services.store.deleteSubject(subject.id);
          this.app.services.toast.show("تم حذف المادة", "success");
          location.hash = "#/subjects";
        }}
      ]
    });
  }

  pdfTitle() {
    const titles = {
      students: "كشف الطلاب",
      attendance: "كشف حضور اليوم",
      sheet: "الكشف الشهري",
      grades: "كشف الدرجات",
      stats: "تقرير الإحصائيات",
      settings: "بيانات المادة"
    };
    return titles[this.activeTab] || "تقرير";
  }

  buildPdfReport() {
    if (this.activeTab === "grades") return this.gradesReportHtml();
    if (this.activeTab === "sheet") return this.sheetReportHtml();
    if (this.activeTab === "attendance") return this.attendanceReportHtml();
    if (this.activeTab === "stats") return this.statsReportHtml();
    return this.studentsReportHtml();
  }

  openPdfTemplateModal(subject) {
    const templates = [
      ["current", "القسم الحالي", "تصدير الصفحة المفتوحة حاليًا"],
      ["students", "كشف الطلاب", "أسماء الطلاب مع الغياب والتأخير"],
      ["attendance", "تحضير اليوم", "حالة الطلاب في الحصة المختارة"],
      ["sheet", "كشف شهري", "كشف الحضور للحصة خلال الشهر"],
      ["grades", "كشف الدرجات", "جدول الدرجات والمجموع"],
      ["stats", "تقرير شامل", "الإحصائيات وتوزيع الدرجات وتحليل الأعمدة"]
    ];
    this.app.services.modal.open({
      title: "اختيار قالب PDF",
      body: `<div class="template-grid">${templates.map(([id, title, description]) => `
        <button class="template-card" data-pdf-template="${id}">
          <i data-lucide="${id === "stats" ? "bar-chart-3" : id === "grades" ? "table-properties" : id === "sheet" ? "calendar-days" : "file-text"}"></i>
          <strong>${title}</strong>
          <span>${description}</span>
        </button>
      `).join("")}</div>`,
      actions: [{ label: "إلغاء", action: "close" }]
    });
    document.querySelectorAll("[data-pdf-template]").forEach((button) => button.addEventListener("click", () => {
      const settings = this.app.services.store.getSettings();
      const template = button.dataset.pdfTemplate;
      const currentTab = this.activeTab;
      if (template !== "current") this.activeTab = template;
      const html = this.buildPdfReport();
      const title = this.pdfTitle();
      this.activeTab = currentTab;
      this.app.services.modal.close();
      exportReportPdf(subject, html, title, { calendar: settings.dateCalendar });
    }));
    renderIcons();
  }

  studentsReportHtml() {
    const students = this.app.services.store.getStudents(this.subjectId);
    return `<table><thead><tr><th>#</th><th>الطالب</th><th>الغياب</th><th>التأخير</th></tr></thead><tbody>${students.map((student, index) => `<tr><td>${index + 1}</td><td>${student.name}</td><td>${student.absenceCount}</td><td>${student.lateCount}</td></tr>`).join("")}</tbody></table>`;
  }

  attendanceReportHtml() {
    const students = this.app.services.store.getStudents(this.subjectId);
    const session = this.attendanceSessionOptions().find((item) => item.id === this.attendanceSessionId) || { label: "لا توجد حصة مضافة", meta: "" };
    const attendance = this.app.services.store.getTodayAttendance(this.subjectId, this.attendanceSessionId);
    return `<section class="attendance-session-report"><h2>بيانات الحصة</h2><table><tbody><tr><th>الحصة</th><td>${session.label}</td></tr>${session.meta ? `<tr><th>التفاصيل</th><td>${session.meta}</td></tr>` : ""}</tbody></table></section><table><thead><tr><th>#</th><th>الطالب</th><th>الحالة</th></tr></thead><tbody>${students.map((student, index) => `<tr><td>${index + 1}</td><td>${student.name}</td><td>${statusLabel(attendance[student.id])}</td></tr>`).join("")}</tbody></table>`;
  }

  gradesReportHtml() {
    const students = this.app.services.store.getStudents(this.subjectId);
    const columns = this.app.services.store.getGradeColumns(this.subjectId);
    return `<table class="grades-report"><thead><tr><th>#</th><th>الطالب</th>${columns.map((column) => `<th>${column.label}<br><small>${column.max} درجة</small></th>`).join("")}<th>المجموع</th></tr></thead><tbody>${students.map((student, index) => {
      const grades = this.app.services.store.getGrades(this.subjectId, student.id);
      const total = columns.reduce((sum, column) => sum + safeNumber(grades[column.id]), 0);
      return `<tr><td>${index + 1}</td><td>${student.name}</td>${columns.map((column) => `<td>${grades[column.id] ?? 0}</td>`).join("")}<td class="total-cell">${total}</td></tr>`;
    }).join("")}</tbody></table>`;
  }

  sheetReportHtml() {
    const students = this.app.services.store.getStudents(this.subjectId);
    const month = this.app.services.store.getMonthlyAttendance(this.subjectId, this.sheetDate());
    const allColumns = this.attendanceSheetColumns(month);
    const columns = this.filteredSheetColumns(allColumns);
    const title = columns[0]?.sessionLabel || "لا توجد حصة مضافة";
    return this.sheetReportTableHtml(month, students, columns, `${month.monthName} · ${title}`);
  }

  sheetReportTableHtml(month, students, columns, title) {
    return `<section class="monthly-report-section"><h2>${title}</h2><table class="monthly-report"><thead><tr><th>#</th><th>الطالب</th>${columns.map((column) => `<th><span class="vertical-day"><b>${column.day.label}</b><em>${column.day.weekday}</em></span></th>`).join("")}</tr></thead><tbody>${students.map((student, index) => `<tr><td>${index + 1}</td><td>${student.name}</td>${columns.map((column) => `<td>${statusShortLabel(this.attendanceSheetStatus(month, column, student.id))}</td>`).join("")}</tr>`).join("")}</tbody></table></section>`;
  }

  statsReportHtml() {
    const students = this.app.services.store.getStudents(this.subjectId);
    const columns = this.app.services.store.getGradeColumns(this.subjectId);
    const gradeRows = this.gradeStatsRows(students, columns);
    const gradedRows = gradeRows.filter((row) => row.hasGrades);
    const failedRows = gradeRows.filter((row) => row.failed);
    const passedRows = gradeRows.filter((row) => row.hasGrades && !row.failed);
    const settings = this.app.services.store.getSettings();
    const absentRows = students.filter((student) => student.absenceCount >= settings.absenceLimit).sort((a, b) => b.absenceCount - a.absenceCount);
    const lateRows = students.filter((student) => student.lateCount > 0).sort((a, b) => b.lateCount - a.lateCount);
    const bestRows = [...students].sort((a, b) => a.absenceCount - b.absenceCount || a.lateCount - b.lateCount);
    const riskRows = gradeRows.filter((row) => row.hasGrades && row.percent < 60).sort((a, b) => a.total - b.total);
    const avg = gradedRows.length ? Math.round(gradedRows.reduce((sum, row) => sum + row.percent, 0) / gradedRows.length) : 0;
    const gradeDetails = gradeRows.map((row, index) => `<tr><td>${index + 1}</td><td>${row.student.name}</td>${columns.map((column) => `<td>${row.grades[column.id] ?? 0}</td>`).join("")}<td class="total-cell">${row.hasGrades ? row.total : "لم تدخل"}</td><td>${row.hasGrades ? `${row.percent}%` : "-"}</td><td>${row.hasGrades ? (row.failed ? "راسب" : "ناجح") : "لم تدخل الدرجات"}</td></tr>`).join("");
    const distributionTable = this.distributionReportTableHtml(gradeRows);
    const columnAnalysisTable = this.columnAnalysisReportHtml(columns, gradeRows);
    return `
      <section class="stats-report">
        <div class="summary-grid">
          <article class="summary-card"><span>عدد الطلاب</span><strong>${students.length}</strong></article>
          <article class="summary-card"><span>متوسط الدرجات</span><strong>${avg}%</strong></article>
          <article class="summary-card"><span>الناجحون</span><strong>${passedRows.length}</strong></article>
          <article class="summary-card"><span>الراسبون</span><strong>${failedRows.length}</strong></article>
        </div>
        <h2>تفصيل درجات الطلاب</h2>
        <table class="grades-report"><thead><tr><th>#</th><th>الطالب</th>${columns.map((column) => `<th>${column.label}<br><small>${column.max} درجة</small></th>`).join("")}<th>المجموع</th><th>النسبة</th><th>الحالة</th></tr></thead><tbody>${gradeDetails}</tbody></table>
        <h2>الطلاب الأكثر غيابًا</h2>
        ${this.attendanceRankingReportTable(absentRows, "absenceCount", "غياب")}
        <h2>التأخير</h2>
        ${this.attendanceRankingReportTable(lateRows, "lateCount", "تأخير")}
        <h2>أفضل الطلاب حضورًا</h2>
        ${this.bestAttendanceReportTable(bestRows)}
        <h2>الرسوب</h2>
        ${this.gradeRowsReportTable(failedRows, "لا يوجد طلاب راسبون")}
        <h2>الطلاب المعرضون للخطر</h2>
        ${this.gradeRowsReportTable(riskRows, "لا يوجد طلاب معرضون للخطر")}
        <h2>توزيع الدرجات</h2>
        ${distributionTable}
        <h2>تحليل أعمدة الدرجات</h2>
        ${columnAnalysisTable}
      </section>
    `;
  }

  attendanceRankingReportTable(rows, field, unit) {
    return `<table class="pdf-tight-table ranking-report"><thead><tr><th>#</th><th>الطالب</th><th>العدد</th><th>الوصف</th></tr></thead><tbody>${rows.length ? rows.map((student, index) => `<tr><td>${index + 1}</td><td>${student.name}</td><td>${student[field]}</td><td>${student[field]} ${unit}</td></tr>`).join("") : `<tr><td colspan="4">لا توجد بيانات لعرضها</td></tr>`}</tbody></table>`;
  }

  bestAttendanceReportTable(rows) {
    return `<table class="pdf-tight-table ranking-report"><thead><tr><th>#</th><th>الطالب</th><th>الغياب</th><th>التأخير</th></tr></thead><tbody>${rows.length ? rows.map((student, index) => `<tr><td>${index + 1}</td><td>${student.name}</td><td>${student.absenceCount}</td><td>${student.lateCount}</td></tr>`).join("") : `<tr><td colspan="4">لا توجد بيانات لعرضها</td></tr>`}</tbody></table>`;
  }

  gradeRowsReportTable(rows, emptyMessage) {
    return `<table class="pdf-tight-table ranking-report"><thead><tr><th>#</th><th>الطالب</th><th>المجموع</th><th>النسبة</th><th>الحالة</th></tr></thead><tbody>${rows.length ? rows.map((row, index) => `<tr><td>${index + 1}</td><td>${row.student.name}</td><td>${row.total}</td><td>${row.percent}%</td><td>${row.failed ? "راسب" : "بحاجة متابعة"}</td></tr>`).join("") : `<tr><td colspan="5">${emptyMessage}</td></tr>`}</tbody></table>`;
  }

  distributionReportTableHtml(rows) {
    const graded = rows.filter((row) => row.hasGrades);
    const groups = [
      ["ممتاز", graded.filter((row) => row.percent >= 90)],
      ["جيد جدًا", graded.filter((row) => row.percent >= 80 && row.percent < 90)],
      ["جيد", graded.filter((row) => row.percent >= 70 && row.percent < 80)],
      ["مقبول", graded.filter((row) => row.percent >= 50 && row.percent < 70)],
      ["راسب", graded.filter((row) => row.failed)]
    ];
    return groups.map(([label, items]) => `
      <section class="distribution-report-section">
        <h3>${label}</h3>
        <table class="pdf-tight-table distribution-report">
          <thead><tr><th>#</th><th>الطالب</th><th>المجموع</th><th>النسبة</th></tr></thead>
          <tbody>${items.length ? items.map((row, index) => `<tr><td>${index + 1}</td><td>${row.student.name}</td><td>${row.total}</td><td>${row.percent}%</td></tr>`).join("") : `<tr><td colspan="4">لا يوجد</td></tr>`}</tbody>
        </table>
      </section>
    `).join("");
  }

  columnAnalysisReportHtml(columns, rows) {
    if (!columns.length) return `<table><tbody><tr><td>لا توجد أعمدة درجات</td></tr></tbody></table>`;
    return columns.map((column) => {
      const max = safeNumber(column.max);
      const values = rows.map((row) => {
        const hasGrade = Object.hasOwn(row.grades, column.id);
        const value = safeNumber(row.grades[column.id]);
        return { row, hasGrade, value };
      });
      const needsSupport = values.filter((item) => item.hasGrade && item.value < max / 2);
      const reassuring = values.filter((item) => item.hasGrade && item.value >= max / 2);
      const missing = values.filter((item) => !item.hasGrade);
      return `
        <section class="column-analysis-section">
          <h3>${column.label}</h3>
          ${this.columnGroupReportTable("بحاجة دعم", needsSupport, column)}
          ${this.columnGroupReportTable("مستوى مطمئن", reassuring, column)}
          ${missing.length ? this.columnGroupReportTable("لم تدخل درجته", missing, column) : ""}
        </section>
      `;
    }).join("");
  }

  columnGroupReportTable(title, items, column) {
    return `
      <h4 class="pdf-subtitle">${title}</h4>
      <table class="pdf-tight-table column-analysis-report">
        <thead><tr><th>#</th><th>الطالب</th><th>الدرجة</th><th>الدرجة العظمى</th></tr></thead>
        <tbody>${items.length ? items.map((item, index) => `<tr><td>${index + 1}</td><td>${item.row.student.name}</td><td>${item.hasGrade ? item.value : "-"}</td><td>${column.max}</td></tr>`).join("") : `<tr><td colspan="4">لا يوجد</td></tr>`}</tbody>
      </table>
    `;
  }

  subjectAlerts(subjectId) {
    const ids = new Set(this.app.services.store.getStudents(subjectId).map((student) => student.name));
    return this.app.services.store.getSmartAlerts().filter((alert) => [...ids].some((name) => alert.message.includes(name)));
  }
}

function statusClass(status) {
  return status === "present" ? "status-present" : status === "absent" ? "status-absent" : status === "late" ? "status-late" : "status-empty";
}

function statusLabel(status) {
  return status === "present" ? "حاضر" : status === "absent" ? "غائب" : status === "late" ? "متأخر" : "غير محدد";
}

function statusShortLabel(status) {
  return status === "present" ? "ح" : status === "absent" ? "غ" : status === "late" ? "ت" : "-";
}

function normalizeWeekdayText(value) {
  return String(value || "")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[إأآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

function sameWeekday(left, right) {
  return normalizeWeekdayText(left) === normalizeWeekdayText(right);
}

function normalizeTimeKey(value) {
  return String(value || "")
    .replace(/^lesson-/, "")
    .replace(/\s+/g, "")
    .replace(/[–—]/g, "-")
    .trim();
}

function selectedLessonId(value) {
  const text = String(value || "");
  if (text.startsWith("lesson-")) return text.replace("lesson-", "");
  return null;
}

function isTimeSessionId(value) {
  return /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(normalizeTimeKey(value));
}

function sameLessonTime(lesson, value) {
  const selected = normalizeTimeKey(value);
  const lessonId = selectedLessonId(value);
  if (lessonId && lesson?.id === lessonId) return true;
  return normalizeTimeKey(lessonTimeKey(lesson)) === selected
    || normalizeTimeKey(`${lesson.end || ""}-${lesson.start || ""}`) === selected;
}

function statsTab(id, label, active) {
  return `<button class="status-button ${active === id ? "active" : ""}" data-stats-view="${id}">${label}</button>`;
}

function statsGroupTab(id, label, active) {
  const icons = { attendance: "check-check", performance: "award", analysis: "bar-chart-3" };
  const descriptions = {
    attendance: "الغياب والتأخير والحضور",
    performance: "النجاح والرسوب والتوزيع",
    analysis: "تحليل أعمدة الدرجات"
  };
  return `
    <button class="status-button stats-group-button ${active === id ? "active" : ""}" data-stats-group="${id}">
      <i data-lucide="${icons[id] || "bar-chart-3"}"></i>
      <span>
        <strong>${label}</strong>
        <small>${descriptions[id] || ""}</small>
      </span>
    </button>
  `;
}

function statsViewsForGroup(group) {
  const groups = {
    attendance: [
      ["absent", "الطلاب الأكثر غيابًا"],
      ["late", "التأخير"],
      ["best", "أفضل الطلاب حضورًا"]
    ],
    performance: [
      ["failed", "الرسوب"],
      ["distribution", "توزيع الدرجات"],
      ["risk", "الطلاب المعرضون للخطر"]
    ],
    analysis: [
      ["column", "تحليل عمود"]
    ]
  };
  return groups[group] || groups.attendance;
}

function fullWeekdayName(dateKey) {
  return new Intl.DateTimeFormat("ar-SA", { weekday: "long" }).format(new Date(`${dateKey}T12:00:00`));
}

function lessonTimeKey(lesson) {
  return normalizeTimeKey(`${lesson.start || ""}-${lesson.end || ""}`);
}

function lessonFromAttendanceKey(key, lessons) {
  const lessonId = String(key || "").split("__lesson-")[1];
  if (!lessonId) return null;
  return lessons.find((lesson) => lesson.id === lessonId) || null;
}

function parseSheetSessionId(key) {
  return String(key || "").split("__")[1] || "";
}

function currentWeekday() {
  return new Intl.DateTimeFormat("ar-SA", { weekday: "long" }).format(new Date());
}

function calendarMonthParts(date, calendarMode = "gregory") {
  if (calendarMode === "islamic") return islamicCalendarParts(date);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

function sheetMonthOptions(calendarMode = "gregory", selectedYear = new Date().getFullYear()) {
  if (calendarMode === "islamic") {
    return [
      "محرم",
      "صفر",
      "ربيع الأول",
      "ربيع الآخر",
      "جمادى الأولى",
      "جمادى الآخرة",
      "رجب",
      "شعبان",
      "رمضان",
      "شوال",
      "ذو القعدة",
      "ذو الحجة"
    ].map((label, index) => ({ value: index + 1, label }));
  }
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(selectedYear, index, 1);
    return {
      value: index + 1,
      label: new Intl.DateTimeFormat("ar-SA", { month: "long", calendar: "gregory" }).format(date)
    };
  });
}

function sheetYearOptions(calendarMode = "gregory", selectedYear = calendarMonthParts(new Date(), calendarMode).year) {
  return Array.from({ length: 7 }, (_, index) => selectedYear - 3 + index);
}

function formatSheetYear(year, calendarMode = "gregory") {
  return calendarMode === "islamic" ? `${year} هـ` : `${year}`;
}

function dateForCalendarMonth(year, month, calendarMode = "gregory") {
  if (calendarMode !== "islamic") return new Date(year, month - 1, 1, 12, 0, 0);
  const approxGregorianYear = Math.round(year * 0.970224 + 621.5774);
  const scanStart = new Date(approxGregorianYear - 1, 0, 1, 12, 0, 0);
  for (let offset = 0; offset < 760; offset += 1) {
    const date = new Date(scanStart);
    date.setDate(scanStart.getDate() + offset);
    const parts = islamicCalendarParts(date);
    if (parts.year === year && parts.month === month) return date;
  }
  return new Date();
}

function islamicCalendarParts(date) {
  const parts = new Intl.DateTimeFormat("en-US-u-ca-islamic-umalqura", {
    year: "numeric",
    month: "numeric",
    day: "numeric"
  }).formatToParts(date);
  const value = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function studentCountLabel(count) {
  if (count === 0) return "لا يوجد";
  if (count === 1) return "طالب واحد";
  return `${count} طلاب`;
}

function mergeTeacherOptions(items = []) {
  const map = new Map();
  items.forEach((item) => {
    const code = String(item.code || "").trim().toUpperCase();
    if (!code) return;
    const role = item.accessMode === "delegate" ? "مندوب" : "معلم";
    map.set(code, { code, name: `${item.ownerName || item.customerName || "حساب تابع"} · ${role}` });
  });
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "ar"));
}

function extractStudentsFromRows(rows) {
  const normalizedRows = rows
    .map((row) => Array.isArray(row) ? row : [])
    .filter((row) => row.some((cell) => String(cell ?? "").trim()));
  if (!normalizedRows.length) return { rows: [], hasPhoneColumn: false };

  const maxColumns = Math.max(...normalizedRows.map((row) => row.length));
  const headerIndex = normalizedRows.findIndex((row) => row.some((cell) => isNameHeader(cell)));
  const headerRow = headerIndex >= 0 ? normalizedRows[headerIndex] : [];
  const explicitIndex = headerRow.findIndex((cell) => isNameHeader(cell));
  const nameColumn = explicitIndex >= 0 ? explicitIndex : detectNameColumn(normalizedRows, maxColumns);
  const explicitPhoneIndex = headerRow.findIndex((cell) => isPhoneHeader(cell));
  const phoneColumn = explicitPhoneIndex >= 0 ? explicitPhoneIndex : detectPhoneColumn(normalizedRows, maxColumns, nameColumn);
  const startIndex = headerIndex >= 0 ? headerIndex + 1 : 0;
  const hasPhoneColumn = phoneColumn >= 0;

  const extractedRows = normalizedRows
    .slice(startIndex)
    .map((row) => ({
      name: cleanStudentName(row[nameColumn]),
      guardianPhone: hasPhoneColumn ? cleanPhone(row[phoneColumn]) : ""
    }))
    .filter((item) => item.name);
  return { rows: extractedRows, hasPhoneColumn };
}

function detectNameColumn(rows, maxColumns) {
  let bestIndex = 0;
  let bestScore = -1;
  for (let index = 0; index < maxColumns; index += 1) {
    const score = rows.reduce((sum, row) => sum + scoreNameCell(row[index]), 0);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function isNameHeader(value) {
  const text = normalizeArabicText(value);
  return ["الاسم", "اسم", "اسمالطالب", "الطالب", "الطالبة", "الطلاب", "studentname", "name", "student"].includes(text);
}

function isPhoneHeader(value) {
  const text = normalizeArabicText(value);
  return ["الهاتف", "الجوال", "رقم", "رقمالهاتف", "رقمالجوال", "رقموليالامر", "وليالامر", "هاتفوليالامر", "phone", "mobile", "parentphone", "guardianphone"].includes(text);
}

function scoreNameCell(value) {
  const text = cleanStudentName(value);
  if (!text) return 0;
  if (/^\d+$/.test(text)) return -4;
  if (/@|http|www|\d{5,}/i.test(text)) return -3;
  let score = 0;
  if (/[\u0600-\u06FF]/.test(text)) score += 4;
  if (/[A-Za-z]/.test(text)) score += 1;
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words >= 2) score += 3;
  if (words === 1) score += 1;
  if (text.length >= 5 && text.length <= 60) score += 2;
  return score;
}

function cleanStudentName(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/^[#\d\s.\-_/]+/, "")
    .trim();
}

function parsePastedStudentLine(line) {
  const raw = String(line || "").trim();
  if (!raw) return { name: "" };
  const phoneMatch = raw.match(/(?:\+?\d[\d\s\-()]{6,}\d)$/);
  const phoneText = phoneMatch ? phoneMatch[0] : "";
  const nameText = phoneMatch ? raw.slice(0, phoneMatch.index) : raw;
  return {
    name: cleanStudentName(nameText),
    guardianPhone: cleanPhone(phoneText)
  };
}

function detectPhoneColumn(rows, maxColumns, nameColumn) {
  let bestIndex = -1;
  let bestScore = 0;
  for (let index = 0; index < maxColumns; index += 1) {
    if (index === nameColumn) continue;
    const score = rows.reduce((sum, row) => sum + scorePhoneCell(row[index]), 0);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return bestScore >= 4 ? bestIndex : -1;
}

function scorePhoneCell(value) {
  const phone = cleanPhone(value);
  if (!phone) return 0;
  if (phone.length >= 7 && phone.length <= 15) return 3;
  return 1;
}

function cleanPhone(value) {
  return String(value ?? "").replace(/[^\d+]/g, "").trim();
}

function normalizeArabicText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[إأآا]/g, "ا")
    .replace(/[ة]/g, "ه")
    .replace(/[^\u0600-\u06FFA-Za-z]/g, "")
    .trim();
}
