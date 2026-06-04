import { formatDate, html, qs, renderIcons, setPageTitle } from "../utils/dom.js?v=35";

export class HomePage {
  constructor(app) {
    this.app = app;
    this.query = "";
    this.sort = "gradeHigh";
    this.searchTimer = null;
    window.addEventListener("global-search", (event) => {
      if (!["home", "subjects"].includes(this.app.state.currentRoute)) return;
      this.query = event.detail;
      this.render(this.app.state.currentRoute === "subjects" ? "subjects" : "home");
    });
  }

  render(mode = "home") {
    const isSubjectsPage = mode === "subjects";
    setPageTitle(isSubjectsPage ? "المواد" : "الرئيسية");
    const activeLicense = this.app.services.license.getActiveLicense();
    const activeInstitution = this.app.services.store.getActiveInstitution(activeLicense);
    const institutions = this.app.services.store.getInstitutions(activeLicense);
    const subjects = this.sortSubjects(this.app.services.store.getSubjects(undefined, activeLicense)
      .map((subject) => ({ ...subject, gradeLevel: this.subjectGradeLevel(subject.id) }))
      .filter((subject) => subject.name.includes(this.query) || subject.code.includes(this.query)));
    const totalStudents = subjects.reduce((sum, subject) => sum + subject.studentsCount, 0);
    const avgAttendance = subjects.length ? Math.round(subjects.reduce((sum, subject) => sum + subject.attendanceRate, 0) / subjects.length) : 0;
    const alerts = this.app.services.store.getSmartAlerts().length;
    const institutionSummary = this.app.services.store.getInstitutionSummary(undefined, activeLicense);
    const canManageSubjects = this.canManageSubjects();
    const canCreateSubject = canManageSubjects && institutions.length;
    const quickActions = activeLicense?.accessMode === "delegate"
      ? [{ target: "attendance", icon: "check-check", label: "بدء التحضير" }]
      : [
          { target: "attendance", icon: "check-check", label: "بدء التحضير" },
          { target: "grades", icon: "table-properties", label: "فتح الدرجات" },
          { target: "analytics", icon: "bar-chart-3", label: "عرض الإحصائيات" }
        ];

    qs("#view").innerHTML = html`
      ${isSubjectsPage ? "" : `<section class="hero-grid">
        <div class="panel">
          <div class="panel-header">
            <div>
              <span class="eyebrow">نظرة اليوم</span>
              <h2>إدارة سريعة للتحضير والدرجات</h2>
            </div>
            ${canCreateSubject ? `<button class="primary-button" id="add-subject"><i data-lucide="plus"></i>إضافة مادة</button>` : ""}
          </div>
          <div class="quick-stats">
            ${stat("book-open", "المواد", subjects.length)}
            ${stat("users", "الطلاب", totalStudents)}
            ${stat("check-circle-2", "نسبة الحضور", `${avgAttendance}%`)}
            ${stat("bell-ring", "تنبيهات", alerts)}
          </div>
        </div>
        <div class="panel">
          <div class="panel-header">
            <div>
              <span class="eyebrow">اختصارات</span>
              <h2>مهام متكررة</h2>
            </div>
          </div>
          <div class="stack">
            ${quickActions.map((action) => `<button class="ghost-button" data-jump="${action.target}"><i data-lucide="${action.icon}"></i>${action.label}</button>`).join("")}
          </div>
        </div>
        ${institutions.length ? `<div class="panel institution-switch-panel">
          <div class="panel-header">
            <div>
              <span class="eyebrow">الجهة الحالية</span>
              <h2>اختر الجهة التعليمية</h2>
            </div>
          </div>
          <select class="select-field institution-switch-select" id="active-institution">
            ${institutions.map((item) => `<option value="${item.id}" ${item.id === activeInstitution?.id ? "selected" : ""}>${item.name}</option>`).join("")}
          </select>
        </div>` : ""}
        <div class="panel institution-summary-panel">
          <div class="panel-header">
            <div>
              <span class="eyebrow">ملخص الجهة</span>
              <h2>${activeInstitution ? activeInstitution.name : "لا توجد جهة محددة"}</h2>
            </div>
          </div>
          <div class="quick-stats compact">
            ${stat("book-open", "المواد", institutionSummary.subjectsCount)}
            ${stat("users", "الطلاب", institutionSummary.studentsCount)}
            ${stat("calendar-days", "الحصص", institutionSummary.lessonsCount)}
            ${stat("check-circle-2", "الحضور", `${institutionSummary.attendanceRate}%`)}
          </div>
          <div class="smart-note"><i data-lucide="clock"></i><span>${institutionSummary.nextLesson ? `${institutionSummary.nextLesson.day} · ${institutionSummary.nextLesson.start} - ${institutionSummary.nextLesson.end}` : "لا توجد حصص قادمة في هذه الجهة"}</span></div>
        </div>
      </section>`}

      <div class="toolbar">
        <div>
          <span class="eyebrow">${activeInstitution ? activeInstitution.name : "المواد"}</span>
          <h2>${isSubjectsPage ? "المواد الدراسية" : "كل المواد الدراسية"}</h2>
        </div>
        <div class="toolbar-group">
          ${isSubjectsPage && institutions.length ? `<select class="select-field" id="active-institution">
            ${institutions.map((item) => `<option value="${item.id}" ${item.id === activeInstitution?.id ? "selected" : ""}>${item.name}</option>`).join("")}
          </select>` : ""}
          ${isSubjectsPage && canCreateSubject ? `<button class="primary-button" id="add-subject-toolbar"><i data-lucide="plus"></i>إضافة مادة</button>` : ""}
          <input class="field" id="subject-search" placeholder="بحث في المواد..." value="${this.query}" />
          <select class="select-field" id="subject-sort">
            <option value="gradeHigh" ${this.sort === "gradeHigh" ? "selected" : ""}>الأعلى مستوى</option>
            <option value="gradeLow" ${this.sort === "gradeLow" ? "selected" : ""}>الأقل مستوى</option>
            <option value="students" ${this.sort === "students" ? "selected" : ""}>الأكثر طلابًا</option>
          </select>
        </div>
      </div>
      ${canManageSubjects && !institutions.length ? `<div class="smart-note compact-note subject-prerequisite-note"><i data-lucide="building-2"></i><span>أضف جهة تعليمية من قسم الحصص أولًا، ثم أضف المواد داخل هذه الجهة.</span><a class="status-button" href="#/schedule">فتح الحصص</a></div>` : ""}

      <section class="subjects-grid" id="subjects-grid">
        ${subjects.length ? subjects.map((subject) => subjectCard(subject)).join("") : emptySubjects(institutions.length)}
      </section>
    `;

    qs("#add-subject")?.addEventListener("click", () => this.openSubjectModal());
    qs("#add-subject-toolbar")?.addEventListener("click", () => this.openSubjectModal());
    qs("#active-institution")?.addEventListener("change", async (event) => {
      await this.app.services.store.setActiveInstitution(event.target.value);
      this.render(mode);
    });
    qs("#subject-search")?.addEventListener("input", (event) => {
      this.query = event.target.value;
      this.updateSubjectsGrid();
    });
    qs("#subject-sort")?.addEventListener("change", (event) => {
      this.sort = event.target.value;
      this.render(mode);
    });
    this.bindSubjectCards();
    document.querySelectorAll("[data-jump]").forEach((button) => {
      button.addEventListener("click", () => {
        this.openShortcutSubjectPicker(button.dataset.jump);
      });
    });
    renderIcons();
  }

  openShortcutSubjectPicker(target) {
    const activeLicense = this.app.services.license.getActiveLicense();
    const subjects = this.sortSubjects(this.app.services.store.getSubjects(undefined, activeLicense).map((subject) => ({ ...subject, gradeLevel: this.subjectGradeLevel(subject.id) })));
    const title = target === "attendance" ? "بدء التحضير" : target === "grades" ? "فتح الدرجات" : "عرض الإحصائيات";
    this.app.services.modal.open({
      title,
      body: subjects.length ? `
        <div class="subject-choice-grid modal-choice-grid">
          ${subjects.map((subject) => `
            <button class="subject-choice-card" data-home-shortcut-subject="${subject.id}" data-home-shortcut-target="${target}">
              <i data-lucide="${target === "attendance" ? "check-check" : target === "grades" ? "table-properties" : "bar-chart-3"}"></i>
              <strong>${subject.name}</strong>
              <span>${subject.code || "بدون رمز"} · ${subject.studentsCount} طالب</span>
            </button>
          `).join("")}
        </div>
      ` : `<div class="empty-state compact"><i data-lucide="book-plus"></i><h3>لا توجد مواد مضافة</h3><p>أضف مادة أولًا ثم افتح الاختصار.</p></div>`,
      actions: [
        { label: "إغلاق", action: "close" }
      ]
    });
    document.querySelectorAll("[data-home-shortcut-subject]").forEach((button) => {
      button.addEventListener("click", () => {
        this.app.services.modal.close();
        const tab = button.dataset.homeShortcutTarget === "analytics" ? "stats" : button.dataset.homeShortcutTarget;
        location.hash = `#/subject/${button.dataset.homeShortcutSubject}/${tab}`;
      });
    });
    renderIcons();
  }

  updateSubjectsGrid() {
    const activeLicense = this.app.services.license.getActiveLicense();
    const subjects = this.sortSubjects(this.app.services.store.getSubjects(undefined, activeLicense)
      .map((subject) => ({ ...subject, gradeLevel: this.subjectGradeLevel(subject.id) }))
      .filter((subject) => subject.name.includes(this.query) || subject.code.includes(this.query)));
    const institutions = this.app.services.store.getInstitutions(this.app.services.license.getActiveLicense());
    qs("#subjects-grid").innerHTML = subjects.length ? subjects.map((subject) => subjectCard(subject)).join("") : emptySubjects(institutions.length);
    this.bindSubjectCards();
    renderIcons();
  }

  bindSubjectCards() {
    document.querySelectorAll("[data-subject]").forEach((card) => {
      card.addEventListener("click", () => location.hash = `#/subject/${card.dataset.subject}/students`);
    });
  }

  scheduleRender(mode) {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.render(mode), 180);
  }

  sortSubjects(subjects) {
    return [...subjects].sort((a, b) => {
      if (this.sort === "gradeLow") return (a.gradeLevel ?? 101) - (b.gradeLevel ?? 101);
      if (this.sort === "students") return b.studentsCount - a.studentsCount;
      return (b.gradeLevel ?? -1) - (a.gradeLevel ?? -1);
    });
  }

  subjectGradeLevel(subjectId) {
    const students = this.app.services.store.getStudents(subjectId);
    const columns = this.app.services.store.getGradeColumns(subjectId);
    const maxTotal = columns.reduce((sum, column) => sum + Number(column.max || 0), 0);
    if (!students.length || !maxTotal) return null;
    const totals = students.map((student) => {
      const grades = this.app.services.store.getGrades(subjectId, student.id);
      const hasGrades = columns.some((column) => Object.hasOwn(grades, column.id));
      if (!hasGrades) return null;
      const total = columns.reduce((sum, column) => sum + Number(grades[column.id] || 0), 0);
      return Math.round((total / maxTotal) * 100);
    }).filter((value) => value !== null);
    if (!totals.length) return null;
    return Math.round(totals.reduce((sum, value) => sum + value, 0) / totals.length);
  }

  async openSubjectModal() {
    if (!this.canManageSubjects()) {
      this.app.services.toast.show("إضافة المواد والفصول من صلاحيات المشرف", "error");
      return;
    }
    const activeLicense = this.app.services.license.getActiveLicense();
    const activeInstitution = this.app.services.store.getActiveInstitution(activeLicense);
    if (!activeInstitution) {
      this.app.services.toast.show("أضف جهة تعليمية من قسم الحصص أولًا", "warning");
      location.hash = "#/schedule";
      return;
    }
    const teacherOptions = await this.assignmentOptions();
    this.app.services.modal.open({
      title: "إضافة مادة",
      body: `
        <form class="form-grid" id="subject-form">
          <p class="muted">ستتم إضافة المادة داخل: <strong>${activeInstitution.name}</strong></p>
          <label>اسم المادة<input name="name" required placeholder="مثال: برمجة" /></label>
          <label>الفصل أو الشعبة<input name="className" placeholder="مثال: ثالث ثانوي / شعبة أ" /></label>
          <label>رمز المادة<input name="code" required placeholder="مثال: CS101" /></label>
          <label>القاعة<input name="room" placeholder="مثال: قاعة 204" /></label>
          ${teacherOptions}
        </form>
      `,
      actions: [
        { label: "إلغاء", action: "close" },
        { label: "حفظ", variant: "primary", action: async (root) => {
          const form = root.querySelector("#subject-form");
          if (!form.reportValidity()) return false;
          const data = Object.fromEntries(new FormData(form));
          data.institutionId = activeInstitution.id;
          Object.assign(data, this.assignmentPatch(data.assignedTeacherCode));
          await this.app.services.store.addSubject(data);
          this.app.services.sync.scheduleManagedAccountSync(0);
          this.app.services.toast.show("تمت إضافة المادة بنجاح", "success");
          this.render(this.app.state.currentRoute === "subjects" ? "subjects" : "home");
        }}
      ]
    });
  }

  canManageSubjects() {
    const license = this.app.services.license.getActiveLicense();
    const managedChild = Boolean(["teacher", "delegate"].includes(license?.accessMode) && license.parentCode);
    if (!managedChild) return true;
    return Boolean(license?.permissions?.subjectManage);
  }

  async assignmentOptions(selectedCode = "") {
    if (!this.isSupervisor()) return "";
    const active = this.app.services.license.getActiveLicense();
    const local = this.app.services.license.listManagedCodes(active?.code).filter((item) => ["teacher", "delegate"].includes(item.accessMode));
    const remote = await this.app.services.license.listManagedCodesWithUsage(active?.code).catch(() => []);
    const teachers = mergeTeacherOptions([...local, ...remote].filter((item) => ["teacher", "delegate"].includes(item.accessMode)));
    const selected = selectedCode || (teachers.length === 1 ? teachers[0].code : "");
    return `
      <label>الحساب المرتبط
        <select class="select-field" name="assignedTeacherCode" ${teachers.length ? "required" : ""}>
          <option value="">بدون ربط الآن</option>
          ${teachers.map((teacher) => `<option value="${teacher.code}" ${teacher.code === selected ? "selected" : ""}>${teacher.name}</option>`).join("")}
        </select>
      </label>
      <p class="muted">إذا ربطت المادة بحساب تابع فلن تظهر إلا لديه، ومعها طلاب هذا الفصل وجدول حصصه.</p>
    `;
  }

  assignmentPatch(code = "") {
    const selectedCode = String(code || "").trim().toUpperCase();
    if (!selectedCode) return { assignedTeacherCode: "", assignedTeacherName: "" };
    const active = this.app.services.license.getActiveLicense();
    const teacher = this.app.services.license.listManagedCodes(active?.code).find((item) => item.code === selectedCode);
    return {
      assignedTeacherCode: selectedCode,
      assignedTeacherName: teacher?.ownerName || teacher?.customerName || "حساب تابع"
    };
  }

  isSupervisor() {
    return this.app.services.license.getActiveLicense()?.accessMode === "admin";
  }
}

function stat(icon, label, value) {
  return `<article class="stat-card"><i data-lucide="${icon}"></i><span>${label}</span><strong data-counter>${value}</strong></article>`;
}

function subjectCard(subject) {
  return `
    <article class="subject-card" data-subject="${subject.id}" tabindex="0">
      <div class="card-header">
        <div class="subject-icon"><i data-lucide="book-open"></i></div>
        <span class="status-badge status-present">${subject.gradeLevel ?? "-"}% مستوى</span>
      </div>
      <div>
        <h3>${subject.name}</h3>
        <p class="muted">${subject.code} · ${subject.className || subject.room || "بدون قاعة"}</p>
      </div>
      <div class="subject-meta">
        <span>${subject.studentsCount} طالب</span>
        ${subject.assignedTeacherName ? `<span>المسؤول: ${subject.assignedTeacherName}</span>` : ""}
        <span>متوسط الدرجات: ${subject.gradeLevel === null || subject.gradeLevel === undefined ? "لم تُدخل" : `${subject.gradeLevel}%`}</span>
      </div>
      <div class="progress"><span style="width:${subject.gradeLevel ?? 0}%"></span></div>
    </article>
  `;
}

function emptySubjects(institutionsCount = 0) {
  return `<div class="empty-state"><i data-lucide="book-plus"></i><h3>لا توجد مواد مطابقة</h3><p>${institutionsCount ? "أضف مادة جديدة أو غيّر عبارة البحث." : "أضف جهة تعليمية من قسم الحصص أولًا، ثم أضف المواد داخلها."}</p></div>`;
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
