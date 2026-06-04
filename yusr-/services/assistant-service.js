import { qs, renderIcons } from "../utils/dom.js?v=53";

const ASSISTANT_POSITION_KEY = "yusr-assistant-position-v1";
const ASSISTANT_HISTORY_KEY = "yusr-assistant-history-v1";
const ARABIC_DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

export class SmartAssistantService {
  constructor(app) {
    this.app = app;
    this.root = null;
    this.messages = [];
    this.drag = null;
    this.isOpen = false;
    this.awaitingResumeChoice = false;
    this.context = {
      lastStudent: null,
      lastSubject: null,
      lastInstitution: null,
      lastGradeColumn: null,
      lastIntent: ""
    };
    this.currentHistoryKey = this.historyKey();
  }

  mount() {
    if (this.root) return;
    this.root = document.createElement("aside");
    this.root.id = "smart-assistant";
    this.root.className = "smart-assistant";
    document.body.appendChild(this.root);
    this.currentHistoryKey = this.historyKey();
    this.messages = this.loadHistory();
    this.render();
    this.bindGlobalEvents();
  }

  refresh() {
    if (!this.root) return;
    const settings = this.app.services.store?.getSettings?.() || {};
    const active = this.app.services.license?.isActive?.();
    const locked = document.body.classList.contains("app-password-locked");
    const adminRoute = this.app.state.currentRoute === "admin" || location.hash.startsWith("#/admin");
    const nextHistoryKey = this.historyKey();
    if (nextHistoryKey !== this.currentHistoryKey) {
      this.currentHistoryKey = nextHistoryKey;
      this.messages = this.loadHistory();
      this.awaitingResumeChoice = false;
      this.renderMessages();
    }
    this.root.hidden = !active || locked || settings.assistantVisible === false || adminRoute;
    if (!this.root.hidden) this.renderRobotAnimation();
  }

  bindGlobalEvents() {
    window.addEventListener("hashchange", () => setTimeout(() => this.refresh(), 60));
    window.addEventListener("store-updated", () => {
      this.messages = this.loadHistory();
      this.render();
      this.refresh();
    });
    document.addEventListener("teacher-profile-updated", () => this.renderMessages());
  }

  render() {
    const settings = this.app.services.store?.getSettings?.() || {};
    const position = this.savedPosition();
    this.root.innerHTML = `
      <button class="assistant-orb" type="button" aria-label="المساعد الذكي" title="المساعد الذكي">
        <span class="assistant-robot-animation" aria-hidden="true"></span>
        <span class="assistant-robot-fallback" aria-hidden="true">
          <svg class="assistant-robot-svg" viewBox="0 0 96 96" role="img" aria-hidden="true">
            <defs>
              <linearGradient id="assistantBodyGradient" x1="18" y1="12" x2="78" y2="88" gradientUnits="userSpaceOnUse">
                <stop offset="0" stop-color="#ffffff" />
                <stop offset="0.55" stop-color="#dbeafe" />
                <stop offset="1" stop-color="#7aa7ff" />
              </linearGradient>
              <linearGradient id="assistantBlueGradient" x1="18" y1="18" x2="80" y2="80" gradientUnits="userSpaceOnUse">
                <stop offset="0" stop-color="#8cecff" />
                <stop offset="1" stop-color="#2563eb" />
              </linearGradient>
              <radialGradient id="assistantGlowGradient" cx="50%" cy="50%" r="50%">
                <stop offset="0" stop-color="#8df5ff" />
                <stop offset="1" stop-color="#2563eb" />
              </radialGradient>
            </defs>
            <g class="assistant-svg-shadow">
              <ellipse cx="48" cy="86" rx="28" ry="6" fill="rgba(37,99,235,.16)" />
            </g>
            <g class="assistant-svg-arm assistant-svg-arm-left">
              <path d="M30 57 C21 60 17 66 17 73" />
              <circle cx="17" cy="74" r="8" />
            </g>
            <g class="assistant-svg-arm assistant-svg-arm-right">
              <path d="M66 57 C78 53 82 45 82 36" />
              <circle cx="82" cy="35" r="8" />
            </g>
            <g class="assistant-svg-body">
              <rect x="28" y="47" width="40" height="36" rx="19" fill="url(#assistantBodyGradient)" />
              <circle cx="48" cy="66" r="12" fill="url(#assistantGlowGradient)" opacity=".92" />
              <circle cx="48" cy="66" r="7" fill="#bff7ff" opacity=".8" />
            </g>
            <g class="assistant-svg-head">
              <path d="M48 10 V17" />
              <circle cx="48" cy="8" r="5" fill="url(#assistantBlueGradient)" />
              <rect x="21" y="17" width="54" height="42" rx="22" fill="url(#assistantBodyGradient)" />
              <rect class="assistant-svg-face" x="29" y="27" width="38" height="22" rx="11" fill="#111c44" />
              <circle class="assistant-svg-eye assistant-svg-eye-left" cx="41" cy="38" r="4.2" fill="#7df2ff" />
              <circle class="assistant-svg-eye assistant-svg-eye-right" cx="55" cy="38" r="4.2" fill="#7df2ff" />
              <rect x="43" y="29" width="10" height="3" rx="2" fill="#75e8ff" opacity=".55" />
            </g>
          </svg>
        </span>
      </button>
      <section class="assistant-chat glass-panel" ${this.isOpen ? "" : "hidden"}>
        <header class="assistant-chat-header">
          <div>
            <span class="eyebrow">يُسر</span>
            <strong>المساعد الذكي</strong>
          </div>
          <button class="icon-button" type="button" data-assistant-close aria-label="إغلاق"><i data-lucide="x"></i></button>
        </header>
        ${this.awaitingResumeChoice ? this.resumeChoiceHtml() : `
          <div class="assistant-messages" id="assistant-messages"></div>
          ${settings.assistantSuggestions === false ? "" : this.suggestionsHtml()}
          <form class="assistant-input-row" id="assistant-form">
            <input class="field" name="message" autocomplete="off" placeholder="اكتب سؤالك داخل النظام..." />
            <button class="primary-button" aria-label="إرسال"><i data-lucide="send"></i></button>
          </form>
        `}
      </section>
    `;
    this.root.dataset.side = position.side;
    this.root.style.top = position.top;
    this.bindUi();
    this.renderMessages();
    this.refresh();
    renderIcons();
  }

  bindUi() {
    const orb = qs(".assistant-orb", this.root);
    orb?.addEventListener("pointerdown", (event) => this.startDrag(event));
    orb?.addEventListener("click", () => {
      if (this.drag?.moved) return;
      this.toggleChat();
    });
    qs(".assistant-chat", this.root)?.addEventListener("click", (event) => event.stopPropagation());
    qs("[data-assistant-close]", this.root)?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.closeChat();
    });
    qs("[data-assistant-resume]", this.root)?.addEventListener("click", () => {
      this.awaitingResumeChoice = false;
      this.render();
    });
    qs("[data-assistant-new]", this.root)?.addEventListener("click", () => {
      this.awaitingResumeChoice = false;
      this.messages = [];
      this.context = {
        lastStudent: null,
        lastSubject: null,
        lastInstitution: null,
        lastGradeColumn: null,
        lastIntent: ""
      };
      this.addWelcomeMessage();
      this.persistHistory();
      this.render();
    });
    qs("#assistant-form", this.root)?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = event.currentTarget.elements.message;
      const message = String(input.value || "").trim();
      if (!message) return;
      input.value = "";
      await this.ask(message);
    });
    this.root.querySelectorAll("[data-assistant-suggest]").forEach((button) => {
      button.addEventListener("click", () => this.ask(button.dataset.assistantSuggest));
    });
  }

  startDrag(event) {
    const orb = qs(".assistant-orb", this.root);
    if (!orb) return;
    const rect = this.root.getBoundingClientRect();
    this.drag = {
      startX: event.clientX,
      startY: event.clientY,
      offsetY: event.clientY - rect.top,
      moved: false
    };
    orb.setPointerCapture?.(event.pointerId);
    const move = (moveEvent) => {
      if (!this.drag) return;
      const delta = Math.abs(moveEvent.clientX - this.drag.startX) + Math.abs(moveEvent.clientY - this.drag.startY);
      if (delta > 8) this.drag.moved = true;
      const top = Math.max(76, Math.min(window.innerHeight - 112, moveEvent.clientY - this.drag.offsetY));
      this.root.style.top = `${top}px`;
      const side = moveEvent.clientX > window.innerWidth / 2 ? "right" : "left";
      this.root.dataset.side = side;
    };
    const up = () => {
      if (!this.drag) return;
      localStorage.setItem(ASSISTANT_POSITION_KEY, JSON.stringify({
        side: this.root.dataset.side || "right",
        top: this.root.style.top || "calc(100vh - 190px)"
      }));
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setTimeout(() => { this.drag = null; }, 0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  toggleChat() {
    this.isOpen = !this.isOpen;
    if (this.isOpen && !this.messages.length) this.addWelcomeMessage();
    this.render();
  }

  closeChat() {
    this.isOpen = false;
    this.awaitingResumeChoice = this.messages.length > 0;
    const chat = qs(".assistant-chat", this.root);
    if (chat) chat.hidden = true;
  }

  addWelcomeMessage() {
    const name = this.app.services.store.getSettings().teacherName || "المستخدم";
    this.messages.push({
      role: "assistant",
      text: `مرحبًا ${name}\nيمكنني مساعدتك في استخدام النظام والوصول إلى المعلومات بسرعة.`
    });
    this.persistHistory();
  }

  async ask(message) {
    this.isOpen = true;
    this.messages.push({ role: "user", text: message });
    this.renderMessages();
    const response = await this.answer(message);
    this.messages.push({ role: "assistant", text: response });
    this.persistHistory();
    this.renderMessages();
  }

  async answer(rawMessage) {
    const message = normalize(rawMessage);
    const license = this.app.services.license.getActiveLicense();
    const role = license?.accessMode || "teacher";
    if (isOffensive(message)) return this.politeBoundaryAnswer();
    if (asksAboutCreator(message)) return this.creatorAnswer();
    if (isGreeting(message)) return this.greetingAnswer();
    if (isWellbeing(message)) return "بخير ولله الحمد، جاهز أساعدك داخل يُسر. اكتب مثلًا: افتح التحضير، معلومات عن الطالب أمين، أو ما الحصة القادمة؟";
    if (isThanks(message)) return "العفو، هذا واجبي. إذا أردت اختصار الوقت اكتب اسم المهمة مباشرة وسأحاول فتحها أو شرحها لك.";
    if (asksCapabilities(message)) return this.capabilitiesAnswer(role);
    if (isOutsideScope(message)) return "هذا السؤال خارج نطاق المساعد الذكي.\nأنا مخصص للمساعدة داخل النظام فقط.";
    const directTheme = await this.tryThemeAction(message);
    if (directTheme) return directTheme;
    const directKnowledge = this.isKnowledgeQuestion(message) ? this.knowledgeAnswer(message, role) : this.knowledgeAnswer(message, role, { strict: true });
    if (directKnowledge) return directKnowledge;

    const request = this.parseRequest(message);
    this.context.lastIntent = request.type;

    if (request.type === "out_of_scope") {
      return "أنا مساعد خاص بالنظام وأساعد فقط في إدارة التطبيق.";
    }

    if (request.type === "action") {
      return this.handleActionRequest(request, message);
    }

    if (request.type === "explanation") {
      return this.handleExplanationRequest(request, message);
    }

    if (request.type === "query") {
      return this.handleQueryRequest(request, message, role, license);
    }

    return "لم أفهم الطلب بدقة داخل النظام.\nجرّب مثلًا: معلومات عن الطالب أمين، افتح التحضير، من أكثر الطلاب غيابًا، أو ما الحصة القادمة؟";
  }

  greetingAnswer() {
    const name = this.app.services.store.getSettings().teacherName || "صديقي";
    return `مرحبًا ${name}.\nأنا معك داخل يُسر. أقدر أساعدك في الطلاب، التحضير، الدرجات، الحصص، الإحصائيات، والانتقال السريع بين الصفحات.`;
  }

  capabilitiesAnswer(role) {
    if (role === "admin") {
      return "أستطيع مساعدتك كمشرف في متابعة المعلمين والمندوبين، فتح السلوك والمواظبة، إنشاء الأكواد، مراجعة الإحصائيات، تقارير المشرف، إدارة السنوات الدراسية، والوصول السريع للمواد والطلاب.";
    }
    if (role === "delegate") {
      return "أستطيع مساعدتك كمندوب في التحضير، الطلاب، الحصص، والكشوفات المرتبطة بالتحضير فقط حسب صلاحيتك.";
    }
    return "أستطيع مساعدتك كمعلم في فتح التحضير والدرجات، البحث عن طالب، تحليل الغياب والتأخير، معرفة الحصة القادمة، وشرح طريقة استخدام الأقسام.";
  }

  politeBoundaryAnswer() {
    return [
      "أفهم أن هناك انزعاجًا، لكن خلّينا نحافظ على أسلوب محترم داخل النظام.",
      "اكتب طلبك مباشرة وسأساعدك فورًا، مثل:",
      "• افتح التحضير",
      "• كم سعر الاشتراك؟",
      "• معلومات عن الطالب أمين"
    ].join("\n");
  }

  creatorAnswer() {
    return [
      "تم تطوير وتصميم التطبيق بواسطة:",
      "المهندس أمين سمير أمين اليوسفي",
      "للتواصل:",
      "778530052",
      "737828207"
    ].join("\n");
  }

  parseRequest(message) {
    const intent = detectIntent(message);
    const institutionMatches = this.findInstitutionsFromMessage(message);
    const institution = institutionMatches[0] || this.context.lastInstitution;
    const subjectMatches = this.findSubjectsFromMessage(message, institution);
    const subject = subjectMatches[0] || this.context.lastSubject;
    const studentMatches = this.findStudentsFromMessage(message, institution, subject);
    const student = studentMatches[0] || this.studentFromMemory(message);
    const gradeColumn = this.findGradeColumnFromMessage(message, subject || student?.subject);
    const pageName = this.extractPageName(message);
    if (institution) this.context.lastInstitution = institution;
    if (subject) this.context.lastSubject = subject;
    if (student) {
      this.context.lastStudent = {
        subjectId: student.subject.id,
        studentId: student.student.id,
        studentName: student.student.name
      };
      this.context.lastSubject = student.subject;
    }
    if (gradeColumn) this.context.lastGradeColumn = gradeColumn;
    return {
      type: intent.category,
      intent: intent.name,
      institution,
      institutionMatches,
      subject,
      subjectMatches,
      student,
      studentMatches,
      gradeColumn,
      pageName,
      needsClarification: this.needsClarification(message, intent, {
        institutionMatches,
        subjectMatches,
        studentMatches,
        institution,
        subject,
        student,
        gradeColumn
      })
    };
  }

  async handleQueryRequest(request, message, role, license) {
    if (request.needsClarification) return request.needsClarification;
    const delegateBlocked = ["grades", "columnGrade", "failureReason", "topStudents", "atRisk", "subjectStats"].includes(request.intent);
    if (role === "delegate" && delegateBlocked) {
      return "هذه المعلومة غير متاحة لصلاحية المندوب. يمكنني مساعدتك في الطلاب، التحضير، الحصص، والكشوفات حسب صلاحيتك.";
    }
    if (request.intent === "countTeachers") {
      if (role !== "admin") return "هذه المعلومة غير متاحة لصلاحية هذا الحساب.";
      const codes = await this.app.services.license.listManagedCodesWithUsage(license.code).catch(() => this.app.services.license.listManagedCodes(license.code));
      const teachers = codes.filter((item) => item.accessMode === "teacher");
      return `📊 عدد المعلمين التابعين حاليًا: ${teachers.length}.`;
    }
    if (request.intent === "countSubjects") return this.subjectsCountAnswer(request.institution);
    if (request.intent === "countStudents") return this.studentsCountAnswer(request.subject, request.institution);
    if (request.intent === "countInstitutions") return this.institutionsCountAnswer();
    if (request.intent === "countLessons") return this.lessonsCountAnswer(request.institution);
    if (request.intent === "countViolations") return this.behaviorViolationsAnswer(request.student, request.institution);
    if (request.intent === "countRequests") return this.studentRequestsAnswer(role);
    if (request.intent === "subscriptionStatus") return this.subscriptionAnswer(license);
    if (request.intent === "permissions") return this.permissionsAnswer(role, license);
    if (request.intent === "summary") return this.systemSummaryAnswer(request.institution);
    if (request.intent === "pricing") {
      return this.pricingAnswer();
    }
    if (request.intent === "nextLesson") {
      return this.nextLessonAnswer();
    }
    if (request.intent === "mostAbsent") {
      return this.mostAbsentAnswer(request.institution);
    }
    if (request.intent === "mostLate") {
      return this.mostLateAnswer(request.institution);
    }
    if (request.intent === "topStudents") {
      if (!request.subject && hasAny(message, ["اذكى طالب", "أذكى طالب", "افضل طالب", "أفضل طالب", "اعلى طالب", "أعلى طالب"])) {
        return "حدد المادة أولًا حتى أعرض لك الطالب الأعلى فيها. مثال: أذكى طالب في البرمجة.";
      }
      return this.topStudentsAnswer(request.institution);
    }
    if (request.intent === "atRisk") {
      if (!request.subject && hasAny(message, ["اضعف طالب", "أضعف طالب", "اقل طالب", "أقل طالب", "منخفض الدرجات"])) {
        return "حدد المادة أولًا حتى أحدد الطالب الأضعف بدقة. مثال: أضعف طالب في مادة البرمجة.";
      }
      return this.riskAnswer(request.institution);
    }
    if (request.intent === "subjectStats") {
      return this.subjectStatsAnswer(request.subject);
    }
    if (request.intent === "attendance") {
      if (!request.student) return "حدد اسم الطالب حتى أعرض الغياب، مثل: كم غاب أمين؟";
      return this.attendanceAnswer(request.student);
    }
    if (request.intent === "guardianContact") {
      if (!request.student) return "حدد اسم الطالب حتى أعرض رقم ولي الأمر، مثل: رقم ولي أمر أمين.";
      return this.guardianContactAnswer(request.student);
    }
    if (request.intent === "behavior") {
      return this.behaviorViolationsAnswer(request.student, request.institution);
    }
    if (request.intent === "failureReason") {
      if (!request.student) return "حدد اسم الطالب حتى أحلل سبب الرسوب من بيانات الدرجات.";
      return this.failureReasonAnswer(request.student);
    }
    if (request.intent === "columnGrade") {
      if (!request.student) return "حدد اسم الطالب وعمود الدرجة، مثل: كم حصل أمين في الشهري؟";
      return this.studentColumnGradeAnswer(request.student, message, request.gradeColumn);
    }
    if (request.intent === "grades") {
      if (!request.student) return "حدد اسم الطالب حتى أعرض درجاته.";
      return this.gradesAnswer(request.student);
    }
    if (request.intent === "studentsList") {
      return this.studentsListAnswer(request.subject, request.institution);
    }
    if (request.intent === "studentInfo") {
      if (!request.student) return "لم أجد الطالب في البيانات. اكتب اسمه كما هو مسجل أو حدد المادة.";
      return this.studentInfoAnswer(request.student);
    }
    return this.smartFallbackAnswer(message, role);
  }

  handleActionRequest(request, message) {
    if (request.intent === "changeTheme") return this.tryThemeAction(message);
    if (request.pageName) return this.openPage(request.pageName, request.subject);
    if (request.intent === "addStudent" || (hasAny(message, ["اضف", "اضافة", "سجل"]) && hasAny(message, STUDENT_WORDS))) {
      return this.addStudent(request.subject);
    }
    if (request.intent === "addSubject" || (hasAny(message, ["اضف", "اضافة", "سجل"]) && hasAny(message, SUBJECT_WORDS))) {
      return this.addSubject();
    }
    if (request.intent === "deleteStudent" || (hasAny(message, ["احذف", "حذف", "ازل", "امسح"]) && hasAny(message, STUDENT_WORDS))) {
      return this.deleteStudent(request.student);
    }
    if (request.intent === "deleteSubject" || (hasAny(message, ["احذف", "حذف", "ازل", "امسح"]) && hasAny(message, SUBJECT_WORDS))) {
      return this.deleteSubject(request.subject);
    }
    return "هذا أمر داخل النظام، لكن أحتاج تفاصيل أكثر لتنفيذه بدون تخمين. مثال: افتح تحضير البرمجة، أو أضف طالب في مادة البرمجة.";
  }

  handleExplanationRequest(request, message) {
    const knowledge = this.knowledgeAnswer(message, this.app.services.license.getActiveLicense()?.accessMode || "teacher");
    if (knowledge) return knowledge;
    if (hasAny(message, ["منح تحسين", "تحسين", "زيادة درجات", "درجات تحسين", "رفع درجات"])) {
      return this.featureExplanation("gradeBoost");
    }
    if (message.includes("طالب")) {
      return "📌 إضافة طالب:\n1. افتح المادة المطلوبة.\n2. ادخل تبويب الطلاب.\n3. اضغط إضافة طالب.\n4. اكتب الاسم ورقم ولي الأمر إن وجد.\n5. للحالات الكبيرة استخدم استيراد Excel.";
    }
    if (message.includes("ماده") || message.includes("مادة")) {
      return "📚 إضافة مادة:\n1. أضف الجهة أو الحصة الأساسية أولًا من قسم الحصص.\n2. افتح قسم المواد.\n3. اضغط إضافة مادة.\n4. اكتب اسم المادة والصف والمسؤول.\n5. إذا كان الحساب تابعًا فقد تحتاج صلاحية من المشرف.";
    }
    if (message.includes("تحضير") || message.includes("الحضور") || message.includes("الحظور")) {
      return "✅ استخدام التحضير:\nاختر المادة والحصة، ثم حدد حالة كل طالب: حاضر، غائب، أو متأخر. يتم حفظ اليوم والحصة حتى يظهران لاحقًا في الكشف.";
    }
    if (message.includes("درجات")) {
      return "📊 استخدام الدرجات:\nافتح المادة ثم الدرجات. يمكنك إدخال الدرجات حسب الأعمدة، وإضافة أعمدة إذا كانت الصلاحية متاحة، والمجموع يحسب تلقائيًا.";
    }
    if (message.includes("حصص") || message.includes("الحصة")) {
      return "🗓️ الحصص:\nأضف الجهة ثم أضف أوقات الحصص. التحضير والكشف يستخدمان هذه الحصص حتى تعرف كل حالة حضور مرتبطة بأي وقت.";
    }
    if (hasAny(message, ["استيراد", "اكسل", "excel"])) {
      return "📥 استيراد Excel:\nافتح تبويب الطلاب داخل المادة، ثم اختر استيراد Excel. إذا كان الملف يحتوي عدة أعمدة سيحاول النظام اكتشاف عمود الأسماء ورقم ولي الأمر تلقائيًا، وإذا لم يجد رقم الهاتف سيعرض تنبيهًا لاستيراد الأسماء فقط.";
    }
    if (hasAny(message, ["pdf", "تصدير", "طباعة", "اكسل", "excel"])) {
      return "📄 التصدير:\nاستخدم زر PDF أو Excel من القسم المناسب. في ملفات PDF يتم ترتيب الجداول حسب القسم: درجات، كشف حضور، إحصائيات، أو مخالفات. التاريخ يتبع إعداداتك: هجري أو ميلادي.";
    }
    if (hasAny(message, ["تفعيل", "اشتراك", "كود", "الدفع", "دفع"])) {
      return "🔐 التفعيل والاشتراك:\nمن صفحة التفعيل اختر نوع المستخدم ونوع الاشتراك، ثم افتح طرق الدفع وأدخل الاسم الذي تم التحويل منه. بعد الضغط على تم الدفع يظهر كود مؤقت ليوم واحد حتى يعتمد صاحب التطبيق الاشتراك.";
    }
    if (hasAny(message, ["صلاحية", "صلاحيات", "مشرف", "مندوب", "معلم"])) {
      return "🛡️ الصلاحيات:\nالمشرف يدير المعلمين والمندوبين والمواد والسلوك. المعلم المستقل يملك كل أدوات التدريس. المعلم التابع يرى ما يحدده المشرف. المندوب مخصص للتحضير والحصص والطلاب حسب الصلاحية.";
    }
    if (hasAny(message, ["مخالفة", "مخالفات", "سلوك", "مواظبة"])) {
      return "⚖️ السلوك والمواظبة:\nمن قسم المشرف افتح السلوك والمواظبة، ثم حدد الجهة والمادة والمعلم والطالب ونوع المخالفة والإجراء المتخذ. إذا فعّلت ربط الحسم بدرجة السلوك سيخصم النظام الدرجة من عمود السلوك ويظهر الخصم في PDF.";
    }
    if (hasAny(message, ["تقرير", "تقارير", "التقارير", "تقرير شامل", "تقرير منفصل"])) {
      return "📑 تقارير المشرف:\nافتح قسم المشرف ثم التقارير. ستجد تقارير الحضور، أداء المعلمين، التحصيل، الطلاب المعرضين للخطر، السلوك، الحصص، الدرجات، غير النشطين، اليومي، الشهري، والمقارنة. يمكنك تصدير تقرير شامل أو تقرير منفصل PDF.";
    }
    if (hasAny(message, ["سنة", "سنوات", "الأرشيف", "ارشيف", "أرشفة", "ارشفه", "نقل البيانات", "سنة دراسية"])) {
      return "🗓️ إدارة السنوات الدراسية:\nافتح الإعدادات ثم إدارة السنوات الدراسية. يمكنك بدء سنة جديدة، أرشفة السنة الحالية للقراءة فقط، عرض السنوات السابقة، أو نقل الطلاب والمواد والمعلمين والحصص بعد معاينة النقل.";
    }
    return "أشرح لك خطوات استخدام أقسام التطبيق فقط. اكتب مثلًا: كيف أضيف طالب؟ أو كيف أستخدم التحضير؟";
  }

  async tryThemeAction(message) {
    const darkWords = ["داكن", "غامق", "اسود", "أسود", "ليلي", "الوضع الليلي", "dark"];
    const lightWords = ["فاتح", "ابيض", "أبيض", "نهاري", "الوضع النهاري", "light"];
    const systemWords = ["النظام", "تلقائي", "حسب الجهاز", "system"];
    const wantsTheme = hasAny(message, ["ثيم", "المظهر", "الوضع", "لون", "خلي", "غير", "حول"]);
    if (!wantsTheme && !hasAny(message, [...darkWords, ...lightWords, ...systemWords])) return "";
    let theme = "";
    if (hasAny(message, darkWords)) theme = "dark";
    else if (hasAny(message, lightWords)) theme = "light";
    else if (hasAny(message, systemWords)) theme = "system";
    if (!theme) return "";
    await this.app.services.store.updateSettings({ theme });
    const resolvedTheme = theme === "system"
      ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : theme;
    document.documentElement.dataset.theme = resolvedTheme;
    document.dispatchEvent(new CustomEvent("yusr-theme-updated", { detail: { theme } }));
    const resolved = theme === "dark" ? "الداكن" : theme === "light" ? "الفاتح" : "النظام";
    return `تم تغيير المظهر إلى ${resolved}.`;
  }

  isKnowledgeQuestion(message) {
    return hasAny(message, [
      "ماذا تعرف", "وش تعرف", "ايش تعرف", "ما تعرف", "اشرح", "شرح", "ما هو", "ماهي", "ما هي",
      "ايش فكره", "ايش فكرة", "فكرة", "فكره", "ماذا يوجد", "ايش يوجد", "وش يوجد", "داخل", "قسم",
      "الغرض", "الفائده", "الفائدة", "كيف يعمل", "كيف تستخدم", "ما معنى", "ايش يعني", "وش يعني"
    ]);
  }

  knowledgeAnswer(message, role, options = {}) {
    const strict = Boolean(options.strict);
    if (hasAny(message, ["منح تحسين", "تحسين درجات", "درجات تحسين", "زيادة درجات", "رفع درجات"])) return this.featureExplanation("gradeBoost");
    const directTopic = this.directTopicAnswer(message, role);
    if (directTopic) return directTopic;
    if (strict) return "";
    if (hasAny(message, ["اقسام التطبيق", "أقسام التطبيق", "ماهي اقسام", "ما هي اقسام", "ماهي الأقسام", "ما هي الأقسام", "اقسام النظام", "أقسام النظام"])) return this.appSectionsAnswer(role);
    if (hasAny(message, ["عن التطبيق", "التطبيق بشكل عام", "ماذا تعرف عن التطبيق", "ما هو التطبيق", "ايش التطبيق", "النظام بشكل عام", "يُسر", "يسر"])) return this.appOverviewAnswer(role);
    if (hasAny(message, ["قسم المشرف", "المشرف", "صلاحية المشرف", "دور المشرف"])) return this.roleExplanation("admin", role);
    if (hasAny(message, ["قسم المندوب", "المندوب", "صلاحية المندوب", "دور المندوب"])) return this.roleExplanation("delegate", role);
    if (hasAny(message, ["قسم المعلم", "المعلم", "صلاحية المعلم", "دور المعلم"])) return this.roleExplanation("teacher", role);
    if (hasAny(message, ["داخل الاعدادات", "داخل الإعدادات", "ماذا يوجد في الاعدادات", "ماذا يوجد في الإعدادات", "قسم الاعدادات", "قسم الإعدادات", "كلمة سر", "كلمه سر", "الارشيف", "الأرشيف", "سنوات دراسية"])) return this.sectionExplanation("settings", role);
    if (hasAny(message, ["قسم الطلاب", "الطلاب", "الطالب", "إدارة الطلاب", "ادارة الطلاب"])) return this.sectionExplanation("students", role);
    if (hasAny(message, ["قسم المواد", "المواد", "الماده", "المادة"])) return this.sectionExplanation("subjects", role);
    if (hasAny(message, ["قسم التحضير", "التحضير", "الحضور"])) return this.sectionExplanation("attendance", role);
    if (hasAny(message, ["قسم الحصص", "الحصص", "جدول الحصص"])) return this.sectionExplanation("schedule", role);
    if (hasAny(message, ["قسم الاحصائيات", "قسم الإحصائيات", "الاحصائيات", "الإحصائيات", "التحليل"])) return this.sectionExplanation("stats", role);
    if (hasAny(message, ["قسم الدرجات", "الدرجات", "المجموع"])) return this.sectionExplanation("grades", role);
    if (hasAny(message, ["الأعمدة", "الاعمدة", "أعمدة الدرجات", "اعمدة الدرجات", "عمود الدرجات"])) return this.sectionExplanation("columns", role);
    if (hasAny(message, ["السلوك والمواظبه", "السلوك والمواظبة", "المخالفات", "سجل المخالفات"])) return this.sectionExplanation("behavior", role);
    if (hasAny(message, ["تقارير المشرف", "التقارير", "تقرير شامل", "تقرير منفصل"])) return this.sectionExplanation("reports", role);
    return "";
  }

  currentRoleLabel(role = this.app.services.license.getActiveLicense()?.accessMode || "teacher") {
    if (role === "admin") return "مشرف";
    if (role === "delegate") return "مندوب";
    return "معلم";
  }

  appOverviewAnswer(role) {
    return [
      "📚 تطبيق يُسر هو نظام لإدارة التحضير والدرجات والحصص والسلوك بطريقة عربية ومرتبة.",
      "",
      "الأدوار الأساسية:",
      "• المشرف: يدير المعلمين والمندوبين، المواد، الطلاب، التقارير، والسلوك والمواظبة.",
      "• المعلم: يتابع مواده وطلابه، يحضر الطلاب، يدخل الدرجات، ويصدر الكشوفات.",
      "• المندوب: يركز على التحضير والحصص والطلاب حسب الصلاحية.",
      "",
      `صلاحيتك الحالية: ${this.currentRoleLabel(role)}.`,
      "إذا تريد تفاصيل أكثر اكتب: ماذا يوجد في قسم المشرف؟ أو اشرح قسم التحضير."
    ].join("\n");
  }

  directTopicAnswer(message, role) {
    const normalized = normalize(message);
    const isShortTopic = normalized.split(/\s+/).filter(Boolean).length <= 3;
    const asksAboutTopic = this.isKnowledgeQuestion(message) || isShortTopic;
    if (!asksAboutTopic) return "";
    const topicMap = [
      [["الاشتراك", "اشتراك", "الاشتراكات", "التفعيل", "الدفع", "طرق الدفع", "تم الدفع", "لم يتم الدفع", "اعادة تنشيط", "إعادة تنشيط", "تجديد", "الاسعار", "الأسعار", "السعر"], () => this.subscriptionOverviewAnswer()],
      [["الطلاب", "طالب", "قسم الطلاب"], () => this.sectionExplanation("students", role)],
      [["المواد", "مادة", "المادة", "قسم المواد"], () => this.sectionExplanation("subjects", role)],
      [["التحضير", "الحضور", "الحظور"], () => this.sectionExplanation("attendance", role)],
      [["الحصص", "الحصة", "جدول الحصص"], () => this.sectionExplanation("schedule", role)],
      [["الدرجات", "درجة", "المجموع"], () => this.sectionExplanation("grades", role)],
      [["الاعمدة", "الأعمدة", "عمود", "اعمدة"], () => this.sectionExplanation("columns", role)],
      [["الاحصائيات", "الإحصائيات", "التحليل"], () => this.sectionExplanation("stats", role)],
      [["الاعدادات", "الإعدادات", "كلمة سر", "الأرشيف", "الارشيف"], () => this.sectionExplanation("settings", role)],
      [["المشرف", "قسم المشرف"], () => this.roleExplanation("admin", role)],
      [["المعلم", "قسم المعلم"], () => this.roleExplanation("teacher", role)],
      [["المندوب", "قسم المندوب"], () => this.roleExplanation("delegate", role)],
      [["السلوك", "المخالفات", "المواظبة"], () => this.sectionExplanation("behavior", role)],
      [["التقارير", "تقرير"], () => this.sectionExplanation("reports", role)],
      [["اقسام التطبيق", "أقسام التطبيق", "اقسام النظام", "أقسام النظام"], () => this.appSectionsAnswer(role)]
    ];
    const match = topicMap.find(([words]) => words.some((word) => normalized.includes(normalize(word))));
    return match ? match[1]() : "";
  }

  subscriptionOverviewAnswer() {
    return [
      this.pricingAnswer(),
      "",
      this.subscriptionAnswer(this.app.services.license.getActiveLicense()),
      "",
      "طريقة التفعيل والاشتراك:",
      "1. اختر نوع المستخدم ونوع الاشتراك.",
      "2. افتح طرق الدفع واكتب الاسم الذي سيتم التحويل به.",
      "3. بعد الضغط على تم الدفع يظهر كود مؤقت ليوم واحد حتى يعتمد صاحب التطبيق الاشتراك.",
      "4. إذا بقي أقل من يوم على انتهاء الاشتراك سيظهر تنبيه لإعادة التفعيل من الإعدادات.",
      "5. إذا لم يصل الدفع يمكن لصاحب التطبيق اختيار: لم يتم الدفع، وسيظهر للمستخدم إشعار يوضح أن التجديد لم يتم.",
      "6. إذا حاول المستخدم الدفع مرة ثانية بعد تجربة غير مؤكدة ينتقل الطلب إلى تحقق من الدفع ولا يفتح التطبيق إلا بعد اعتماد صاحب التطبيق."
    ].join("\n");
  }

  appSectionsAnswer(role) {
    return [
      "📌 أقسام التطبيق الرئيسية:",
      "• الرئيسية: ملخص سريع واختصارات.",
      "• المواد: إنشاء المواد والفصول وربطها بالطلاب والمعلمين.",
      "• الطلاب: إضافة الطلاب، الأرقام، الملاحظات، الرسائل، والاستيراد.",
      "• التحضير: تسجيل حاضر/غائب/متأخر حسب اليوم والحصة.",
      "• الحصص: تنظيم الجهات والأيام والأوقات.",
      "• الدرجات: الأعمدة، المجموع، منح تحسين، والتصدير.",
      "• الإحصائيات: حضور، أداء، تحليل درجات، وطلاب يحتاجون متابعة.",
      "• الإعدادات: الثيم، كلمة السر، السنوات الدراسية، النسخ، والإشعارات.",
      role === "admin" ? "• قسم المشرف: إدارة الحسابات التابعة، التقارير، والسلوك والمواظبة." : "",
      "",
      `صلاحيتك الحالية: ${this.currentRoleLabel(role)}.`
    ].filter(Boolean).join("\n");
  }

  roleExplanation(targetRole, currentRole) {
    const answers = {
      admin: [
        "👥 المشرف:",
        "• ينشئ أكواد المعلمين والمندوبين.",
        "• يضيف الجهات والمواد والطلاب ويربط المعلمين بالمواد.",
        "• يراجع طلبات المعلمين.",
        "• يتابع السلوك والمواظبة والمخالفات.",
        "• يرى تقارير الحضور والأداء والتحصيل والدرجات.",
        "• يستطيع متابعة الحسابات التابعة حسب البيانات المتزامنة."
      ],
      teacher: [
        "👨‍🏫 المعلم:",
        "• يحضر الطلاب حسب الحصة واليوم.",
        "• يدخل الدرجات ويستخدم أعمدة الدرجات والمجموع.",
        "• يراجع طلاب فصله وملاحظاتهم.",
        "• يصدر كشوفات الحضور والدرجات PDF وExcel.",
        "• إذا كان تابعًا لمشرف فقد تختلف صلاحياته حسب ما حدده المشرف."
      ],
      delegate: [
        "🧑‍💼 المندوب:",
        "• مخصص غالبًا للتحضير السريع.",
        "• يتعامل مع الحصص والطلاب والمواد اللازمة للتحضير.",
        "• لا يركز على الدرجات أو الإحصائيات إلا إذا كانت صلاحياته تسمح بذلك.",
        "• إذا كان تابعًا لمشرف تظهر له الأدوات التي سمح بها المشرف فقط."
      ]
    };
    return [...answers[targetRole], "", `صلاحيتك الحالية: ${this.currentRoleLabel(currentRole)}.`].join("\n");
  }

  sectionExplanation(section, role) {
    const answers = {
      settings: [
        "⚙️ الإعدادات تحتوي على:",
        "• طريقة التحضير وحد الغياب.",
        "• الثيم: فاتح، داكن، أو النظام.",
        "• نوع التاريخ: هجري أو ميلادي.",
        "• الإشعارات والمساعد الذكي.",
        "• كلمة سر التطبيق وتغييرها أو إلغاؤها مع سؤال أمان لاستعادة الدخول.",
        "• إعادة تفعيل الكود عند قرب انتهاء الاشتراك أو تغيير نوع الاشتراك.",
        "• النسخ الاحتياطي وإدارة السنوات الدراسية والأرشيف.",
        "للوصول السريع اكتب في بحث الإعدادات: كلمة سر، الأرشيف، نسخة، أو سنة."
      ],
      students: [
        "👤 قسم الطلاب يحتوي على:",
        "• إضافة طالب أو استيراد الطلاب من Excel أو من نص.",
        "• حفظ رقم ولي الأمر والملاحظات لكل طالب.",
        "• منع تكرار الأسماء داخل نفس المادة.",
        "• إرسال واتساب أو SMS أو اتصال برقم ولي الأمر عند توفره.",
        "• فتح درجات الطالب وسجله وملاحظاته بسرعة.",
        "إذا كان الحساب تابعًا لمشرف فقد تتحول الإضافة أو الحذف إلى طلب يراجعه المشرف."
      ],
      subjects: [
        "📚 قسم المواد يعرض المواد أو الفصول.",
        "يمكن منه إضافة مادة، البحث، ترتيب المواد، فتح الطلاب والتحضير والدرجات والكشف والإحصائيات.",
        "إذا كان الحساب تابعًا فقد تظهر المواد التي ربطها المشرف بهذا الحساب فقط."
      ],
      attendance: [
        "✅ قسم التحضير يستخدم لتسجيل حاضر، غائب، أو متأخر.",
        "يرتبط التحضير باليوم والحصة المختارة، لذلك لو عندك أكثر من حصة في اليوم يتم حفظ كل حصة بشكل مستقل.",
        "بعد الحفظ يظهر التحضير في الكشف الشهري حسب الحصة."
      ],
      schedule: [
        "🗓️ قسم الحصص ينظم الجهات وأوقات الحصص.",
        "تحدد الجهة، المادة، اليوم، الوقت، والقاعة.",
        "التحضير والكشف يعتمدون على هذه الحصص حتى يعرف النظام أي حصة يتم تحضيرها."
      ],
      stats: [
        "📊 قسم الإحصائيات يعرض التحليل بدل الأرقام الخام.",
        "فيه الحضور، التأخير، أفضل الطلاب حضورًا، الرسوب، توزيع الدرجات، تحليل الأعمدة، والطلاب المعرضون للخطر.",
        "إذا كان السؤال واسعًا اكتب مثلًا: اشرح الرسوب، أو تحليل عمود السلوك."
      ],
      grades: [
        "🧮 قسم الدرجات يحتوي على أعمدة ديناميكية مثل الشفوي، الشهري، الواجب، السلوك، والنهائي.",
        "المجموع يحسب تلقائيًا، ولا يسمح بإدخال درجة أكبر من الدرجة العظمى.",
        "ميزة منح تحسين تضيف درجات للطلاب دون تجاوز الدرجة العظمى."
      ],
      columns: [
        "🧩 أعمدة الدرجات هي طريقة تخصيص توزيع الدرجات.",
        "يمكن إنشاء أعمدة مثل: الشهري، الشفوي، الواجب، السلوك، العملي، النهائي.",
        "لكل عمود درجة عظمى، والنظام يمنع إدخال درجة أعلى منها.",
        "يمكن تعديل الاسم، حذف العمود، ترتيبه، أو منحه صلاحية للمعلم التابع حسب إعدادات المشرف."
      ],
      behavior: [
        "⚖️ السلوك والمواظبة خاص بالمشرف.",
        "يسجل مخالفة الطالب مع الجهة والمادة والمعلم والطالب ودرجة المخالفة والإجراء.",
        "يمكن ربط الحسم بعمود السلوك ليظهر الخصم في سجل الطالب وملف PDF."
      ],
      reports: [
        "📑 تقارير المشرف تشمل:",
        "• الحضور والغياب.",
        "• أداء المعلمين.",
        "• التحصيل الدراسي.",
        "• الطلاب المعرضين للخطر.",
        "• السلوك والمواظبة.",
        "• الحصص والدرجات والتقرير اليومي والشهري والمقارنة.",
        "يمكن تصدير تقرير شامل أو تقرير منفصل PDF."
      ]
    };
    const answer = answers[section] || ["لم أجد شرحًا محددًا لهذا القسم."];
    return [...answer, "", `صلاحيتك الحالية: ${this.currentRoleLabel(role)}.`].join("\n");
  }

  featureExplanation(feature) {
    if (feature === "gradeBoost") {
      return [
        "✨ فكرة منح تحسين:",
        "هي أداة في قسم الدرجات تضيف مقدارًا محددًا من الدرجات للطلاب بشكل جماعي.",
        "",
        "كيف تعمل؟",
        "1. تختار مقدار التحسين، مثل درجتين.",
        "2. تختار عمودًا مثل السلوك أو الواجب.",
        "3. النظام يضيف الدرجة دون تجاوز الدرجة العظمى.",
        "4. إذا كان الطالب حاصلًا على الدرجة الكاملة في العمود، يمكن ترحيل الزيادة لعمود آخر ناقص بعد موافقة المعلم.",
        "",
        "الفائدة: تحسين جماعي منظم بدون أخطاء في المجموع أو تجاوز الحد الأعلى."
      ].join("\n");
    }
    return "";
  }

  openPage(pageName, subject = null) {
    const targetSubject = subject || this.context.lastSubject || this.app.services.store.getSubjects(null, this.app.services.license.getActiveLicense())[0];
    const subjectTarget = targetSubject ? `#/subject/${targetSubject.id}` : "";
    const routes = {
      home: "#/home",
      subjects: "#/subjects",
      students: subjectTarget ? `${subjectTarget}/students` : "#/students",
      attendance: subjectTarget ? `${subjectTarget}/attendance` : "#/attendance",
      sheet: subjectTarget ? `${subjectTarget}/sheet` : "#/attendance",
      grades: subjectTarget ? `${subjectTarget}/grades` : "#/grades",
      stats: subjectTarget ? `${subjectTarget}/stats` : "#/analytics",
      schedule: "#/schedule",
      settings: "#/settings",
      manager: "#/manager/manage",
      behavior: "#/manager/behavior",
      reports: "#/manager/reports"
    };
    if (pageName === "manager" || pageName === "behavior" || pageName === "reports") {
      const license = this.app.services.license.getActiveLicense();
      if (license?.accessMode !== "admin") return "لا تملك صلاحية الوصول إلى قسم المشرف.";
    }
    location.hash = routes[pageName] || "#/home";
    return `تم فتح ${pageLabel(pageName)}${targetSubject && ["students", "attendance", "sheet", "grades", "stats"].includes(pageName) ? ` لمادة ${targetSubject.name}` : ""}.`;
  }

  addStudent(subject = null) {
    const targetSubject = subject || this.context.lastSubject || this.app.services.store.getSubjects(null, this.app.services.license.getActiveLicense())[0];
    if (!targetSubject) return "لا توجد مادة لإضافة الطالب إليها. أضف مادة أولًا.";
    this.context.lastSubject = targetSubject;
    location.hash = `#/subject/${targetSubject.id}/students`;
    setTimeout(() => this.app.pages.subject?.openStudentModal?.(), 180);
    return `تم فتح نافذة إضافة طالب في مادة ${targetSubject.name}.`;
  }

  addSubject() {
    location.hash = "#/subjects";
    setTimeout(() => this.app.pages.home?.openSubjectModal?.(), 180);
    return "تم فتح نافذة إضافة مادة.";
  }

  async deleteStudent(found) {
    if (!found) return "حدد اسم الطالب الذي تريد حذفه حتى لا أحذف بالخطأ.";
    const ok = await this.app.services.modal.confirm({
      title: "تأكيد حذف الطالب",
      message: `هل تريد حذف الطالب ${found.student.name} من مادة ${found.subject.name}؟`,
      confirmLabel: "حذف",
      cancelLabel: "إلغاء",
      danger: true
    });
    if (!ok) return "تم إلغاء حذف الطالب.";
    await this.app.services.store.deleteStudent(found.subject.id, found.student.id);
    return `تم حذف الطالب ${found.student.name} من مادة ${found.subject.name}.`;
  }

  async deleteSubject(subject) {
    if (!subject) return "حدد اسم المادة التي تريد حذفها حتى لا أحذف بالخطأ.";
    const ok = await this.app.services.modal.confirm({
      title: "تأكيد حذف المادة",
      message: `هل تريد حذف مادة ${subject.name}؟ سيتم حذف طلابها ودرجاتها وكشوفها.`,
      confirmLabel: "حذف",
      cancelLabel: "إلغاء",
      danger: true
    });
    if (!ok) return "تم إلغاء حذف المادة.";
    await this.app.services.store.deleteSubject(subject.id);
    return `تم حذف مادة ${subject.name}.`;
  }

  navigationRequest(message) {
    const subject = this.findSubjectFromMessage(message);
    const target = subject ? `#/subject/${subject.id}` : "";
    if (message.includes("افتح") || message.includes("اعرض") || message.includes("اذهب")) {
      if (message.includes("درجات") || message.includes("الدرجات")) {
        location.hash = subject ? `${target}/grades` : "#/grades";
        return subject ? `تم فتح درجات مادة ${subject.name}.` : "تم فتح قسم الدرجات. اختر المادة المطلوبة.";
      }
      if (message.includes("تحضير") || message.includes("الحضور")) {
        location.hash = subject ? `${target}/attendance` : "#/attendance";
        return subject ? `تم فتح تحضير مادة ${subject.name}.` : "تم فتح قسم التحضير.";
      }
      if (message.includes("كشف") || message.includes("كشوف")) {
        location.hash = subject ? `${target}/sheet` : "#/attendance";
        return subject ? `تم فتح كشف حضور مادة ${subject.name}.` : "تم فتح قسم الكشوفات من التحضير.";
      }
      if (message.includes("حصص") || message.includes("الحصة")) {
        location.hash = "#/schedule";
        return "تم فتح قسم الحصص.";
      }
      if (message.includes("احصائيات") || message.includes("الإحصائيات")) {
        location.hash = subject ? `${target}/stats` : "#/analytics";
        return subject ? `تم فتح إحصائيات مادة ${subject.name}.` : "تم فتح قسم الإحصائيات.";
      }
      if (message.includes("المشرف") || message.includes("كود")) {
        const license = this.app.services.license.getActiveLicense();
        if (license?.accessMode !== "admin") return "لا تملك صلاحية الوصول إلى قسم المشرف.";
        location.hash = "#/manager/manage";
        return "تم فتح إدارة المعلمين والمندوبين.";
      }
      if (message.includes("اعدادات") || message.includes("الإعدادات")) {
        location.hash = "#/settings";
        return "تم فتح الإعدادات.";
      }
    }
    return "";
  }

  studentInfoAnswer(found) {
    const { student, subject } = found;
    const columns = this.app.services.store.getGradeColumns(subject.id);
    const grades = this.getGrades(found);
    const max = columns.reduce((sum, column) => sum + Number(column.max || 0), 0);
    const entered = columns.some((column) => Object.hasOwn(grades, column.id));
    const total = columns.reduce((sum, column) => sum + Number(grades[column.id] || 0), 0);
    const history = this.getAttendance(found).history;
    const lastAttendance = history[0] ? `${statusLabel(history[0].status)} في ${history[0].date}` : "لا يوجد سجل حضور بعد";
    return [
      `👤 معلومات الطالب: ${student.name}`,
      `📚 المادة: ${subject.name}`,
      `📊 الغياب: ${student.absenceCount || 0}، التأخير: ${student.lateCount || 0}`,
      `✅ آخر حضور: ${lastAttendance}`,
      entered ? `📈 المجموع: ${total} / ${max}` : "📈 الدرجات: لم يتم إدخال درجات بعد",
      student.notes ? `ملاحظة: ${student.notes}` : ""
    ].filter(Boolean).join("\n");
  }

  attendanceAnswer(found) {
    const attendance = this.getAttendance(found);
    const recent = attendance.history.slice(0, 5).map((item) => `${item.date}: ${statusLabel(item.status)}`).join("\n");
    return [
      `📊 حضور ${found.student.name}:`,
      `الغياب: ${attendance.absent}`,
      `التأخير: ${attendance.late}`,
      `الحضور المسجل: ${attendance.present}`,
      recent ? `آخر السجلات:\n${recent}` : "لا يوجد سجل تفصيلي بعد."
    ].join("\n");
  }

  gradesAnswer(found) {
    const { student, subject } = found;
    const columns = this.app.services.store.getGradeColumns(subject.id);
    const grades = this.getGrades(found);
    if (!columns.length) return `لا توجد أعمدة درجات في مادة ${subject.name}.`;
    const hasGrades = columns.some((column) => Object.hasOwn(grades, column.id));
    if (!hasGrades) return `لم يتم إدخال درجات للطالب ${student.name} في مادة ${subject.name} بعد.`;
    const lines = columns.map((column) => `${column.label}: ${Number(grades[column.id] || 0)} / ${column.max}`);
    const total = columns.reduce((sum, column) => sum + Number(grades[column.id] || 0), 0);
    const max = columns.reduce((sum, column) => sum + Number(column.max || 0), 0);
    return `📊 درجات ${student.name} - ${subject.name}:\n${lines.join("\n")}\nالمجموع: ${total} / ${max}`;
  }

  studentColumnGradeAnswer(found, message, selectedColumn = null) {
    const { student, subject } = found;
    const columns = this.app.services.store.getGradeColumns(subject.id);
    const grades = this.app.services.store.getGrades(subject.id, student.id);
    const column = selectedColumn || columns.find((item) => message.includes(normalize(item.label))) || columns.find((item) => normalize(item.label).split(" ").some((part) => part && message.includes(part)));
    if (!column) return `لم أجد عمود الدرجة المطلوب للطالب ${student.name}.`;
    const value = grades[column.id];
    return value === undefined
      ? `لم يتم إدخال درجة ${column.label} للطالب ${student.name} في مادة ${subject.name} بعد.`
      : `حصل الطالب ${student.name} في ${column.label} على ${value} من ${column.max} في مادة ${subject.name}.`;
  }

  failureReasonAnswer(found) {
    const { student, subject } = found;
    const columns = this.app.services.store.getGradeColumns(subject.id);
    const grades = this.app.services.store.getGrades(subject.id, student.id);
    const hasGrades = columns.some((column) => Object.hasOwn(grades, column.id));
    if (!hasGrades) return `الطالب ${student.name} لا يظهر راسبًا لأن الدرجات لم تُدخل بعد.`;
    const max = columns.reduce((sum, column) => sum + Number(column.max || 0), 0);
    const total = columns.reduce((sum, column) => sum + Number(grades[column.id] || 0), 0);
    const pass = max * 0.5;
    if (total >= pass) return `الطالب ${student.name} ليس راسبًا حاليًا. مجموعه ${total} من ${max}.`;
    const weak = columns
      .map((column) => ({ label: column.label, value: Number(grades[column.id] || 0), max: Number(column.max || 0) }))
      .filter((item) => item.max && item.value < item.max / 2)
      .map((item) => `${item.label}: ${item.value}/${item.max}`);
    return `الطالب ${student.name} راسب لأن مجموعه ${total} من ${max}، والحد الأدنى المتوقع ${Math.ceil(pass)}.\nأضعف الأعمدة: ${weak.length ? weak.join("، ") : "لا توجد تفاصيل كافية"}.`;
  }

  mostAbsentAnswer(institution = null) {
    const rows = this.getStudents({ institution })
      .filter((row) => Number(row.student.absenceCount || 0) > 0)
      .sort((a, b) => b.student.absenceCount - a.student.absenceCount)
      .slice(0, 5);
    if (!rows.length) return "لا يوجد طلاب لديهم غياب حاليًا.";
    return `📊 الطلاب الأكثر غيابًا:\n${rows.map((row, index) => `${index + 1}. ${row.student.name} - ${row.student.absenceCount} غياب - ${row.subject.name}`).join("\n")}`;
  }

  mostLateAnswer(institution = null) {
    const rows = this.getStudents({ institution })
      .filter((row) => Number(row.student.lateCount || 0) > 0)
      .sort((a, b) => b.student.lateCount - a.student.lateCount)
      .slice(0, 5);
    if (!rows.length) return "لا يوجد طلاب لديهم تأخير حاليًا.";
    return `⏰ الطلاب الأكثر تأخيرًا:\n${rows.map((row, index) => `${index + 1}. ${row.student.name} - ${row.student.lateCount} تأخير - ${row.subject.name}`).join("\n")}`;
  }

  riskAnswer(institution = null) {
    const rows = this.getAtRiskStudents(institution);
    const limit = Number(this.app.services.store.getSettings().absenceLimit || 6);
    if (!rows.length) return `لا يوجد طلاب تجاوزوا حد الغياب الحالي (${limit}).`;
    return `⚠️ الطلاب الذين يحتاجون متابعة:\n${rows.map((row) => `${row.student.name}: ${row.student.absenceCount} غياب في ${row.subject.name}`).join("\n")}`;
  }

  topStudentsAnswer(institution = null) {
    const rows = this.getTopStudents(institution);
    if (!rows.length) return "لا توجد درجات كافية لترتيب الطلاب حتى الآن.";
    return `🏆 أعلى الطلاب حسب المجموع:\n${rows.map((row, index) => `${index + 1}. ${row.student.name} - ${row.total}/${row.max} - ${row.subject.name}`).join("\n")}`;
  }

  subjectStatsAnswer(subject = null) {
    const targetSubject = subject || this.context.lastSubject;
    if (!targetSubject) return "حدد اسم المادة حتى أعرض إحصائياتها.";
    const stats = this.getSubjectStats(targetSubject);
    return [
      `📚 إحصائيات مادة ${targetSubject.name}:`,
      `عدد الطلاب: ${stats.studentsCount}`,
      `نسبة الحضور: ${stats.attendanceRate}%`,
      `متوسط الدرجات: ${stats.averageGrade || "لم تدخل درجات"}`,
      `الغياب الكلي: ${stats.absences}`,
      `التأخير الكلي: ${stats.lates}`
    ].join("\n");
  }

  studentsListAnswer(subject = null, institution = null) {
    const rows = this.getStudents({ subject, institution }).slice(0, 12);
    if (!rows.length) return "لا يوجد طلاب مطابقون في البيانات الحالية.";
    return `👥 قائمة الطلاب:\n${rows.map((row, index) => `${index + 1}. ${row.student.name} - ${row.subject.name}`).join("\n")}${rows.length === 12 ? "\nاكتب اسم طالب محدد لعرض تفاصيل أكثر." : ""}`;
  }

  subjectsCountAnswer(institution = null) {
    const license = this.app.services.license.getActiveLicense();
    const subjects = this.app.services.store.getSubjects(null, license)
      .filter((subject) => !institution || subject.institutionId === institution.id);
    if (!subjects.length) return institution ? `لا توجد مواد في ${institution.name} حتى الآن.` : "لا توجد مواد مضافة حتى الآن.";
    const studentsCount = subjects.reduce((sum, subject) => sum + Number(subject.studentsCount || this.app.services.store.getStudents(subject.id).length), 0);
    const top = subjects.slice(0, 5).map((subject, index) => `${index + 1}. ${subject.name} - ${subject.studentsCount || 0} طالب`).join("\n");
    return [
      `📚 عدد المواد${institution ? ` في ${institution.name}` : ""}: ${subjects.length}`,
      `👥 إجمالي الطلاب داخلها: ${studentsCount}`,
      top ? `أول المواد:\n${top}` : ""
    ].filter(Boolean).join("\n");
  }

  studentsCountAnswer(subject = null, institution = null) {
    const rows = this.getStudents({ subject, institution });
    if (subject) return `👥 عدد الطلاب في مادة ${subject.name}: ${rows.length}.`;
    if (institution) return `👥 عدد الطلاب في ${institution.name}: ${rows.length}.`;
    return `👥 عدد الطلاب المسجلين في المواد الحالية: ${rows.length}.`;
  }

  institutionsCountAnswer() {
    const license = this.app.services.license.getActiveLicense();
    const institutions = this.app.services.store.getInstitutions(license);
    if (!institutions.length) return "لا توجد جهات مضافة حتى الآن.";
    return `🏫 عدد الجهات: ${institutions.length}\n${institutions.map((item, index) => `${index + 1}. ${item.name}`).join("\n")}`;
  }

  lessonsCountAnswer(institution = null) {
    const license = this.app.services.license.getActiveLicense();
    const lessons = this.app.services.store.getSchedule(null, license)
      .filter((lesson) => !institution || lesson.institutionId === institution.id);
    if (!lessons.length) return institution ? `لا توجد حصص في ${institution.name} حتى الآن.` : "لا توجد حصص مضافة حتى الآن.";
    const days = new Map();
    lessons.forEach((lesson) => days.set(lesson.day, (days.get(lesson.day) || 0) + 1));
    return `🗓️ عدد الحصص${institution ? ` في ${institution.name}` : ""}: ${lessons.length}\n${[...days.entries()].map(([day, count]) => `${day}: ${count}`).join("\n")}`;
  }

  systemSummaryAnswer(institution = null) {
    const license = this.app.services.license.getActiveLicense();
    const subjects = this.app.services.store.getSubjects(null, license).filter((subject) => !institution || subject.institutionId === institution.id);
    const students = subjects.flatMap((subject) => this.app.services.store.getStudents(subject.id));
    const lessons = this.app.services.store.getSchedule(null, license).filter((lesson) => !institution || lesson.institutionId === institution.id);
    return [
      `📊 ملخص${institution ? ` ${institution.name}` : " التطبيق"}:`,
      `المواد: ${subjects.length}`,
      `الطلاب: ${students.length}`,
      `الحصص: ${lessons.length}`,
      `نسبة الحضور العامة: ${subjects.length ? Math.round(subjects.reduce((sum, subject) => sum + Number(subject.attendanceRate || 0), 0) / subjects.length) : 0}%`
    ].join("\n");
  }

  nextLessonAnswer() {
    const license = this.app.services.license.getActiveLicense();
    const lessons = this.app.services.store.getSchedule(null, license);
    if (!lessons.length) return "لا توجد حصص مضافة في جدول الحصص.";
    const now = new Date();
    const todayName = ARABIC_DAYS[now.getDay()];
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const todayLessons = lessons.filter((lesson) => lesson.day === todayName && timeToMinutes(lesson.start) >= currentMinutes);
    const lesson = todayLessons[0] || lessons.find((item) => item.day !== todayName) || lessons[0];
    const subject = this.app.services.store.getSubject(lesson.subjectId, license);
    return `الحصة القادمة: ${subject?.name || "مادة غير محددة"}\nاليوم: ${lesson.day}\nالوقت: ${lesson.start} - ${lesson.end}\nالقاعة: ${lesson.room || subject?.room || "غير محددة"}`;
  }

  pricingAnswer() {
    const pricing = this.app.services.license.getActivationPricing();
    const currency = pricing.currency || "SAR";
    const label = currency === "YER" ? "ريال يمني" : "ريال سعودي";
    const teacherWeek = this.app.services.license.calculateActivationPrice("teacher", "week", 0, currency);
    const teacherMonth = this.app.services.license.calculateActivationPrice("teacher", "month", 0, currency);
    const teacherYear = this.app.services.license.calculateActivationPrice("teacher", "year", 0, currency);
    const delegateWeek = this.app.services.license.calculateActivationPrice("delegate", "week", 0, currency);
    const delegateMonth = this.app.services.license.calculateActivationPrice("delegate", "month", 0, currency);
    const delegateYear = this.app.services.license.calculateActivationPrice("delegate", "year", 0, currency);
    const adminMonth = this.app.services.license.calculateActivationPrice("admin", "month", 0, currency);
    const adminYear = this.app.services.license.calculateActivationPrice("admin", "year", 0, currency);
    const adminMonthWithTeacher = this.app.services.license.calculateActivationPrice("admin", "month", 1, currency);
    const adminYearWithTeacher = this.app.services.license.calculateActivationPrice("admin", "year", 1, currency);
    const extraMonth = Math.max(0, adminMonthWithTeacher.displayAmount - adminMonth.displayAmount);
    const extraYear = Math.max(0, adminYearWithTeacher.displayAmount - adminYear.displayAmount);
    return [
      "📌 أسعار الاشتراك الحالية:",
      "",
      "👨‍🏫 المعلم:",
      `• أسبوع: ${teacherWeek.displayAmount} ${label}`,
      `• شهر: ${teacherMonth.displayAmount} ${label}`,
      `• سنة: ${teacherYear.displayAmount} ${label}`,
      "",
      "👥 المشرف:",
      `• شهر: ${adminMonth.displayAmount} ${label}`,
      `• سنة: ${adminYear.displayAmount} ${label}`,
      `• كل معلم تابع إضافي: ${extraMonth} ${label} شهريًا / ${extraYear} ${label} سنويًا`,
      "",
      "🧑‍💼 المندوب:",
      `• أسبوع: ${delegateWeek.displayAmount} ${label}`,
      `• شهر: ${delegateMonth.displayAmount} ${label}`,
      `• سنة: ${delegateYear.displayAmount} ${label}`
    ].join("\n");
  }

  subscriptionAnswer(license) {
    if (!license) return "🔐 لا يوجد تفعيل نشط حاليًا. افتح صفحة التفعيل وأدخل كودًا صالحًا للمتابعة.";
    const expiresAt = license.expiresAt ? new Date(license.expiresAt) : null;
    const remainingDays = expiresAt ? Math.ceil((expiresAt - new Date()) / 86400000) : null;
    const role = license.accessMode === "admin" ? "مشرف" : license.accessMode === "delegate" ? "مندوب" : "معلم";
    return [
      "🔐 حالة التفعيل:",
      `نوع الحساب: ${role}`,
      expiresAt ? `ينتهي في: ${new Intl.DateTimeFormat("ar-SA", { dateStyle: "medium" }).format(expiresAt)}` : "تاريخ الانتهاء: غير محدد",
      remainingDays !== null ? `المدة المتبقية تقريبًا: ${Math.max(0, remainingDays)} يوم` : "",
      license.code ? `الكود الحالي: ${license.code}` : ""
    ].filter(Boolean).join("\n");
  }

  permissionsAnswer(role, license) {
    const permissions = license?.permissions || {};
    if (role === "admin") {
      return "🛡️ صلاحيتك الحالية: مشرف\nيمكنك إدارة المواد والطلاب والحصص والمعلمين والمندوبين والسلوك والمواظبة والإحصائيات العامة.";
    }
    if (role === "delegate") {
      return "🛡️ صلاحيتك الحالية: مندوب\nيمكنك التعامل مع التحضير والحصص والطلاب حسب ما يسمح به الكود. لا تظهر لك الدرجات أو الإحصائيات إلا إذا منحك المشرف صلاحية إضافية.";
    }
    const enabled = Object.entries(permissions).filter(([, value]) => value !== false).map(([key]) => key);
    return [
      "🛡️ صلاحيتك الحالية: معلم",
      enabled.length ? `الأقسام المسموحة: ${enabled.join("، ")}` : "لديك صلاحيات المعلم الافتراضية.",
      "إذا كنت تابعًا لمشرف فالصلاحيات قد تتغير حسب إعدادات المشرف."
    ].join("\n");
  }

  behaviorViolationsAnswer(found = null, institution = null) {
    const rows = this.app.services.store.getBehaviorViolations?.() || [];
    const filtered = rows.filter((row) => {
      if (found && row.studentId && row.studentId !== found.student.id) return false;
      if (found && !row.studentId && normalize(row.studentName) !== normalize(found.student.name)) return false;
      if (institution && row.institutionId && row.institutionId !== institution.id) return false;
      return true;
    });
    if (!filtered.length) {
      return found
        ? `لا توجد مخالفات مسجلة على الطالب ${found.student.name}.`
        : "لا توجد مخالفات مسجلة حاليًا.";
    }
    const grouped = filtered.slice(0, 6).map((row, index) => {
      const degree = row.degree ? `درجة ${row.degree}` : "درجة غير محددة";
      const place = [row.institutionName, row.subjectName, row.teacherName].filter(Boolean).join(" - ");
      return `${index + 1}. ${row.studentName} - ${degree}\n${row.violationType || "مخالفة غير محددة"}${place ? `\n${place}` : ""}`;
    }).join("\n");
    return [
      found ? `⚖️ مخالفات الطالب ${found.student.name}: ${filtered.length}` : `⚖️ عدد المخالفات المسجلة: ${filtered.length}`,
      grouped,
      filtered.length > 6 ? "اكتب اسم الطالب لعرض تفاصيله فقط." : ""
    ].filter(Boolean).join("\n");
  }

  guardianContactAnswer(found) {
    const phone = found.student.guardianPhone || found.student.phone || "";
    if (!phone) return `لا يوجد رقم ولي أمر مسجل للطالب ${found.student.name}.`;
    return [
      `📞 بيانات التواصل للطالب ${found.student.name}:`,
      `ولي الأمر: ${phone}`,
      `المادة: ${found.subject.name}`,
      "يمكنك استخدام أزرار الاتصال أو SMS أو واتساب من بطاقة الطالب."
    ].join("\n");
  }

  studentRequestsAnswer(role) {
    if (role !== "admin") return "طلبات الإضافة والحذف تظهر للمشرف فقط. إذا كنت معلمًا تابعًا يمكنك إرسال الطلب من بطاقة الطالب.";
    const subjects = this.app.services.store.getSubjects(null, this.app.services.license.getActiveLicense());
    const requests = subjects.flatMap((subject) => this.app.services.store.getStudentRequests(subject.id).map((request) => ({ ...request, subject })));
    const pending = requests.filter((request) => request.status === "pending");
    if (!requests.length) return "لا توجد طلبات معلمين حاليًا.";
    return [
      `📨 طلبات المعلمين: ${requests.length}`,
      `بانتظار المراجعة: ${pending.length}`,
      pending.slice(0, 5).map((request, index) => `${index + 1}. ${request.requestedBy || "معلم"} - ${request.type === "delete" ? "حذف" : request.type === "edit" ? "تعديل" : "إضافة"} ${request.studentName} - ${request.subject.name}`).join("\n")
    ].filter(Boolean).join("\n");
  }

  smartFallbackAnswer(message, role) {
    if (hasAny(message, ["أسعار", "اسعار", "سعر", "بكم", "تكلفة", "تكلفه", "الباقة", "الباقه", "كم الاشتراك", "كم اشتراك", "سعر الاشتراك", "الاشترك", "اشتراكات"])) return this.pricingAnswer();
    if (hasAny(message, ["مادة", "مواد", "مقرر", "مقررات"])) return this.subjectsCountAnswer(this.context.lastInstitution);
    if (hasAny(message, ["طالب", "طلاب"])) return this.studentsCountAnswer(this.context.lastSubject, this.context.lastInstitution);
    if (hasAny(message, ["حصة", "حصص", "جدول"])) return this.lessonsCountAnswer(this.context.lastInstitution);
    if (hasAny(message, ["اشتراك", "تفعيل", "كود", "صلاحية"])) return this.subscriptionAnswer(this.app.services.license.getActiveLicense());
    if (hasAny(message, ["مخالفة", "مخالفات", "سلوك", "مواظبة"])) return this.behaviorViolationsAnswer(this.context.lastStudent ? this.studentFromMemory("معلوماته") : null, this.context.lastInstitution);
    if (hasAny(message, ["تقرير", "تقارير", "التقارير", "تقرير شامل", "تقرير منفصل"])) {
      return "📑 التقارير متاحة من قسم المشرف > التقارير. يمكن عرض ملخصات الحضور، أداء المعلمين، التحصيل، السلوك، الحصص، الدرجات، والتصدير PDF شامل أو منفصل.";
    }
    if (hasAny(message, ["سنة", "سنوات", "الأرشيف", "ارشيف", "أرشفة", "ارشفه", "نقل البيانات", "سنة دراسية"])) {
      return "🗓️ إدارة السنوات الدراسية موجودة في الإعدادات. استخدمها لبدء سنة جديدة، أرشفة السنة الحالية، عرض الأرشيف، أو نقل البيانات بعد المعاينة.";
    }
    if (hasAny(message, ["كلمة سر", "كلمه سر", "قفل التطبيق", "نسيت كلمة السر"])) {
      return "🔐 كلمة السر موجودة في الإعدادات.\nافتح الإعدادات ثم استخدم البحث واكتب: كلمة سر.\nمن هناك يمكنك تفعيل القفل، تغيير كلمة السر، أو إلغاؤها.";
    }
    if (hasAny(message, ["اعدادات", "إعدادات", "ثيم", "داكن", "هجري", "ميلادي"])) {
      return "⚙️ الإعدادات تتحكم في الثيم، نوع التاريخ، طريقة التحضير، التنبيهات، كلمة السر، المساعد الذكي، النسخ الاحتياطي، والسنوات الدراسية. اكتب: افتح الإعدادات للانتقال مباشرة.";
    }
    if (role === "delegate" && hasAny(message, ["درجات", "احصائيات", "إحصائيات"])) {
      return "هذه المعلومة غالبًا خارج صلاحية المندوب. المندوب يركز على التحضير والحصص والطلاب حسب الصلاحية.";
    }
    return "فهمت أن سؤالك متعلق بالتطبيق، لكن أحتاج تفصيلًا أكثر حتى أجيب من البيانات بدون تخمين.\nاكتب مثلًا: كم يوجد مواد؟ من أكثر الطلاب غيابًا؟ معلومات عن الطالب أمين؟ افتح التحضير؟";
  }

  getStudent(name, institution = null, subject = null) {
    const normalizedName = normalize(name);
    const rows = this.getStudents({ institution, subject });
    return rows.find((row) => normalize(row.student.name) === normalizedName)
      || rows.find((row) => normalize(row.student.name).includes(normalizedName))
      || rows.find((row) => normalizedName.includes(normalize(row.student.name)));
  }

  getStudents({ institution = null, subject = null } = {}) {
    const license = this.app.services.license.getActiveLicense();
    const subjects = subject ? [subject] : this.app.services.store.getSubjects(null, license)
      .filter((item) => !institution || item.institutionId === institution.id);
    return subjects.flatMap((item) => this.app.services.store.getStudents(item.id).map((student) => ({ subject: item, student })));
  }

  getAttendance(found) {
    const history = this.app.services.store.getStudentAttendanceHistory(found.subject.id, found.student.id);
    return {
      history,
      absent: Number(found.student.absenceCount || 0),
      late: Number(found.student.lateCount || 0),
      present: history.filter((item) => item.status === "present").length
    };
  }

  getGrades(found) {
    return this.app.services.store.getGrades(found.subject.id, found.student.id);
  }

  getTopStudents(institution = null) {
    return this.getStudents({ institution })
      .map((row) => {
        const columns = this.app.services.store.getGradeColumns(row.subject.id);
        const grades = this.getGrades(row);
        const hasGrades = columns.some((column) => Object.hasOwn(grades, column.id));
        const total = columns.reduce((sum, column) => sum + Number(grades[column.id] || 0), 0);
        const max = columns.reduce((sum, column) => sum + Number(column.max || 0), 0);
        return { ...row, hasGrades, total, max };
      })
      .filter((row) => row.hasGrades && row.max > 0)
      .sort((a, b) => (b.total / b.max) - (a.total / a.max))
      .slice(0, 8);
  }

  getAtRiskStudents(institution = null) {
    const limit = Number(this.app.services.store.getSettings().absenceLimit || 6);
    return this.getStudents({ institution })
      .filter((row) => Number(row.student.absenceCount || 0) >= limit)
      .sort((a, b) => b.student.absenceCount - a.student.absenceCount)
      .slice(0, 8);
  }

  getSubjectStats(subject) {
    const students = this.app.services.store.getStudents(subject.id);
    const columns = this.app.services.store.getGradeColumns(subject.id);
    const max = columns.reduce((sum, column) => sum + Number(column.max || 0), 0);
    const totals = students.map((student) => {
      const grades = this.app.services.store.getGrades(subject.id, student.id);
      const hasGrades = columns.some((column) => Object.hasOwn(grades, column.id));
      return hasGrades ? columns.reduce((sum, column) => sum + Number(grades[column.id] || 0), 0) : null;
    }).filter((value) => value !== null);
    const average = totals.length && max ? `${Math.round(totals.reduce((sum, value) => sum + value, 0) / totals.length)} / ${max}` : "";
    return {
      studentsCount: students.length,
      attendanceRate: this.app.services.store.getAttendanceRate(subject.id),
      averageGrade: average,
      absences: students.reduce((sum, student) => sum + Number(student.absenceCount || 0), 0),
      lates: students.reduce((sum, student) => sum + Number(student.lateCount || 0), 0)
    };
  }

  findStudentFromMessage(message, institution = null, subject = null) {
    return this.findStudentsFromMessage(message, institution, subject)[0] || null;
  }

  findStudentsFromMessage(message, institution = null, subject = null) {
    const rows = this.getStudents({ institution, subject });
    return rankEntityMatches(message, rows, (row) => row.student.name).filter((item) => item.score >= 0.58).map((item) => item.entity);
  }

  studentFromMemory(message) {
    const isFollowUp = ["كم غاب", "غيابه", "غياب", "درجاته", "درجته", "كم حصل", "راسب", "لماذا", "معلوماته", "بياناته"].some((word) => message.includes(word));
    if (!isFollowUp || !this.context.lastStudent) return null;
    const subject = this.app.services.store.getSubject(this.context.lastStudent.subjectId, this.app.services.license.getActiveLicense());
    const student = subject ? this.app.services.store.getStudents(subject.id).find((item) => item.id === this.context.lastStudent.studentId) : null;
    return subject && student ? { subject, student } : null;
  }

  findSubjectFromMessage(message) {
    return this.findSubjectsFromMessage(message)[0] || null;
  }

  findSubjectsFromMessage(message, institution = null) {
    const license = this.app.services.license.getActiveLicense();
    const subjects = this.app.services.store.getSubjects(null, license)
      .filter((subject) => !institution || subject.institutionId === institution.id);
    return rankEntityMatches(message, subjects, (subject) => `${subject.name} ${subject.code || ""}`).filter((item) => item.score >= 0.6).map((item) => item.entity);
  }

  findGradeColumnFromMessage(message, subject = null) {
    const subjects = subject ? [subject] : this.context.lastSubject ? [this.context.lastSubject] : this.app.services.store.getSubjects(null, this.app.services.license.getActiveLicense());
    const columns = subjects.flatMap((item) => this.app.services.store.getGradeColumns(item.id).map((column) => ({ ...column, subjectId: item.id })));
    const ranked = rankEntityMatches(message, columns, (column) => column.label).filter((item) => item.score >= 0.62);
    return ranked[0]?.entity || this.context.lastGradeColumn || null;
  }

  extractPageName(message) {
    const actionWord = message.includes("افتح") || message.includes("اذهب") || message.includes("اعرض") || message.includes("روح");
    if (!actionWord) return "";
    if (message.includes("الرئيسيه") || message.includes("الرئيسية")) return "home";
    if (message.includes("المواد") || message.includes("ماده") || message.includes("مادة")) return "subjects";
    if (message.includes("الطلاب")) return "students";
    if (message.includes("تحضير") || message.includes("الحضور") || message.includes("الحظور")) return "attendance";
    if (message.includes("كشف") || message.includes("كشوف")) return "sheet";
    if (message.includes("درجات") || message.includes("الدرجات")) return "grades";
    if (message.includes("احصائيات") || message.includes("الإحصائيات")) return "stats";
    if (message.includes("حصص") || message.includes("الحصة")) return "schedule";
    if (message.includes("تقارير") || message.includes("التقارير") || message.includes("تقرير")) return "reports";
    if (message.includes("المشرف") || message.includes("كود")) return "manager";
    if (message.includes("سلوك") || message.includes("مخالفات")) return "behavior";
    if (message.includes("اعدادات") || message.includes("الإعدادات")) return "settings";
    return "";
  }

  visibleStudentRows(institution = null) {
    const license = this.app.services.license.getActiveLicense();
    return this.app.services.store.getSubjects(null, license)
      .filter((subject) => !institution || subject.institutionId === institution.id)
      .flatMap((subject) => {
      return this.app.services.store.getStudents(subject.id).map((student) => ({ subject, student }));
    });
  }

  institutionFromMessage(message) {
    return this.findInstitutionsFromMessage(message)[0] || null;
  }

  findInstitutionsFromMessage(message) {
    const license = this.app.services.license.getActiveLicense();
    const institutions = this.app.services.store.getInstitutions(license);
    return rankEntityMatches(message, institutions, (item) => `${item.name} ${item.type || ""}`).filter((item) => item.score >= 0.62).map((item) => item.entity);
  }

  needsClarification(message, intent, entities) {
    if (intent.category !== "query") return "";
    if (entities.studentMatches.length > 1 && ["attendance", "grades", "columnGrade", "failureReason", "studentInfo"].includes(intent.name)) {
      const options = entities.studentMatches.slice(0, 4).map((row, index) => `${index + 1}. ${row.student.name} - ${row.subject.name}`).join("\n");
      return `وجدت أكثر من طالب قريب من طلبك. أي طالب تقصد؟\n${options}`;
    }
    if (entities.subjectMatches.length > 1 && ["subjectStats", "countStudents", "studentsList"].includes(intent.name)) {
      const options = entities.subjectMatches.slice(0, 4).map((subject, index) => `${index + 1}. ${subject.name}`).join("\n");
      return `وجدت أكثر من مادة قريبة من طلبك. أي مادة تقصد؟\n${options}`;
    }
    const multiInstitutionQuestion = ["countStudents", "countSubjects", "countLessons", "subjectStats", "studentsList"].includes(intent.name);
    const license = this.app.services.license.getActiveLicense();
    const institutions = this.app.services.store.getInstitutions(license);
    if (multiInstitutionQuestion && institutions.length > 1 && !entities.institution && message.includes("جهة")) {
      return this.institutionClarificationAnswer();
    }
    if (intent.name === "columnGrade" && entities.student && !entities.gradeColumn) {
      const columns = this.app.services.store.getGradeColumns(entities.student.subject.id);
      if (columns.length > 1) return `أي عمود درجة تريد؟\n${columns.map((column) => `- ${column.label}`).join("\n")}`;
    }
    return "";
  }

  needsInstitutionClarification(message) {
    const dataQuestion = ["الطالب", "طلاب", "غياب", "تأخير", "راسب", "درجه", "درجة", "معلومات", "بيانات"].some((word) => message.includes(word));
    if (!dataQuestion) return false;
    const license = this.app.services.license.getActiveLicense();
    const institutions = this.app.services.store.getInstitutions(license);
    if (institutions.length <= 1) return false;
    return !this.institutionFromMessage(message);
  }

  institutionClarificationAnswer() {
    const license = this.app.services.license.getActiveLicense();
    const names = this.app.services.store.getInstitutions(license).map((item) => item.name).join("، ");
    return `لديك أكثر من جهة. في أي جهة تريد؟\nاكتب اسم الجهة مع السؤال، مثل: معلومات عن الطالب أمين في ${names.split("، ")[0] || "الجهة"}.`;
  }

  suggestionsHtml() {
    const suggestions = [
      "ما الحصة القادمة؟",
      "من أكثر الطلاب غيابًا؟",
      "افتح التحضير",
      "كم أسعار الاشتراك؟"
    ];
    return `<div class="assistant-suggestions">${suggestions.map((item) => `<button type="button" data-assistant-suggest="${item}">${item}</button>`).join("")}</div>`;
  }

  resumeChoiceHtml() {
    return `
      <div class="assistant-resume-panel">
        <div class="assistant-resume-icon"><i data-lucide="message-circle"></i></div>
        <h3>كيف تريد المتابعة؟</h3>
        <p>يمكنك الرجوع لآخر محادثة أو بدء محادثة جديدة من البداية.</p>
        <div class="assistant-resume-actions">
          <button class="primary-button" type="button" data-assistant-resume>
            <i data-lucide="corner-up-right"></i>
            متابعة آخر محادثة
          </button>
          <button class="ghost-button" type="button" data-assistant-new>
            <i data-lucide="plus-circle"></i>
            بدء محادثة جديدة
          </button>
        </div>
      </div>
    `;
  }

  renderMessages() {
    const box = qs("#assistant-messages", this.root);
    if (!box) return;
    box.innerHTML = this.messages.map((message) => `
      <article class="assistant-message ${message.role === "user" ? "user" : "assistant"}">
        ${escapeHtml(message.text).replace(/\n/g, "<br>")}
      </article>
    `).join("");
    box.scrollTop = box.scrollHeight;
  }

  renderRobotAnimation() {
    const target = qs(".assistant-robot-animation", this.root);
    if (!target || target.dataset.ready) return;
    if (!window.lottie) return;
    target.dataset.ready = "true";
    window.lottie.loadAnimation({
      container: target,
      renderer: "svg",
      loop: true,
      autoplay: true,
      path: "./assets/assistant-robot.json"
    });
  }

  savedPosition() {
    try {
      const saved = JSON.parse(localStorage.getItem(ASSISTANT_POSITION_KEY) || "{}");
      const defaultTop = "calc(50dvh - 37px)";
      const savedTop = String(saved.top || "");
      const numericTop = Number.parseFloat(savedTop);
      const clampedTop = Number.isFinite(numericTop) && savedTop.endsWith("px")
        ? `${Math.max(76, Math.min(window.innerHeight - 112, numericTop))}px`
        : savedTop;
      return {
        side: saved.side === "left" ? "left" : "right",
        top: clampedTop && !clampedTop.includes("100dvh") && !clampedTop.includes("100vh") ? clampedTop : defaultTop
      };
    } catch {
      return { side: "right", top: "calc(50dvh - 37px)" };
    }
  }

  loadHistory() {
    const settings = this.app.services.store?.getSettings?.() || {};
    if (settings.assistantSaveChats === false) return [];
    try {
      return JSON.parse(localStorage.getItem(this.historyKey()) || "[]").slice(-40);
    } catch {
      return [];
    }
  }

  persistHistory() {
    const settings = this.app.services.store?.getSettings?.() || {};
    const key = this.historyKey();
    this.currentHistoryKey = key;
    if (settings.assistantSaveChats === false) return localStorage.removeItem(key);
    localStorage.setItem(key, JSON.stringify(this.messages.slice(-40)));
  }

  historyKey() {
    const license = this.app.services.license?.getActiveLicense?.() || {};
    const role = String(license.accessMode || "guest").replace(/[^a-z0-9_-]/gi, "");
    const code = String(license.code || "local")
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, "")
      .slice(0, 48) || "local";
    return `${ASSISTANT_HISTORY_KEY}-${role}-${code}`;
  }
}

function normalize(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isOutsideScope(message) {
  const outside = ["كيف اتعلم", "تعلم البرمجه", "تعلم برمجه", "ما هو الطقس", "اخبار", "سياسه", "طبخ", "ذكاء اصطناعي", "ما هو الذكاء", "رياضه", "صحه", "سفر"];
  return outside.some((item) => message.includes(item));
}

function classifyMessage(message) {
  return detectIntent(message).category;
}

function detectIntent(message) {
  if (isOutsideScope(message)) return { category: "out_of_scope", name: "outOfScope" };
  if (hasAny(message, ["كيف", "اشرح", "شرح", "ما معنى", "ايش يعني", "وش يعني", "طريقة", "طريقه"])) {
    return { category: "explanation", name: "explain" };
  }
  if (hasAny(message, ["افتح", "اذهب", "روح", "انتقل", "وديني"])) return { category: "action", name: "openPage" };
  if (hasAny(message, ["اضف", "اضافة", "انشئ", "سجل"]) && hasAny(message, SUBJECT_WORDS)) return { category: "action", name: "addSubject" };
  if (hasAny(message, ["اضف", "اضافة", "انشئ", "سجل"]) && hasAny(message, STUDENT_WORDS)) return { category: "action", name: "addStudent" };
  if (hasAny(message, ["احذف", "حذف", "ازل", "امسح"]) && hasAny(message, SUBJECT_WORDS)) return { category: "action", name: "deleteSubject" };
  if (hasAny(message, ["احذف", "حذف", "ازل", "امسح"]) && hasAny(message, STUDENT_WORDS)) return { category: "action", name: "deleteStudent" };

  const asksCount = hasAny(message, ["كم", "عدد", "كم عدد", "كم يوجد", "كم عندي", "كم معي", "احصاء", "إحصاء"]);
  if (asksCount && hasAny(message, TEACHER_WORDS)) return { category: "query", name: "countTeachers" };
  if (asksCount && hasAny(message, BEHAVIOR_WORDS)) return { category: "query", name: "countViolations" };
  if (asksCount && hasAny(message, REQUEST_WORDS)) return { category: "query", name: "countRequests" };
  if (asksCount && hasAny(message, SUBJECT_WORDS)) return { category: "query", name: "countSubjects" };
  if (asksCount && hasAny(message, STUDENT_WORDS)) return { category: "query", name: "countStudents" };
  if (asksCount && hasAny(message, INSTITUTION_WORDS)) return { category: "query", name: "countInstitutions" };
  if (asksCount && hasAny(message, LESSON_WORDS)) return { category: "query", name: "countLessons" };
  const asksPrice = hasAny(message, ["أسعار", "اسعار", "سعر", "بكم", "تكلفة", "تكلفه", "الباقة", "الباقه", "كم الاشتراك", "كم اشتراك", "سعر الاشتراك", "اسعار الاشتراك", "الاشترك", "اشتراكات"]);
  if (asksPrice) return { category: "query", name: "pricing" };
  if (asksCount && hasAny(message, ["كل", "عام", "الكل", "التطبيق", "النظام"])) return { category: "query", name: "summary" };

  if (hasAny(message, ["مفعل", "التفعيل", "تفعيل", "ينتهي", "انتهاء", "مدة الاشتراك", "باقي", "يتبقى", "متبقي", "كم باقي", "كم يتبقى", "صلاحية الكود"])) return { category: "query", name: "subscriptionStatus" };
  if (hasAny(message, ["اسعار", "سعر", "بكم", "كم الاشتراك", "كم اشتراك", "سعر الاشتراك", "الاشترك", "اشتراكات", "الباقة", "الباقه", "تكلفة", "تكلفه"])) return { category: "query", name: "pricing" };
  if (hasAny(message, ["صلاحية", "صلاحيات", "اقدر", "مسموح", "ممنوع", "نوع حسابي", "حسابي"])) return { category: "query", name: "permissions" };
  if (hasAny(message, ["رقم ولي", "ولي الامر", "ولي أمر", "جوال ولي", "هاتف ولي", "اتصال", "واتساب", "sms"])) return { category: "query", name: "guardianContact" };
  if (hasAny(message, BEHAVIOR_WORDS)) return { category: "query", name: "behavior" };
  if (hasAny(message, ["الحصة القادمة", "الحصه القادمه", "اقرب حصة", "اقرب حصه", "المحاضرة القادمة", "محاضرة قادمة"])) return { category: "query", name: "nextLesson" };
  if (hasAny(message, ["اكثر غياب", "الأكثر غياب", "الغياب الاكثر", "كثير غياب", "متغيبين"])) return { category: "query", name: "mostAbsent" };
  if (hasAny(message, ["اكثر تاخير", "اكثر تأخير", "المتأخرين", "كثير تاخير", "كثير تأخير"])) return { category: "query", name: "mostLate" };
  if (hasAny(message, ["افضل الطلاب", "اعلى الطلاب", "أعلى الطلاب", "الاوائل", "الأوائل", "متفوقين", "اذكى طالب", "أذكى طالب", "افضل طالب", "أفضل طالب", "اعلى طالب", "أعلى طالب"])) return { category: "query", name: "topStudents" };
  if (hasAny(message, ["معرض", "خطر", "يحتاج متابعة", "بحاجة متابعة", "متابعة", "اضعف طالب", "أضعف طالب", "اقل طالب", "أقل طالب", "منخفض الدرجات"])) return { category: "query", name: "atRisk" };
  if (hasAny(message, ["احصائيات", "إحصائيات", "مستوى", "تحليل"]) && hasAny(message, SUBJECT_WORDS)) return { category: "query", name: "subjectStats" };
  if (hasAny(message, ABSENCE_WORDS) || hasAny(message, ATTENDANCE_WORDS) || hasAny(message, LATE_WORDS)) return { category: "query", name: "attendance" };
  if (hasAny(message, ["راسب", "رسوب", "لماذا", "ليش", "سبب الرسوب"])) return { category: "query", name: "failureReason" };
  if (hasAny(message, ["كم حصل", "حصل", "علامة", "علامه"]) && hasAny(message, GRADE_WORDS)) return { category: "query", name: "columnGrade" };
  if (hasAny(message, GRADE_WORDS)) return { category: "query", name: "grades" };
  if (hasAny(message, ["قائمة الطلاب", "قائمه الطلاب", "اعرض الطلاب", "اسماء الطلاب", "أسماء الطلاب"])) return { category: "query", name: "studentsList" };
  if (hasAny(message, ["معلومات", "بيانات", "تفاصيل", "سجل"]) || hasAny(message, STUDENT_WORDS)) return { category: "query", name: "studentInfo" };
  return { category: "unknown", name: "unknown" };
}

const STUDENT_WORDS = ["طالب", "الطالب", "طلاب", "الطلاب", "اسم", "اسماء", "أسماء"];
const SUBJECT_WORDS = ["ماده", "مادة", "مواد", "المواد", "الماده", "المادة", "درس", "مقرر"];
const TEACHER_WORDS = ["معلم", "معلمين", "المعلمين", "مدرس", "مدرسين"];
const INSTITUTION_WORDS = ["جهة", "جهه", "مدرسة", "مدرسه", "جامعة", "جامعه", "معهد", "مركز"];
const LESSON_WORDS = ["حصة", "حصه", "حصص", "محاضرة", "محاضره", "دوام", "جدول"];
const ATTENDANCE_WORDS = ["حضور", "تحضير", "دوام", "حاضر"];
const ABSENCE_WORDS = ["غياب", "غاب", "غائب", "متغيب", "متغيبين"];
const LATE_WORDS = ["تاخير", "تأخير", "متاخر", "متأخر"];
const GRADE_WORDS = ["درجة", "درجه", "درجات", "علامة", "علامه", "علامات", "مجموع", "المجموع", "نسبة", "نسبه"];
const BEHAVIOR_WORDS = ["مخالفة", "مخالفه", "مخالفات", "السلوك", "سلوك", "مواظبة", "المواظبة", "عقوبة", "عقوبه", "انذار", "إنذار"];
const REQUEST_WORDS = ["طلب", "طلبات", "طلبات المعلم", "طلبات الطلاب", "اضافة وحذف", "الإضافة والحذف"];

function hasAny(message, words) {
  return words.some((word) => message.includes(normalize(word)));
}

function isOffensive(message) {
  const words = [
    "كلب", "حمار", "غبي", "تافه", "حقير", "قذر", "وسخ", "زباله", "زبالة",
    "لعن", "ملعون", "سخيف", "وقح", "حيوان", "خرا", "زفت"
  ];
  return words.some((word) => message.includes(normalize(word)));
}

function asksAboutCreator(message) {
  const patterns = [
    "من برمج", "مين برمج", "من صمم", "مين صمم", "مبرمج", "مصمم",
    "المطور", "صاحب التطبيق", "مالك التطبيق", "من عمل التطبيق",
    "من سوى التطبيق", "مين سوى التطبيق", "عن امين", "من هو امين",
    "تواصل مع المطور", "رقم المطور", "رقم المصمم"
  ];
  return patterns.some((item) => message.includes(normalize(item)));
}

function rankEntityMatches(message, entities, labelGetter) {
  const messageTokens = meaningfulTokens(message);
  return entities
    .map((entity) => {
      const label = normalize(labelGetter(entity));
      const labelTokens = meaningfulTokens(label);
      const exact = label && message.includes(label) ? 1 : 0;
      const tokenScore = labelTokens.reduce((score, token) => {
        if (message.includes(token)) return Math.max(score, 0.88);
        const best = messageTokens.reduce((max, messageToken) => Math.max(max, similarity(token, messageToken)), 0);
        return Math.max(score, best);
      }, 0);
      const overlap = labelTokens.length
        ? labelTokens.filter((token) => messageTokens.some((messageToken) => similarity(token, messageToken) >= 0.78)).length / labelTokens.length
        : 0;
      return { entity, score: Math.max(exact, tokenScore, overlap) };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
}

function meaningfulTokens(value) {
  const ignored = new Set(["كم", "من", "في", "عن", "على", "الى", "إلى", "ال", "هذا", "هذه", "اريد", "ابغى", "اعرض", "معلومات", "بيانات"]);
  return normalize(value).split(" ").filter((token) => token.length > 1 && !ignored.has(token));
}

function similarity(first, second) {
  if (!first || !second) return 0;
  if (first === second) return 1;
  if (first.includes(second) || second.includes(first)) return Math.min(first.length, second.length) / Math.max(first.length, second.length);
  const distance = levenshtein(first, second);
  return 1 - distance / Math.max(first.length, second.length);
}

function levenshtein(first, second) {
  const rows = Array.from({ length: first.length + 1 }, (_, index) => [index]);
  for (let column = 1; column <= second.length; column += 1) rows[0][column] = column;
  for (let row = 1; row <= first.length; row += 1) {
    for (let column = 1; column <= second.length; column += 1) {
      const cost = first[row - 1] === second[column - 1] ? 0 : 1;
      rows[row][column] = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + cost
      );
    }
  }
  return rows[first.length][second.length];
}

function pageLabel(pageName) {
  const labels = {
    home: "الرئيسية",
    subjects: "المواد",
    students: "الطلاب",
    attendance: "التحضير",
    sheet: "الكشف",
    grades: "الدرجات",
    stats: "الإحصائيات",
    schedule: "الحصص",
    settings: "الإعدادات",
    manager: "قسم المشرف",
    behavior: "السلوك والمواظبة",
    reports: "تقارير المشرف"
  };
  return labels[pageName] || "الصفحة";
}

function isGreeting(message) {
  const greetings = ["مرحبا", "اهلا", "هلا", "السلام عليكم", "صباح الخير", "مساء الخير"];
  return greetings.some((item) => message.includes(item));
}

function isWellbeing(message) {
  return message.includes("كيف حالك") || message.includes("كيفك") || message.includes("اخبارك") || message.includes("ايش اخبارك");
}

function isThanks(message) {
  return message.includes("شكرا") || message.includes("متشكر") || message.includes("يعطيك العافيه") || message.includes("جزاك الله");
}

function asksCapabilities(message) {
  return message.includes("ماذا تستطيع") || message.includes("ايش تقدر") || message.includes("وش تقدر") || message.includes("ساعدني") || message.includes("مساعده");
}

function timeToMinutes(value = "00:00") {
  const [hours, minutes] = String(value).split(":").map(Number);
  return (Number(hours) || 0) * 60 + (Number(minutes) || 0);
}

function statusLabel(status) {
  return status === "present" ? "حاضر" : status === "absent" ? "غائب" : status === "late" ? "متأخر" : "-";
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
