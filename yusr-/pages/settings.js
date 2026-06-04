import { qs, renderIcons, setPageTitle } from "../utils/dom.js?v=35";
import { hashText } from "../utils/security.js?v=194";

export class SettingsPage {
  constructor(app) {
    this.app = app;
  }

  render() {
    setPageTitle("الإعدادات");
    const settings = this.app.services.store.getSettings();
    const activeLicense = this.app.services.license.getActiveLicense?.();
    const isManagedChild = Boolean(activeLicense?.parentCode);
    qs("#view").innerHTML = `
      <div class="toolbar">
        <div><span class="eyebrow">تخصيص يُسر</span><h2>إعدادات التطبيق</h2></div>
        <div class="toolbar-group">
          <button class="primary-button settings-save"><i data-lucide="save"></i>حفظ</button>
        </div>
      </div>
      <form class="settings-grid" id="settings-form">
        <section class="settings-section">
          <h3>حساب المعلم</h3>
          <label>اسم المعلم<input class="field" name="teacherName" value="${settings.teacherName || ""}" required /></label>
        </section>

        ${isManagedChild ? "" : `<section class="settings-section">
          <h3>الاشتراك والتفعيل</h3>
          <p class="muted">استخدم هذا الخيار إذا اقترب انتهاء الاشتراك أو أردت تغيير نوع الاشتراك قبل إغلاق التطبيق.</p>
          <button class="ghost-button" type="button" id="renew-activation-code"><i data-lucide="refresh-cw"></i>إعادة تفعيل الكود</button>
        </section>`}

        <section class="settings-section app-password-section">
          <h3>كلمة سر الدخول</h3>
          <p class="muted">${settings.appPasswordEnabled ? "قفل التطبيق مفعل. عند الخروج أو فتح التطبيق في جلسة جديدة سيطلب كلمة السر." : "يمكنك إضافة كلمة سر محلية للدخول إلى التطبيق للمشرف أو المعلم أو المندوب."}</p>
          <label>${settings.appPasswordEnabled ? "كلمة السر الجديدة" : "كلمة السر"}
            <input class="field" id="app-password" type="password" autocomplete="new-password" placeholder="اكتب كلمة السر" />
          </label>
          <label>تأكيد كلمة السر
            <input class="field" id="app-password-confirm" type="password" autocomplete="new-password" placeholder="أعد كتابة كلمة السر" />
          </label>
          <label>سؤال الأمان عند نسيان كلمة السر
            <select class="select-field" id="app-security-question">
              ${securityQuestionOptions(settings.appPasswordSecurityQuestion)}
            </select>
          </label>
          <label>إجابة سؤال الأمان
            <input class="field" id="app-security-answer" type="text" autocomplete="off" placeholder="${settings.appPasswordSecurityAnswerHash ? "اتركه فارغًا للإبقاء على الإجابة الحالية" : "اكتب إجابة لا تنساها"}" />
          </label>
          <div class="password-actions">
            <button class="primary-button" type="button" id="save-app-password"><i data-lucide="shield-check"></i>${settings.appPasswordEnabled ? "تغيير كلمة السر" : "إضافة كلمة السر"}</button>
            ${settings.appPasswordEnabled ? `
              <button class="ghost-button" type="button" id="toggle-auto-lock"><i data-lucide="${settings.appPasswordAutoLock ? "shield-off" : "shield"}"></i>${settings.appPasswordAutoLock ? "إلغاء القفل التلقائي" : "تفعيل القفل التلقائي"}</button>
              <button class="ghost-button" type="button" id="lock-app-now"><i data-lucide="log-out"></i>تسجيل الخروج الآن</button>
              <button class="danger-button" type="button" id="remove-app-password"><i data-lucide="shield-x"></i>إلغاء كلمة السر</button>
            ` : ""}
          </div>
          ${settings.appPasswordEnabled ? `<p class="muted">${settings.appPasswordAutoLock ? "القفل التلقائي مفعل: سيطلب التطبيق كلمة السر عند الرجوع بعد الخروج منه." : "القفل التلقائي غير مفعل: سيطلب كلمة السر فقط عند تسجيل الخروج أو فتح جلسة جديدة."}</p>` : ""}
        </section>

        <section class="settings-section">
          <h3>التحضير</h3>
          <label>طريقة التحضير
            <select class="select-field" name="attendanceMode">
              <option value="swipe" ${settings.attendanceMode === "swipe" ? "selected" : ""}>السحب</option>
              <option value="buttons" ${settings.attendanceMode === "buttons" ? "selected" : ""}>الأزرار</option>
            </select>
          </label>
          <label>حد الغياب<input class="field" type="number" min="1" max="30" name="absenceLimit" value="${settings.absenceLimit}" /></label>
          ${switchRow("autoPresent", "تحديد الباقي كحاضر تلقائيًا", settings.autoPresent)}
          ${switchRow("quickSearch", "البحث السريع", settings.quickSearch)}
        </section>

        <section class="settings-section">
          <h3>التنبيهات والترتيب</h3>
          ${switchRow("notifications", "الإشعارات", settings.notifications)}
          <label>ترتيب الطلاب
            <select class="select-field" name="studentSort">
              <option value="alpha" ${settings.studentSort === "alpha" ? "selected" : ""}>أبجدي</option>
              <option value="absence" ${settings.studentSort === "absence" ? "selected" : ""}>الأكثر غيابًا</option>
              <option value="best" ${settings.studentSort === "best" ? "selected" : ""}>الأفضل حضورًا</option>
            </select>
          </label>
        </section>

        <section class="settings-section">
          <h3>المظهر والتاريخ</h3>
          <label>الثيم
            <select class="select-field" name="theme">
              <option value="light" ${settings.theme === "light" ? "selected" : ""}>فاتح</option>
              <option value="dark" ${settings.theme === "dark" ? "selected" : ""}>داكن</option>
              <option value="system" ${settings.theme === "system" ? "selected" : ""}>النظام</option>
            </select>
          </label>
          <label>اللغة
            <select class="select-field" name="language">
              <option value="ar" ${settings.language === "ar" ? "selected" : ""}>العربية</option>
              <option value="en" ${settings.language === "en" ? "selected" : ""}>English</option>
            </select>
          </label>
          <label>نوع التاريخ
            <select class="select-field" name="dateCalendar">
              <option value="gregory" ${settings.dateCalendar !== "islamic" ? "selected" : ""}>ميلادي</option>
              <option value="islamic" ${settings.dateCalendar === "islamic" ? "selected" : ""}>هجري</option>
            </select>
          </label>
        </section>

        <section class="settings-section">
          <h3>النسخ الاحتياطي</h3>
          <p class="muted">احفظ نسخة من بياناتك على جهازك واسترجعها لاحقًا عند نقل التطبيق أو تغيير الجهاز.</p>
          <div class="toolbar-group backup-actions">
            <button class="ghost-button" type="button" id="export-backup"><i data-lucide="upload"></i>تصدير نسخة احتياطية</button>
            <button class="ghost-button" type="button" id="import-backup"><i data-lucide="download"></i>استيراد نسخة احتياطية</button>
            <input id="backup-file" type="file" accept=".json,application/json" hidden />
          </div>
        </section>

        <section class="settings-section">
          <h3>إشعارات الجهاز</h3>
          <p class="muted">يمكن تفعيل إشعارات الجهاز للتذكير بالتحضير والحصص وتنبيهات الغياب والتأخير. يظهر تذكير الحصة باسم الجهة والمادة والوقت.</p>
          ${switchRow("lessonReminders", "تذكير الحصص", settings.lessonReminders)}
          <label>التذكير قبل الحصة
            <select class="select-field" name="reminderMinutes">
              <option value="5" ${Number(settings.reminderMinutes) === 5 ? "selected" : ""}>قبل 5 دقائق</option>
              <option value="10" ${Number(settings.reminderMinutes) === 10 ? "selected" : ""}>قبل 10 دقائق</option>
              <option value="15" ${Number(settings.reminderMinutes || 15) === 15 ? "selected" : ""}>قبل 15 دقيقة</option>
              <option value="30" ${Number(settings.reminderMinutes) === 30 ? "selected" : ""}>قبل 30 دقيقة</option>
            </select>
          </label>
          <button class="ghost-button" type="button" id="request-notifications"><i data-lucide="bell"></i>تفعيل إشعارات الجهاز</button>
        </section>

        <section class="settings-section">
          <h3>المساعد الذكي</h3>
          <p class="muted">روبوت تفاعلي يظهر داخل صفحات التطبيق ليساعدك في الوصول للطلاب والدرجات والتحضير والحصص حسب صلاحية الحساب.</p>
          ${switchRow("assistantVisible", "إظهار الروبوت", settings.assistantVisible !== false)}
          ${switchRow("assistantSuggestions", "تشغيل الاقتراحات", settings.assistantSuggestions !== false)}
          ${switchRow("assistantSaveChats", "حفظ المحادثات", settings.assistantSaveChats !== false)}
        </section>
      </form>
    `;

    this.injectSettingsEnhancements(settings);
    this.decorateSettingsSections();
    this.bindSettingsSearch();
    this.bindAcademicYears();
    qs(".settings-save").addEventListener("click", () => this.save());
    qs("#export-backup").addEventListener("click", () => this.exportBackup());
    qs("#import-backup").addEventListener("click", () => qs("#backup-file").click());
    qs("#backup-file").addEventListener("change", (event) => this.importBackup(event.target.files[0]));
    qs("#settings-form").addEventListener("submit", (event) => event.preventDefault());
    document.querySelectorAll(".switch").forEach((button) => button.addEventListener("click", () => button.classList.toggle("active")));
    qs('select[name="theme"]').addEventListener("change", async (event) => {
      applyTheme(event.target.value);
      await this.app.services.store.updateSettings({ theme: event.target.value });
      this.app.services.toast.show("تم تغيير المظهر", "success");
    });
    qs("#request-notifications").addEventListener("click", async () => {
      await this.app.services.notifications.requestPermissionAndStart();
    });
    qs("#save-app-password")?.addEventListener("click", () => this.saveAppPassword());
    qs("#toggle-auto-lock")?.addEventListener("click", () => this.toggleAutoLock());
    qs("#remove-app-password")?.addEventListener("click", () => this.removeAppPassword());
    qs("#lock-app-now")?.addEventListener("click", () => window.lockYusrApp?.());
    qs("#renew-activation-code")?.addEventListener("click", () => this.openRenewalModal());
    renderIcons();
  }

  openRenewalModal() {
    const active = this.app.services.license.getActiveLicense();
    if (active?.parentCode) {
      this.app.services.toast.show("هذا الحساب تابع لمشرف، ولا يحتاج إلى إعادة تفعيل مستقلة.", "info");
      return;
    }
    const settings = this.app.services.store.getSettings();
    const role = active?.accessMode || settings.accessMode || "teacher";
    const currency = this.app.services.license.getActivationPricing()?.currency || "SAR";
    const initialPlan = ["week", "month", "year"].includes(active?.plan) ? active.plan : plansDefaultForRole(role);
    const initialQuote = this.app.services.license.calculateActivationPrice(role, initialPlan, Number(active?.teacherSlots || 0), currency);
    const plans = role === "admin"
      ? [["month", "شهري"], ["year", "سنوي"]]
      : [["week", "أسبوعي"], ["month", "شهري"], ["year", "سنوي"]];
    this.app.services.modal.open({
      title: "إعادة تفعيل الكود",
      body: `
        <form class="form-grid" id="renewal-form">
          <p class="muted">سيتم إرسال طلب إعادة تفعيل باسمك إلى لوحة الإدارة. يمكنك تغيير نوع الاشتراك من هنا.</p>
          <label>الاسم الذي سيتم التحويل به
            <input class="field" name="customerName" value="${escapeAttribute(settings.teacherName || active?.ownerName || active?.customerName || "")}" required />
          </label>
          <label>نوع الاشتراك
            <select class="select-field" name="requestedPlan">
              ${plans.map(([value, label]) => `<option value="${value}" ${initialPlan === value ? "selected" : ""}>${label}</option>`).join("")}
            </select>
          </label>
          <div class="plan-preview renewal-price-preview" id="renewal-price-preview">
            <span>السعر المطلوب</span>
            <strong>${initialQuote.label}</strong>
          </div>
          <input type="hidden" name="accountRole" value="${escapeAttribute(role)}" />
          <input type="hidden" name="teacherSlots" value="${Number(active?.teacherSlots || 0)}" />
          <input type="hidden" name="currency" value="${escapeAttribute(currency)}" />
          <input type="hidden" name="requestKind" value="renewal" />
        </form>
      `,
      actions: [
        { label: "إلغاء", action: "close" },
        { label: "إرسال طلب إعادة التفعيل", variant: "primary", action: async (root) => {
          const form = root.querySelector("#renewal-form");
          if (!form.reportValidity()) return false;
          if (!window.confirm("هل أنت متأكد أنك دفعت؟ سيتم إرسال طلب إعادة التفعيل إلى صاحب التطبيق للمراجعة.")) return false;
          const data = Object.fromEntries(new FormData(form));
          const result = await this.app.services.license.createActivationRequest(data);
          this.app.services.toast.show(result.message || "تم إرسال طلب إعادة التفعيل", result.ok ? "success" : "error");
          return Boolean(result.ok);
        }}
      ]
    });
    const form = qs("#renewal-form");
    const preview = qs("#renewal-price-preview strong");
    form?.requestedPlan?.addEventListener("change", () => {
      const quote = this.app.services.license.calculateActivationPrice(role, form.requestedPlan.value, Number(active?.teacherSlots || 0), currency);
      if (preview) preview.textContent = quote.label;
    });
    renderIcons();
  }

  injectSettingsEnhancements(settings) {
    const toolbar = qs(".toolbar .toolbar-group");
    toolbar?.insertAdjacentHTML("afterbegin", `
      <label class="search-input settings-search-box">
        <input id="settings-search" type="search" placeholder="بحث داخل الإعدادات..." />
        <i data-lucide="search"></i>
      </label>
    `);
    const form = qs("#settings-form");
    const years = this.app.services.store.getAcademicYears();
    const current = this.app.services.store.getCurrentAcademicYear();
    const options = years.map((year) => `<option value="${escapeAttribute(year.id)}">${escapeHtml(year.label)}${year.archived ? " - مؤرشفة" : ""}</option>`).join("");
    form?.insertAdjacentHTML("beforeend", `
      <section class="settings-section academic-years-section" data-settings-extra="سنوات دراسية سنة جديدة أرشفة الأرشيف نقل البيانات">
        <h3>إدارة السنوات الدراسية</h3>
        <p class="muted">السنة الحالية: <strong>${escapeHtml(current?.label || settings.currentAcademicYearLabel || "غير محددة")}</strong></p>
        <div class="academic-actions-grid">
          <button class="primary-button" type="button" id="start-academic-year"><i data-lucide="sparkles"></i>بدء سنة جديدة</button>
          <button class="ghost-button" type="button" id="archive-academic-year"><i data-lucide="archive"></i>أرشفة السنة الحالية</button>
          <button class="ghost-button" type="button" id="show-academic-archive"><i data-lucide="folder-open"></i>عرض السنوات السابقة</button>
        </div>
        <div class="academic-transfer-box">
          <h4><i data-lucide="copy-check"></i>نقل البيانات</h4>
          <div class="academic-transfer-grid">
            <label>من
              <select class="select-field" id="academic-transfer-from">${options}</select>
            </label>
            <label>إلى
              <select class="select-field" id="academic-transfer-to">${options}</select>
            </label>
          </div>
          <div class="academic-check-grid">
            ${academicCheck("students", "الطلاب", "نقل الأسماء فقط")}
            ${academicCheck("subjects", "المواد", "نقل أسماء المواد")}
            ${academicCheck("teachers", "المعلمين", "نقل الحسابات عند توفرها")}
            ${academicCheck("lessons", "الحصص", "نقل الجدول")}
          </div>
          <div class="academic-transfer-grid">
            <label>طريقة النقل
              <select class="select-field" id="academic-transfer-mode">
                <option value="copy">نسخ البيانات</option>
                <option value="move">نقل ثم حذف القديمة</option>
              </select>
            </label>
            <label>إذا وجدت بيانات مكررة
              <select class="select-field" id="academic-duplicate-mode">
                <option value="skip">تجاهل المكرر</option>
                <option value="update">تحديث الموجود</option>
                <option value="ask">السؤال قبل النقل</option>
              </select>
            </label>
          </div>
          <div id="academic-preview" class="academic-preview-box" hidden></div>
          <div class="toolbar-group">
            <button class="ghost-button" type="button" id="academic-preview-button"><i data-lucide="eye"></i>معاينة النقل</button>
            <button class="primary-button" type="button" id="academic-transfer-button"><i data-lucide="send"></i>تنفيذ النقل</button>
          </div>
        </div>
      </section>
    `);
    document.querySelectorAll(".settings-section").forEach((section) => {
      section.dataset.searchText = normalizeSearch(`${section.textContent || ""} ${section.dataset.settingsExtra || ""}`);
    });
  }

  decorateSettingsSections() {
    const sections = [...document.querySelectorAll(".settings-section")];
    const meta = settingsSectionMeta();
    sections.forEach((section, index) => {
      if (section.classList.contains("settings-list-section")) return;
      const heading = section.querySelector("h3");
      const title = heading?.textContent?.trim() || `قسم ${index + 1}`;
      const info = meta[normalizeSearch(title)] || {
        icon: "settings",
        description: "إعدادات مرتبطة بهذا القسم.",
        tone: "blue"
      };
      const body = document.createElement("div");
      body.className = "settings-section-body";
      [...section.childNodes].forEach((node) => {
        if (node === heading) return;
        body.appendChild(node);
      });
      heading?.remove();
      section.classList.add("settings-list-section");
      section.dataset.settingsTone = info.tone;
      section.insertAdjacentHTML("afterbegin", `
        <button class="settings-section-head" type="button" aria-expanded="${index === 0 ? "true" : "false"}">
          <span class="settings-section-icon"><i data-lucide="${info.icon}"></i></span>
          <span class="settings-section-copy">
            <strong>${escapeHtml(title)}</strong>
            <small>${escapeHtml(info.description)}</small>
          </span>
          <i class="settings-section-arrow" data-lucide="chevron-left"></i>
        </button>
      `);
      section.appendChild(body);
      section.classList.toggle("open", index === 0);
      section.querySelector(".settings-section-head")?.addEventListener("click", () => {
        const isOpen = section.classList.toggle("open");
        section.querySelector(".settings-section-head")?.setAttribute("aria-expanded", String(isOpen));
      });
    });
  }

  bindSettingsSearch() {
    qs("#settings-search")?.addEventListener("input", (event) => {
      const term = normalizeSearch(event.target.value);
      document.querySelectorAll(".settings-section").forEach((section) => {
        section.hidden = Boolean(term) && !section.dataset.searchText.includes(term);
        if (term && !section.hidden) {
          section.classList.add("open");
          section.querySelector(".settings-section-head")?.setAttribute("aria-expanded", "true");
        }
      });
    });
  }

  bindAcademicYears() {
    qs("#start-academic-year")?.addEventListener("click", async () => {
      const ok = await this.app.services.modal.confirm({
        title: "بدء سنة دراسية جديدة",
        message: "سيتم حفظ نسخة من السنة الحالية في الأرشيف وفتح سنة جديدة للعمل عليها. هل تريد المتابعة؟",
        confirmLabel: "بدء سنة جديدة",
        cancelLabel: "رجوع"
      });
      if (!ok) return;
      const result = await this.app.services.store.startNewAcademicYear();
      this.app.services.toast.show(`تم فتح السنة ${result.label}`, "success");
      this.render();
    });
    qs("#archive-academic-year")?.addEventListener("click", async () => {
      const ok = await this.app.services.modal.confirm({
        title: "أرشفة السنة الحالية",
        message: "ستتحول السنة الحالية إلى قراءة فقط داخل الأرشيف وتبقى محفوظة للرجوع إليها.",
        confirmLabel: "أرشفة السنة",
        cancelLabel: "إلغاء"
      });
      if (!ok) return;
      const result = await this.app.services.store.archiveCurrentAcademicYear();
      this.app.services.toast.show(`تمت أرشفة ${result.label}`, "success");
      this.render();
    });
    qs("#show-academic-archive")?.addEventListener("click", () => this.openAcademicArchive());
    qs("#academic-preview-button")?.addEventListener("click", () => this.previewAcademicTransfer());
    qs("#academic-transfer-button")?.addEventListener("click", () => this.executeAcademicTransfer());
  }

  academicTransferOptions() {
    return {
      fromYearId: qs("#academic-transfer-from")?.value,
      toYearId: qs("#academic-transfer-to")?.value,
      students: qs("#academic-transfer-students")?.checked,
      subjects: qs("#academic-transfer-subjects")?.checked,
      teachers: qs("#academic-transfer-teachers")?.checked,
      lessons: qs("#academic-transfer-lessons")?.checked,
      transferMode: qs("#academic-transfer-mode")?.value || "copy",
      duplicateMode: qs("#academic-duplicate-mode")?.value || "skip"
    };
  }

  previewAcademicTransfer() {
    const preview = this.app.services.store.previewAcademicTransfer(this.academicTransferOptions());
    const box = qs("#academic-preview");
    if (!box) return;
    box.hidden = false;
    box.innerHTML = `
      <strong>سيتم نقل:</strong>
      <span>الطلاب: ${preview.students}</span>
      <span>المواد: ${preview.subjects}</span>
      <span>المعلمين: ${preview.teachers}</span>
      <span>الحصص: ${preview.lessons}</span>
    `;
  }

  async executeAcademicTransfer() {
    const options = this.academicTransferOptions();
    const preview = this.app.services.store.previewAcademicTransfer(options);
    const ok = await this.app.services.modal.confirm({
      title: "تنفيذ نقل البيانات",
      message: `سيتم نقل ${preview.students} طالب، ${preview.subjects} مادة، ${preview.lessons} حصة. هل تريد المتابعة؟`,
      confirmLabel: "تنفيذ النقل",
      cancelLabel: "رجوع"
    });
    if (!ok) return;
    const result = await this.app.services.store.transferAcademicYearData(options);
    this.app.services.toast.show(result.ok ? "تم نقل البيانات" : "تعذر نقل البيانات", result.ok ? "success" : "error");
    this.render();
  }

  openAcademicArchive() {
    const years = this.app.services.store.getAcademicYears();
    this.app.services.modal.open({
      title: "أرشيف السنوات الدراسية",
      body: `
        <div class="academic-archive-list">
          ${years.map((year) => `
            <article>
              <strong>${escapeHtml(year.label)}</strong>
              <span>${year.archived ? "مؤرشفة - قراءة فقط" : year.status === "active" ? "السنة الحالية" : "محفوظة"}</span>
              <small>${year.snapshot?.savedAt ? new Intl.DateTimeFormat("ar-SA", { dateStyle: "medium" }).format(new Date(year.snapshot.savedAt)) : "لا توجد نسخة محفوظة بعد"}</small>
            </article>
          `).join("")}
        </div>
      `,
      actions: [{ label: "إغلاق", variant: "primary", action: "close" }]
    });
    renderIcons();
  }

  openHelp() {
    this.app.services.modal.open({
      title: "المساعدة وتعليمات استخدام يُسر",
      body: `
        <div class="help-guide">
          <article><h3><i data-lucide="building-2"></i> الجهات التعليمية</h3><p>أضف جهة مثل مدرسة أو جامعة من قسم الحصص. كل جهة لها مواد وطلاب وكشف ودرجات مستقلة.</p></article>
          <article><h3><i data-lucide="book-open"></i> المواد والطلاب</h3><p>اختر الجهة الحالية من صفحة المواد، ثم أضف المواد والطلاب يدويًا أو عن طريق Excel.</p></article>
          <article><h3><i data-lucide="calendar-days"></i> جدول الحصص</h3><p>أضف وقت الحصة لكل مادة. التطبيق يمنع تداخل حصتين في نفس اليوم والوقت.</p></article>
          <article><h3><i data-lucide="check-check"></i> التحضير</h3><p>اختر اليوم ثم الحصة، وبعدها حضر الطلاب بالأزرار أو السحب. بعد الحفظ يظهر التحضير في الكشف الشهري.</p></article>
          <article><h3><i data-lucide="table-properties"></i> الدرجات</h3><p>أضف أعمدة درجات مخصصة وحدد الدرجة العظمى، ويمكن ترتيب الأعمدة وحساب المجموع تلقائيًا.</p></article>
          <article><h3><i data-lucide="bar-chart-3"></i> الإحصائيات والتصدير</h3><p>راجع الغياب والتأخير والنجاح والرسوب وتحليل الدرجات، ثم صدّر التقارير PDF أو Excel.</p></article>
          <article><h3><i data-lucide="shield-check"></i> النسخ الاحتياطي</h3><p>من الإعدادات يمكنك تصدير كل بياناتك في ملف واحد، واسترجاعها لاحقًا بدون فقد المواد أو الطلاب.</p></article>
        </div>
      `,
      actions: [{ label: "فهمت", variant: "primary", action: "close" }]
    });
    renderIcons();
  }

  async save() {
    const form = qs("#settings-form");
    const data = Object.fromEntries(new FormData(form));
    document.querySelectorAll(".switch").forEach((button) => data[button.dataset.name] = button.classList.contains("active"));
    data.absenceLimit = Number(data.absenceLimit);
    data.reminderMinutes = Number(data.reminderMinutes || 15);
    await this.app.services.license.updateActiveOwnerName(data.teacherName);
    await this.app.services.store.updateSettings(data);
    applyTheme(data.theme);
    this.app.services.notifications.start();
    this.app.services.assistant?.refresh?.();
    this.app.services.toast.show("تم حفظ الإعدادات", "success");
    document.dispatchEvent(new CustomEvent("teacher-profile-updated"));
    this.render();
  }

  async saveAppPassword() {
    const password = qs("#app-password")?.value || "";
    const confirmation = qs("#app-password-confirm")?.value || "";
    if (password.length < 4) {
      this.app.services.toast.show("كلمة السر يجب أن تكون 4 أحرف أو أرقام على الأقل", "error");
      return;
    }
    if (password !== confirmation) {
      this.app.services.toast.show("تأكيد كلمة السر غير مطابق", "error");
      return;
    }
    const hash = await hashText(password);
    const securityQuestion = qs("#app-security-question")?.value || "";
    const securityAnswer = normalizeSecurityAnswer(qs("#app-security-answer")?.value || "");
    const current = this.app.services.store.getSettings();
    const securityAnswerHash = securityAnswer ? await hashText(securityAnswer) : (current.appPasswordSecurityAnswerHash || "");
    await this.app.services.store.updateSettings({
      appPasswordEnabled: true,
      appPasswordHash: hash,
      appPasswordAutoLock: Boolean(current.appPasswordAutoLock),
      appPasswordSecurityQuestion: securityQuestion,
      appPasswordSecurityAnswerHash: securityAnswerHash
    });
    sessionStorage.setItem("yusr-app-unlocked-v1", hash);
    this.app.services.toast.show("تم حفظ كلمة سر الدخول", "success");
    this.render();
  }

  async removeAppPassword() {
    const ok = await this.app.services.modal.confirm({
      title: "إلغاء كلمة السر",
      message: "هل تريد إلغاء طلب كلمة السر عند دخول التطبيق؟",
      confirmLabel: "إلغاء كلمة السر",
      cancelLabel: "رجوع",
      danger: true
    });
    if (!ok) return;
    await this.app.services.store.updateSettings({
      appPasswordEnabled: false,
      appPasswordHash: "",
      appPasswordAutoLock: false,
      appPasswordSecurityQuestion: "",
      appPasswordSecurityAnswerHash: ""
    });
    sessionStorage.removeItem("yusr-app-unlocked-v1");
    this.app.services.toast.show("تم إلغاء كلمة السر", "success");
    this.render();
  }

  async toggleAutoLock() {
    const settings = this.app.services.store.getSettings();
    const next = !settings.appPasswordAutoLock;
    await this.app.services.store.updateSettings({ appPasswordAutoLock: next });
    this.app.services.toast.show(next ? "تم تفعيل القفل التلقائي" : "تم إلغاء القفل التلقائي", "success");
    this.render();
  }

  exportBackup() {
    const payload = this.app.services.store.exportState();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `yusr-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    this.app.services.toast.show("تم إنشاء النسخة الاحتياطية", "success");
  }

  async importBackup(file) {
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const ok = await this.app.services.modal.confirm({
        title: "استيراد نسخة احتياطية",
        message: "سيتم استبدال بيانات هذا الجهاز بالنسخة المحددة. هل تريد المتابعة؟",
        confirmLabel: "استيراد",
        cancelLabel: "إلغاء",
        danger: false
      });
      if (!ok) return;
      const result = await this.app.services.store.importState(payload);
      if (!result.ok) throw new Error("invalid");
      this.app.services.toast.show("تم استيراد النسخة الاحتياطية", "success");
      this.render();
    } catch {
      this.app.services.toast.show("تعذر قراءة ملف النسخة الاحتياطية", "error");
    }
  }
}

function switchRow(name, label, checked) {
  return `<div class="switch-row"><span>${label}</span><button class="switch ${checked ? "active" : ""}" type="button" data-name="${name}" aria-label="${label}"><span></span></button></div>`;
}

function academicCheck(name, title, description) {
  return `
    <label class="academic-check-card">
      <input id="academic-transfer-${name}" type="checkbox" checked />
      <span>
        <strong>${title}</strong>
        <small>${description}</small>
      </span>
    </label>
  `;
}

function settingsSectionMeta() {
  const rows = [
    ["حساب المعلم", "user-round", "تعديل اسم المعلم والبيانات الظاهرة داخل التطبيق.", "green"],
    ["الاشتراك والتفعيل", "badge-check", "إعادة التفعيل وتغيير نوع الاشتراك عند الحاجة.", "blue"],
    ["كلمة سر الدخول", "lock-keyhole", "تفعيل كلمة السر وسؤال الأمان والقفل التلقائي.", "green"],
    ["التحضير", "clipboard-check", "طريقة التحضير وحد الغياب والبحث السريع.", "teal"],
    ["التنبيهات والترتيب", "bell-ring", "الإشعارات وترتيب الطلاب داخل القوائم.", "blue"],
    ["المظهر والتاريخ", "palette", "الثيم واللغة ونوع التاريخ ميلادي أو هجري.", "purple"],
    ["النسخ الاحتياطي", "cloud-upload", "تصدير واستيراد نسخة احتياطية من بياناتك.", "sky"],
    ["إشعارات الجهاز", "bell", "تذكير الحصص وتنبيهات الجهاز قبل الحصة.", "blue"],
    ["المساعد الذكي", "bot", "إظهار الروبوت والاقتراحات وحفظ المحادثات.", "cyan"],
    ["إدارة السنوات الدراسية", "calendar-days", "بدء سنة جديدة والأرشفة ونقل البيانات.", "orange"]
  ];
  return Object.fromEntries(rows.map(([title, icon, description, tone]) => [
    normalizeSearch(title),
    { icon, description, tone }
  ]));
}

function plansDefaultForRole(role = "teacher") {
  return role === "admin" ? "month" : "week";
}

function securityQuestionOptions(selected = "") {
  const questions = [
    ["imam", "ما اسم الإمام الذي تستمتع بسماع تلاوته؟"],
    ["mosque", "ما اسم أول مسجد كنت تصلي فيه بانتظام؟"],
    ["surah", "ما اسم السورة المفضلة لديك؟"]
  ];
  return questions.map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("");
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

function normalizeSearch(value = "") {
  return String(value)
    .toLocaleLowerCase("ar")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function escapeAttribute(value = "") {
  return escapeHtml(value);
}

function applyTheme(mode) {
  const theme = mode === "system"
    ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : mode;
  document.documentElement.dataset.theme = theme || "light";
}
