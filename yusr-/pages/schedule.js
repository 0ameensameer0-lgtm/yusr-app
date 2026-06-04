import { qs, renderIcons, setPageTitle } from "../utils/dom.js?v=35";

const days = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

export class SchedulePage {
  constructor(app) {
    this.app = app;
    this.institutionId = null;
  }

  render() {
    setPageTitle("جدول الحصص");
    const activeLicense = this.app.services.license.getActiveLicense();
    const institutions = this.app.services.store.getInstitutions(activeLicense);
    if (!this.institutionId || !institutions.some((item) => item.id === this.institutionId)) this.institutionId = institutions[0]?.id || null;
    const activeInstitution = institutions.find((item) => item.id === this.institutionId);
    const schedule = this.institutionId ? this.app.services.store.getSchedule(this.institutionId, activeLicense) : [];
    const canManageSchedule = this.canManageSchedule();
    qs("#view").innerHTML = `
      <section class="panel schedule-hero">
        <div class="panel-header">
          <div>
            <span class="eyebrow">تنظيم الأسبوع</span>
            <h2>${activeInstitution ? activeInstitution.name : "جدول حصص الأستاذ"}</h2>
            <p class="muted">${activeInstitution ? `${institutionTypeLabel(activeInstitution.type)} · ${activeInstitution.location || "بدون موقع"}` : "أضف مدرسة أو جامعة لترتيب جدول حصصك."}</p>
          </div>
          <div class="toolbar-group">
            ${canManageSchedule ? `<button class="ghost-button" id="add-institution"><i data-lucide="building-2"></i>إضافة جهة</button>` : ""}
            ${activeInstitution && canManageSchedule ? `<button class="primary-button" id="add-schedule-item"><i data-lucide="calendar-plus"></i>إضافة حصة</button>` : ""}
          </div>
        </div>
        <div class="institution-tabs">
          ${institutions.map((item) => `
            <button class="${item.id === this.institutionId ? "active" : ""}" data-institution="${item.id}">
              <strong>${item.name}</strong>
              <span>${institutionTypeLabel(item.type)}</span>
            </button>
          `).join("")}
        </div>
        ${activeInstitution && canManageSchedule ? `
          <div class="institution-actions">
            <button class="status-button" id="edit-institution"><i data-lucide="pencil"></i>تعديل الجهة</button>
            <button class="status-button danger-text" id="delete-institution"><i data-lucide="trash-2"></i>حذف الجهة</button>
          </div>
        ` : ""}
        <div class="schedule-summary">
          <article><span>عدد الحصص</span><strong>${schedule.length}</strong></article>
          <article><span>أيام التدريس</span><strong>${new Set(schedule.map((item) => item.day)).size}</strong></article>
          <article><span>الجهات</span><strong>${institutions.length}</strong></article>
        </div>
      </section>

      ${activeInstitution ? `<section class="schedule-grid">
        ${days.map((day) => this.dayColumn(day, schedule.filter((item) => item.day === day))).join("")}
      </section>` : `<div class="empty-state"><i data-lucide="building-2"></i><h3>لا توجد جهة تعليمية</h3><p>${canManageSchedule ? "أضف جهة تعليمية ثم رتّب جدول الحصص الخاص بها." : "لم يربط المشرف جهة أو جدول حصص بهذا الحساب بعد."}</p></div>`}
    `;
    qs("#add-institution")?.addEventListener("click", () => this.openInstitutionModal());
    qs("#add-schedule-item")?.addEventListener("click", () => this.openScheduleModal());
    qs("#edit-institution")?.addEventListener("click", () => this.openInstitutionModal(activeInstitution));
    qs("#delete-institution")?.addEventListener("click", () => this.deleteInstitution(activeInstitution.id));
    document.querySelectorAll("[data-institution]").forEach((button) => {
      button.addEventListener("click", async () => {
        this.institutionId = button.dataset.institution;
        await this.app.services.store.setActiveInstitution(this.institutionId);
        this.render();
      });
    });
    document.querySelectorAll("[data-edit-schedule]").forEach((button) => {
      button.addEventListener("click", () => this.openScheduleModal(schedule.find((item) => item.id === button.dataset.editSchedule)));
    });
    document.querySelectorAll("[data-delete-schedule]").forEach((button) => {
      button.addEventListener("click", () => this.deleteScheduleItem(button.dataset.deleteSchedule));
    });
    renderIcons();
  }

  dayColumn(day, items) {
    return `
      <article class="schedule-day">
        <header>
          <h3>${day}</h3>
          <span>${items.length} حصص</span>
        </header>
        <div class="schedule-lessons">
          ${items.length ? items.map((item) => this.lessonCard(item)).join("") : `<div class="empty-state compact"><i data-lucide="calendar-days"></i><h3>لا توجد حصص</h3></div>`}
        </div>
      </article>
    `;
  }

  lessonCard(item) {
    const subject = this.app.services.store.getSubject(item.subjectId, this.app.services.license.getActiveLicense());
    const canManageSchedule = this.canManageSchedule();
    return `
      <article class="lesson-card">
        <div class="lesson-time"><strong>${item.start}</strong><span>${item.end}</span></div>
        <div class="lesson-info">
          <strong>${subject?.name || "مادة غير محددة"}</strong>
          <span>${item.room || subject?.room || "بدون قاعة"} ${item.notes ? `· ${item.notes}` : ""}</span>
        </div>
        ${canManageSchedule ? `<div class="lesson-actions">
          <button class="icon-button" data-edit-schedule="${item.id}" title="تعديل"><i data-lucide="pencil"></i></button>
          <button class="icon-button danger-text" data-delete-schedule="${item.id}" title="حذف"><i data-lucide="trash-2"></i></button>
        </div>` : ""}
      </article>
    `;
  }

  canManageSchedule() {
    const license = this.app.services.license.getActiveLicense();
    if (!license) return true;
    if (!this.isManagedBySupervisor()) return true;
    if (!["teacher", "delegate"].includes(license.accessMode)) return true;
    return Boolean(license?.permissions?.scheduleManage);
  }

  isManagedBySupervisor() {
    const license = this.app.services.license.getActiveLicense();
    return Boolean(license?.parentCode);
  }

  openScheduleModal(item = null) {
    if (!this.canManageSchedule()) {
      this.app.services.toast.show("إدارة جدول الحصص الأساسي من صلاحيات المشرف", "error");
      return;
    }
    const subjects = this.app.services.store.getSubjects(this.institutionId, this.app.services.license.getActiveLicense());
    this.app.services.modal.open({
      title: item ? "تعديل حصة" : "إضافة حصة",
      body: `
        <form class="form-grid" id="schedule-form">
          <label>اليوم
            <select name="day" class="select-field">
              ${days.map((day) => `<option value="${day}" ${item?.day === day ? "selected" : ""}>${day}</option>`).join("")}
            </select>
          </label>
          <label>المادة
            <select name="subjectId" class="select-field">
              ${subjects.length ? subjects.map((subject) => `<option value="${subject.id}" ${item?.subjectId === subject.id ? "selected" : ""}>${subject.name}</option>`).join("") : `<option value="">لا توجد مواد في هذه الجهة</option>`}
            </select>
          </label>
          <div class="form-row">
            <label>البداية<input name="start" type="time" required value="${item?.start || "08:00"}" /></label>
            <label>النهاية<input name="end" type="time" required value="${item?.end || "08:50"}" /></label>
          </div>
          <label>القاعة<input name="room" placeholder="مثال: قاعة 204" value="${item?.room || ""}" /></label>
          <label>ملاحظة<input name="notes" placeholder="محاضرة، عملي، مراجعة..." value="${item?.notes || ""}" /></label>
        </form>
      `,
      actions: [
        { label: "إلغاء", action: "close" },
        { label: "حفظ", variant: "primary", action: async (root) => {
          const form = root.querySelector("#schedule-form");
          if (!form.reportValidity()) return false;
          const data = Object.fromEntries(new FormData(form));
          if (!data.subjectId) {
            this.app.services.toast.show("أضف مادة لهذه الجهة أولًا", "error");
            return false;
          }
          data.institutionId = this.institutionId;
          if (timeToMinutes(data.end) <= timeToMinutes(data.start)) {
            this.app.services.toast.show("وقت النهاية يجب أن يكون بعد وقت البداية", "error");
            return false;
          }
          const conflict = this.findScheduleConflict(data, item?.id);
          if (conflict) {
            const subject = this.app.services.store.getSubject(conflict.subjectId);
            this.app.services.toast.show(`لديك حصة في هذا الوقت: ${subject?.name || "مادة"} من ${conflict.start} إلى ${conflict.end}`, "error");
            return false;
          }
          if (item) await this.app.services.store.updateScheduleItem(item.id, data);
          else await this.app.services.store.addScheduleItem(data);
          this.app.services.toast.show("تم حفظ الحصة", "success");
          this.render();
        }}
      ]
    });
  }

  findScheduleConflict(data, currentId = null) {
    return this.app.services.store.getSchedule().find((item) => {
      if (item.id === currentId || item.day !== data.day) return false;
      return timesOverlap(data.start, data.end, item.start, item.end);
    });
  }

  openInstitutionModal(item = null) {
    if (!this.canManageSchedule()) {
      this.app.services.toast.show("إدارة الجهات وجدول الحصص من صلاحيات المشرف", "error");
      return;
    }
    this.app.services.modal.open({
      title: item ? "تعديل جهة تعليمية" : "إضافة مدرسة أو جامعة",
      body: `
        <form class="form-grid" id="institution-form">
          <label>الاسم<input name="name" required placeholder="مثال: جامعة صنعاء" value="${item?.name || ""}" /></label>
          <label>النوع
            <select name="type" class="select-field">
              <option value="school" ${item?.type === "school" ? "selected" : ""}>مدرسة</option>
              <option value="university" ${item?.type === "university" ? "selected" : ""}>جامعة</option>
              <option value="institute" ${item?.type === "institute" ? "selected" : ""}>معهد</option>
            </select>
          </label>
          <label>الموقع أو الفرع<input name="location" placeholder="اختياري" value="${item?.location || ""}" /></label>
        </form>
      `,
      actions: [
        { label: "إلغاء", action: "close" },
        { label: "حفظ", variant: "primary", action: async (root) => {
          const form = root.querySelector("#institution-form");
          if (!form.reportValidity()) return false;
          const data = Object.fromEntries(new FormData(form));
          if (item) await this.app.services.store.updateInstitution(item.id, data);
          else await this.app.services.store.addInstitution(data);
          this.app.services.toast.show("تم حفظ الجهة", "success");
          this.render();
        }}
      ]
    });
  }

  async deleteInstitution(id) {
    const ok = await this.app.services.modal.confirm({
      title: "حذف الجهة",
      message: "سيتم حذف الجهة وكل موادها وطلابها وكشوفها ودرجاتها وحصصها. هل تريد المتابعة؟",
      confirmLabel: "حذف الجهة"
    });
    if (!ok) return;
    await this.app.services.store.deleteInstitution(id);
    this.institutionId = null;
    this.app.services.toast.show("تم حذف الجهة", "success");
    this.render();
  }

  async deleteScheduleItem(id) {
    const ok = await this.app.services.modal.confirm({
      title: "حذف الحصة",
      message: "هل تريد حذف هذه الحصة من جدول الأستاذ؟",
      confirmLabel: "حذف الحصة"
    });
    if (!ok) return;
    await this.app.services.store.deleteScheduleItem(id);
    this.app.services.toast.show("تم حذف الحصة", "success");
    this.render();
  }
}

function institutionTypeLabel(type) {
  if (type === "university") return "جامعة";
  if (type === "institute") return "معهد";
  return "مدرسة";
}

function timeToMinutes(value) {
  const [hours, minutes] = String(value || "00:00").split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

function timesOverlap(startA, endA, startB, endB) {
  const aStart = timeToMinutes(startA);
  const aEnd = timeToMinutes(endA);
  const bStart = timeToMinutes(startB);
  const bEnd = timeToMinutes(endB);
  return aStart < bEnd && bStart < aEnd;
}
