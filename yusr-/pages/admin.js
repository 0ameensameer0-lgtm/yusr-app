import { qs, renderIcons, setPageTitle } from "../utils/dom.js?v=35";
import { isSupabaseConfigured } from "../supabase-config.js?v=25";

export class AdminPage {
  constructor(app) {
    this.app = app;
    this.generatedCodes = JSON.parse(localStorage.getItem("yusr-generated-codes-v1") || "[]");
  }

  async render({ skipRemoteRefresh = false } = {}) {
    setPageTitle("لوحة الإدارة");
    if (!this.app.services.license.isAdmin()) return this.renderLogin();
    if (!skipRemoteRefresh) await this.refreshRemoteCodes();
    this.generatedCodes = this.generatedCodes.filter((item) => item.status !== "revoked" && !isExpiredLicense(item.expiresAt));
    localStorage.setItem("yusr-generated-codes-v1", JSON.stringify(this.generatedCodes));
    const activationRequests = await this.loadActivationRequests();
    const openActivationRequests = activationRequests.filter((request) => !isClosedRequest(request));
    const paymentReviewRequests = openActivationRequests.filter((request) => request.status === "payment_review" || Number(request.paymentAttempt || 1) > 1);
    const renewalRequests = openActivationRequests.filter((request) => isRenewalRequest(request) && !paymentReviewRequests.some((item) => item.id === request.id));
    const normalActivationRequests = openActivationRequests.filter((request) => !isRenewalRequest(request) && !paymentReviewRequests.some((item) => item.id === request.id));
    const localViews = this.app.services.license.getLocalSiteViewsCount();
    const latestCode = this.generatedCodes[0];
    const latestExpiry = latestCode ? this.formatDate(latestCode.expiresAt, "full") : "";
    const pricing = await this.loadPricing();

    qs("#view").innerHTML = `
      <div class="toolbar">
        <div><span class="eyebrow">إدارة التراخيص</span><h2>أكواد تفعيل يُسر</h2></div>
        <button class="ghost-button" id="admin-logout"><i data-lucide="log-out"></i>خروج</button>
      </div>

      <div class="admin-section-tabs">
        <button class="status-button admin-tab-button" data-admin-section-tab="create"><i data-lucide="key-round"></i><span>إنشاء كود جديد</span></button>
        <button class="status-button admin-tab-button" data-admin-section-tab="requests"><i data-lucide="receipt-text"></i><span>طلبات التفعيل</span></button>
        <button class="status-button admin-tab-button" data-admin-section-tab="renewals"><i data-lucide="refresh-cw"></i><span>إعادة تنشيط الأكواد</span>${renewalRequests.length ? `<span class="mini-count">${renewalRequests.length}</span>` : ""}</button>
        <button class="status-button admin-tab-button" data-admin-section-tab="payment-review"><i data-lucide="badge-check"></i><span>تحقق من الدفع</span>${paymentReviewRequests.length ? `<span class="mini-count">${paymentReviewRequests.length}</span>` : ""}</button>
        <button class="status-button admin-tab-button" data-admin-section-tab="codes"><i data-lucide="list-checks"></i><span>الأكواد</span></button>
        <button class="status-button admin-tab-button" data-admin-section-tab="pricing"><i data-lucide="badge-dollar-sign"></i><span>إدارة الأسعار</span></button>
        <button class="status-button admin-tab-button" data-admin-section-tab="readiness"><i data-lucide="shield-check"></i><span>جاهزية التطبيق</span></button>
        <button class="status-button admin-tab-button" data-admin-section-tab="views"><i data-lucide="eye"></i><span>مشاهدات التطبيق</span></button>
        <button class="status-button admin-tab-button" data-admin-section-tab="pin"><i data-lucide="lock-keyhole"></i><span>تغيير كلمة المرور</span></button>
      </div>

      ${isSupabaseConfigured() ? "" : `
        <div class="smart-note">
          <i data-lucide="cloud-alert"></i>
          <span>التحكم الحقيقي بالأجهزة وحذف الأكواد يحتاج تفعيل Supabase في ملف supabase-config.js.</span>
        </div>
      `}

      <section class="license-grid">
        <article class="panel" data-admin-section="create">
          <div class="panel-header"><h3>إنشاء كود جديد</h3></div>
          <form class="form-grid" id="license-form">
            <label>اسم المستخدم
              <input class="field" name="ownerName" placeholder="مثال: أحمد محمد" required pattern="[\p{L}\s.'-]{2,}" title="اكتب اسمًا فقط بدون أرقام" />
            </label>
            <label>الخطة
              <select name="plan" class="select-field">
                <option value="PRO">معلم</option>
                <option value="SCHOOL">مدرسة</option>
                <option value="TRIAL">تجربة</option>
              </select>
            </label>
            <label>صلاحية الحساب
              <select name="accessMode" class="select-field">
                ${accessModeOptions("admin")}
              </select>
            </label>
            <label>عدد الأكواد التابعة
              <input class="field" name="teacherSlots" type="number" min="0" value="0" />
            </label>
            <div class="duration-row">
              <label>مدة الاشتراك<input class="field" name="duration" type="number" min="1" value="12" /></label>
              <input type="hidden" name="durationUnit" value="months" />
              <div class="duration-unit-field">
                <span>نوع المدة</span>
                <div class="segmented-control duration-segment">
                  <button type="button" data-duration-unit="days">أيام</button>
                  <button type="button" data-duration-unit="weeks">أسابيع</button>
                  <button type="button" class="active" data-duration-unit="months">شهور</button>
                </div>
              </div>
            </div>
            <button class="primary-button"><i data-lucide="key-round"></i>إنشاء كود</button>
          </form>
        </article>

        <article class="panel" data-admin-section="create">
          <div class="panel-header"><h3>آخر كود</h3></div>
          <div class="license-code-box" id="latest-code" data-full-code="${escapeAttribute(latestCode?.code || "")}">${latestCode?.code ? displayCode(latestCode.code) : "لم يتم إنشاء كود بعد"}</div>
          <p class="muted" id="latest-expiry">${latestCode ? `ينتهي في ${latestExpiry}` : ""}</p>
          <button class="ghost-button" id="copy-code"><i data-lucide="copy"></i>نسخ الكود</button>
        </article>

        <article class="panel" data-admin-section="pin">
          <div class="panel-header"><h3>تغيير كلمة مرور لوحة الإدارة</h3></div>
          <form class="form-grid" id="admin-pin-form">
            <label>كلمة المرور الحالية<input name="currentPin" type="password" required /></label>
            <label>كلمة المرور الجديدة<input name="nextPin" type="password" minlength="4" required /></label>
            <button class="primary-button"><i data-lucide="key-round"></i>تغيير كلمة المرور</button>
          </form>
        </article>

        <article class="panel" data-admin-section="views">
          <div class="panel-header"><h3>مشاهدات التطبيق</h3></div>
          <div class="license-code-box site-views-count" id="site-views-count">${localViews}</div>
          <p class="muted">عدد مرات فتح التطبيق. عند تفعيل Supabase يظهر العدد من كل الأجهزة.</p>
        </article>
      </section>

      <section class="panel activation-requests-panel" data-admin-section="requests">
        <div class="panel-header">
          <div>
            <span class="eyebrow">مراجعة المدفوعات</span>
            <h3>طلبات التفعيل</h3>
          </div>
          <span class="status-badge status-late">${normalActivationRequests.filter((request) => request.status !== "approved").length} بانتظار التحقق</span>
        </div>
        <div class="smart-note compact-note">
          <i data-lucide="receipt-text"></i>
          <span>الطلبات هنا هي الطلبات التي ضغط أصحابها زر “تم الدفع”. طابق اسم المحول مع كشف التحويل، ثم حوّل الكود المؤقت إلى اشتراك رسمي.</span>
        </div>
        <div class="table-shell admin-table">
          <table>
            <thead><tr><th>اسم المحول</th><th>نوع الحساب</th><th>الاشتراك</th><th>المبلغ المطلوب</th><th>الكود المؤقت</th><th>حالة الدفع</th><th>الصلاحية</th><th>الاشتراك الرسمي</th><th>إجراء</th></tr></thead>
            <tbody>
              ${normalActivationRequests.length ? normalActivationRequests.map((request) => `
                <tr>
                  <td>
                    <strong>${request.customerName}</strong>
                    <br><small class="muted">${this.formatDate(request.createdAt)}</small>
                  </td>
                  <td>
                    <span class="plan-pill">${request.accountRoleLabel || accessModeLabel(request.accessMode)}</span>
                    ${isManagerRequest(request) ? `
                      <label class="inline-number-field">معلمين إضافيين
                        <input class="field" type="number" min="0" value="${Number(request.teacherSlots || 0)}" data-request-teacher-slots="${request.id}" ${request.status === "approved" ? "disabled" : ""} />
                      </label>
                    ` : ""}
                  </td>
                  <td><span class="plan-pill">${request.requestedLabel}</span></td>
                  <td><strong class="request-price" data-request-price="${request.id}">${this.requestPriceLabel(request, request.requestedPlan)}</strong></td>
                  <td><code>${request.code}</code></td>
                  <td>${requestStatus(request)}<br><small class="muted">${requestPaymentHint(request)}</small></td>
                  <td>
                    <select class="select-field compact-select" data-request-access="${request.id}">
                      ${accessModeOptions(request.accessMode || "admin")}
                    </select>
                    <button class="status-button" data-save-request-access="${request.id}">حفظ الصلاحية</button>
                  </td>
                  <td>
                    <select class="select-field compact-select" data-request-duration="${request.id}" ${request.status === "approved" ? "disabled" : ""}>
                      ${this.requestDurationOptions(request)}
                    </select>
                  </td>
                  <td class="admin-actions">
                    <button class="status-button" data-copy="${request.code}">نسخ</button>
                    <button class="status-button ${request.status === "approved" ? "" : "primary-lite"}" data-approve-request="${request.id}" ${request.status === "approved" ? "disabled" : ""}>${requestActionLabel(request)}</button>
                  </td>
                </tr>
              `).join("") : `<tr><td colspan="9">لا توجد طلبات تفعيل بعد</td></tr>`}
            </tbody>
          </table>
        </div>
        <div class="activation-requests-mobile">
          ${normalActivationRequests.length ? normalActivationRequests.map((request) => `
            <article class="activation-request-card">
              <header>
                <span class="eyebrow">اسم المحول</span>
                <strong>${request.customerName}</strong>
                ${requestStatus(request)}
              </header>
              <div class="request-card-grid">
                <span><small>طلب العميل</small><b>${request.requestedLabel}</b></span>
                <span><small>نوع الحساب</small><b>${request.accountRoleLabel || accessModeLabel(request.accessMode)}</b></span>
                ${isManagerRequest(request) ? `<span><small>معلمين إضافيين</small><input class="field" type="number" min="0" value="${Number(request.teacherSlots || 0)}" data-request-teacher-slots="${request.id}" ${request.status === "approved" ? "disabled" : ""} /></span>` : ""}
                <span><small>المبلغ المطلوب</small><b class="request-price" data-request-price="${request.id}">${this.requestPriceLabel(request, request.requestedPlan)}</b></span>
                <span><small>تاريخ الطلب</small><b>${this.formatDate(request.createdAt)}</b></span>
                <span><small>الصلاحية</small><b>${accessModeLabel(request.accessMode)}</b></span>
              </div>
              <code>${request.code}</code>
              <label>صلاحية الحساب
                <select class="select-field compact-select" data-request-access="${request.id}">
                  ${accessModeOptions(request.accessMode || "admin")}
                </select>
              </label>
              <button class="status-button" data-save-request-access="${request.id}">حفظ الصلاحية</button>
              <label>تحويل إلى
                <select class="select-field compact-select" data-request-duration="${request.id}" ${request.status === "approved" ? "disabled" : ""}>
                  ${this.requestDurationOptions(request)}
                </select>
              </label>
              <div class="admin-actions">
                <button class="status-button" data-copy="${request.code}">نسخ الكود</button>
                <button class="status-button primary-lite" data-approve-request="${request.id}" ${request.status === "approved" ? "disabled" : ""}>${requestActionLabel(request)}</button>
              </div>
            </article>
          `).join("") : ""}
        </div>
      </section>

      <section class="panel activation-requests-panel" data-admin-section="renewals">
        <div class="panel-header">
          <div>
            <span class="eyebrow">اشتراكات حالية تريد تمديدًا</span>
            <h3>إعادة تنشيط الأكواد</h3>
          </div>
          <span class="status-badge status-late">${renewalRequests.filter((request) => request.status !== "approved").length} بانتظار التفعيل</span>
        </div>
        <div class="smart-note compact-note">
          <i data-lucide="refresh-cw"></i>
          <span>هذه الطلبات أرسلها مستخدم لديه كود سابق ويريد تمديد الاشتراك أو تغيير نوعه. يظهر الاسم، التاريخ، نوع الاشتراك، والمبلغ المطلوب قبل الاعتماد.</span>
        </div>
        <div class="table-shell admin-table">
          <table>
            <thead><tr><th>اسم المستخدم</th><th>التاريخ</th><th>نوع الحساب</th><th>الاشتراك المطلوب</th><th>المبلغ</th><th>الكود</th><th>الحالة</th><th>تحويل إلى</th><th>إجراء</th></tr></thead>
            <tbody>
              ${renewalRequests.length ? renewalRequests.map((request) => `
                <tr>
                  <td><strong>${request.customerName}</strong></td>
                  <td>${this.formatDate(request.createdAt, "full")}</td>
                  <td><span class="plan-pill">${request.accountRoleLabel || accessModeLabel(request.accessMode)}</span></td>
                  <td><span class="plan-pill">${request.requestedLabel}</span></td>
                  <td><strong class="request-price" data-request-price="${request.id}">${this.requestPriceLabel(request, request.requestedPlan)}</strong></td>
                  <td><code>${request.code}</code></td>
                  <td>${requestStatus(request)}</td>
                  <td>
                    <select class="select-field compact-select" data-request-duration="${request.id}" ${request.status === "approved" ? "disabled" : ""}>
                      ${this.requestDurationOptions(request)}
                    </select>
                  </td>
                  <td class="admin-actions">
                    <button class="status-button" data-copy="${request.code}">نسخ</button>
                    <button class="status-button danger-text" data-mark-renewal-unpaid="${request.id}" ${request.status === "approved" ? "disabled" : ""}>لم يتم الدفع</button>
                    <button class="status-button primary-lite" data-approve-request="${request.id}" ${request.status === "approved" ? "disabled" : ""}>إعادة تنشيط</button>
                  </td>
                </tr>
              `).join("") : `<tr><td colspan="9">لا توجد طلبات إعادة تنشيط الآن</td></tr>`}
            </tbody>
          </table>
        </div>
        <div class="activation-requests-mobile">
          ${renewalRequests.length ? renewalRequests.map((request) => `
            <article class="activation-request-card renewal-request-card">
              <header>
                <span class="eyebrow">إعادة تنشيط</span>
                <strong>${request.customerName}</strong>
                ${requestStatus(request)}
              </header>
              <div class="request-card-grid">
                <span><small>نوع الحساب</small><b>${request.accountRoleLabel || accessModeLabel(request.accessMode)}</b></span>
                <span><small>الاشتراك</small><b>${request.requestedLabel}</b></span>
                <span><small>المبلغ</small><b class="request-price" data-request-price="${request.id}">${this.requestPriceLabel(request, request.requestedPlan)}</b></span>
                <span><small>التاريخ</small><b>${this.formatDate(request.createdAt)}</b></span>
              </div>
              <code>${request.code}</code>
              <label>تحويل إلى
                <select class="select-field compact-select" data-request-duration="${request.id}" ${request.status === "approved" ? "disabled" : ""}>
                  ${this.requestDurationOptions(request)}
                </select>
              </label>
              <div class="admin-actions">
                <button class="status-button" data-copy="${request.code}">نسخ</button>
                <button class="status-button danger-text" data-mark-renewal-unpaid="${request.id}" ${request.status === "approved" ? "disabled" : ""}>لم يتم الدفع</button>
                <button class="status-button primary-lite" data-approve-request="${request.id}" ${request.status === "approved" ? "disabled" : ""}>إعادة تنشيط</button>
              </div>
            </article>
          `).join("") : `<div class="empty-state compact"><h3>لا توجد طلبات إعادة تنشيط الآن</h3></div>`}
        </div>
      </section>

      <section class="panel activation-requests-panel" data-admin-section="payment-review">
        <div class="panel-header">
          <div>
            <span class="eyebrow">مراجعة محاولة دفع ثانية</span>
            <h3>تحقق من الدفع</h3>
          </div>
          <span class="status-badge status-late">${paymentReviewRequests.filter((request) => request.status !== "approved").length} بانتظار قرارك</span>
        </div>
        <div class="smart-note compact-note">
          <i data-lucide="shield-alert"></i>
          <span>هذه الطلبات من مستخدم جرّب كودًا مؤقتًا سابقًا ولم يتم اعتماد دفعه. لا يفتح التطبيق مرة أخرى إلا بعد تأكيدك أنت.</span>
        </div>
        <div class="table-shell admin-table admin-payment-review-table">
          <table>
            <thead><tr><th>اسم المستخدم</th><th>تاريخ الطلب</th><th>نوع الحساب</th><th>الاشتراك المطلوب</th><th>المبلغ</th><th>الكود الحالي</th><th>المحاولة السابقة</th><th>تحويل إلى</th><th>إجراء</th></tr></thead>
            <tbody>
              ${paymentReviewRequests.length ? paymentReviewRequests.map((request) => `
                <tr>
                  <td><strong>${request.customerName}</strong></td>
                  <td>${this.formatDate(request.createdAt, "full")}</td>
                  <td><span class="plan-pill">${request.accountRoleLabel || accessModeLabel(request.accessMode)}</span></td>
                  <td><span class="plan-pill">${request.requestedLabel}</span></td>
                  <td><strong>${this.requestPriceLabel(request, request.requestedPlan)}</strong></td>
                  <td><code>${request.code}</code></td>
                  <td>${request.previousPaymentCode ? `<code>${request.previousPaymentCode}</code>` : `<span class="muted">محاولة سابقة غير معتمدة</span>`}</td>
                  <td>
                    <select class="select-field compact-select" data-request-duration="${request.id}" ${request.status === "approved" ? "disabled" : ""}>
                      ${this.requestDurationOptions(request)}
                    </select>
                  </td>
                  <td class="admin-actions">
                    <button class="status-button" data-copy="${request.code}">نسخ</button>
                    <button class="status-button primary-lite" data-approve-request="${request.id}" ${request.status === "approved" ? "disabled" : ""}>اعتماد الدفع</button>
                  </td>
                </tr>
              `).join("") : `<tr><td colspan="9">لا توجد طلبات تحقق من الدفع الآن</td></tr>`}
            </tbody>
          </table>
        </div>
        <div class="activation-requests-mobile">
          ${paymentReviewRequests.length ? paymentReviewRequests.map((request) => `
            <article class="activation-request-card payment-review-card">
              <header>
                <span class="eyebrow">تحقق من الدفع</span>
                <strong>${request.customerName}</strong>
                ${requestStatus(request)}
              </header>
              <div class="request-card-grid">
                <span><small>نوع الحساب</small><b>${request.accountRoleLabel || accessModeLabel(request.accessMode)}</b></span>
                <span><small>الاشتراك</small><b>${request.requestedLabel}</b></span>
                <span><small>المبلغ</small><b>${this.requestPriceLabel(request, request.requestedPlan)}</b></span>
                <span><small>التاريخ</small><b>${this.formatDate(request.createdAt)}</b></span>
              </div>
              <code>${request.code}</code>
              <label>تحويل إلى
                <select class="select-field compact-select" data-request-duration="${request.id}" ${request.status === "approved" ? "disabled" : ""}>
                  ${this.requestDurationOptions(request)}
                </select>
              </label>
              <div class="admin-actions">
                <button class="status-button" data-copy="${request.code}">نسخ</button>
                <button class="status-button primary-lite" data-approve-request="${request.id}" ${request.status === "approved" ? "disabled" : ""}>اعتماد الدفع</button>
              </div>
            </article>
          `).join("") : `<div class="empty-state compact"><h3>لا توجد طلبات تحقق من الدفع الآن</h3></div>`}
        </div>
      </section>

      <section class="panel" data-admin-section="codes">
        <div class="panel-header"><h3>الأكواد</h3></div>
        <div class="table-shell admin-table">
          <table>
            <thead><tr><th>الاسم</th><th>الكود</th><th>الخطة</th><th>الحالة</th><th>الصلاحية</th><th>ينتهي في</th><th>إجراء</th></tr></thead>
            <tbody>
              ${this.generatedCodes.length ? this.generatedCodes.map((item) => `
                <tr>
                  <td><strong>${codeOwnerName(item)}</strong></td>
                  <td><code>${displayCode(item.code)}</code></td>
                  <td>${item.plan}</td>
                  <td>${licenseStatus(item)}</td>
                  <td>
                    <select class="select-field compact-select" data-code-access="${item.code}">
                      ${accessModeOptions(item.accessMode || "admin")}
                    </select>
                  </td>
                  <td>
                    <strong>${this.formatDate(item.expiresAt)}</strong>
                    <br><small class="muted">${cleanDurationLabel(item.durationLabel)}</small>
                  </td>
                  <td class="admin-actions">
                    <button class="status-button" data-copy="${item.code}">نسخ</button>
                    <button class="status-button danger-text" data-revoke-code="${item.code}">حذف الكود</button>
                  </td>
                </tr>
              `).join("") : `<tr><td colspan="7">لا توجد أكواد بعد</td></tr>`}
            </tbody>
          </table>
        </div>
        <div class="admin-codes-mobile">
          ${this.generatedCodes.length ? this.generatedCodes.map((item) => `
            <article class="admin-code-card">
              <div>
                <span class="eyebrow">كود التفعيل</span>
                <strong>${codeOwnerName(item)}</strong>
                <code>${displayCode(item.code)}</code>
              </div>
              <div class="admin-code-meta">
                <span>${item.plan}</span>
                <span>${accessModeLabel(item.accessMode)}</span>
                ${licenseStatus(item)}
              </div>
              <select class="select-field compact-select" data-code-access="${item.code}">
                ${accessModeOptions(item.accessMode || "admin")}
              </select>
              <small class="muted">ينتهي في ${this.formatDate(item.expiresAt)} ${cleanDurationLabel(item.durationLabel) ? `· ${cleanDurationLabel(item.durationLabel)}` : ""}</small>
              <div class="admin-actions">
                <button class="status-button" data-copy="${item.code}">نسخ</button>
                <button class="status-button danger-text" data-revoke-code="${item.code}">حذف الكود</button>
              </div>
            </article>
          `).join("") : `<div class="empty-state compact"><h3>لا توجد أكواد بعد</h3></div>`}
        </div>
      </section>

      <section class="panel pricing-panel" data-admin-section="pricing">
        <div class="panel-header">
          <div>
            <span class="eyebrow">تحديد أسعار الاشتراكات</span>
            <h3>إدارة الأسعار</h3>
          </div>
        </div>
        <form class="pricing-form" id="pricing-form">
          <section class="pricing-card">
            <h4>عملة التسعير</h4>
            <label>العملة الافتراضية في صفحة طلب التفعيل
              <select class="select-field" name="currency">
                <option value="SAR" ${pricing.currency === "SAR" ? "selected" : ""}>ريال سعودي</option>
                <option value="YER" ${pricing.currency === "YER" ? "selected" : ""}>ريال يمني</option>
              </select>
            </label>
          </section>
          ${pricingGroup("teacher", "أسعار المعلم", pricing.teacher, [["week", "أسبوعي"], ["month", "شهري"], ["year", "سنوي"]])}
          ${pricingGroup("admin", "أسعار المشرف", pricing.admin, [["month", "شهري"], ["year", "سنوي"], ["extraTeacherMonth", "زيادة شهرية لكل معلم"], ["extraTeacherYear", "زيادة سنوية لكل معلم"]])}
          ${pricingGroup("delegate", "أسعار المندوب", pricing.delegate, [["week", "أسبوعي"], ["month", "شهري"], ["year", "سنوي"]])}
          <div class="smart-note compact-note pricing-note">
            <i data-lucide="info"></i>
            <span>هذه الأسعار تظهر مباشرة في صفحة طلب التفعيل. في باقة المشرف يتم إضافة قيمة "زيادة لكل معلم" على السعر الأساسي حسب عدد المعلمين الذي يحدده العميل.</span>
          </div>
          <button class="primary-button"><i data-lucide="save"></i>حفظ الأسعار</button>
        </form>
      </section>

      <section class="panel readiness-panel" data-admin-section="readiness">
        <div class="panel-header">
          <div>
            <span class="eyebrow">فحص نهائي قبل التسليم</span>
            <h3>جاهزية التطبيق</h3>
          </div>
          <span class="status-badge status-present">${this.readinessScore()}% مكتمل</span>
        </div>
        <div class="readiness-grid">
          ${this.readinessChecks().map((item) => `
            <article class="readiness-card ${item.ok ? "ready" : "needs-work"}">
              <i data-lucide="${item.icon}"></i>
              <div>
                <strong>${item.title}</strong>
                <p>${item.message}</p>
              </div>
              <span>${item.ok ? "جاهز" : "يحتاج تحقق"}</span>
            </article>
          `).join("")}
        </div>
        <div class="smart-note compact-note">
          <i data-lucide="clipboard-check"></i>
          <span>هذه القائمة تفحص الأشياء العشرة المهمة: الجوال، Supabase، الصلاحيات، النسخ الاحتياطي، PDF، الاشتراك، صفحة التفعيل، الإشعارات، الأمان، والرفع. البنود التي تحتاج جهازًا أو Supabase حقيقيًا ستظهر كـ “يحتاج تحقق”.</span>
        </div>
      </section>

    `;

    qs("#admin-logout").addEventListener("click", () => {
      this.app.services.license.adminLogout();
      this.render();
    });
    this.updateSiteViewsCount();
    this.bindAdminSectionTabs();
    qs("#pricing-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.target));
      const nextPricing = {
        currency: data.currency || "SAR",
        teacher: { week: data.teacherWeek, month: data.teacherMonth, year: data.teacherYear },
        admin: { month: data.adminMonth, year: data.adminYear, extraTeacherMonth: data.adminExtraTeacherMonth, extraTeacherYear: data.adminExtraTeacherYear },
        delegate: { week: data.delegateWeek, month: data.delegateMonth, year: data.delegateYear }
      };
      try {
        const result = await this.app.services.license.saveActivationPricing(nextPricing);
        this.app.services.toast.show(result.message, "success");
      } catch {
        this.app.services.toast.show("تعذر حفظ الأسعار في Supabase. تأكد من جدول admin_settings.", "error");
      }
    });

    qs("#license-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.target));
      const code = this.app.services.license.generateCode(data);
      const validation = this.app.services.license.validateCode(code);
      const durationLabel = this.durationLabel(data.duration, data.durationUnit);
      const accessMode = data.accessMode || "admin";
      const teacherSlots = accessMode === "admin" ? Math.max(0, Number(data.teacherSlots || 0)) : 0;
      const ownerName = String(data.ownerName || "").trim().replace(/[^\p{L}\s.'-]/gu, "");
      if (!/^[\p{L}][\p{L}\s.'-]{1,}$/u.test(ownerName)) {
        this.app.services.toast.show("اكتب اسم المستخدم قبل إنشاء الكود", "error");
        return;
      }
      const item = { code, plan: validation.plan, expiresAt: validation.expiresAt, durationLabel, accessMode, teacherSlots, ownerName, status: "active", createdAt: new Date().toISOString() };

      this.generatedCodes.unshift(item);
      localStorage.setItem("yusr-generated-codes-v1", JSON.stringify(this.generatedCodes));
      this.app.services.toast.show("تم إنشاء كود جديد", "success");
      await this.render({ skipRemoteRefresh: true });
      qs("#latest-code").textContent = code;
      qs("#latest-expiry").textContent = `المدة: ${durationLabel} · ينتهي في ${this.formatDate(validation.expiresAt, "full")}`;

      if (isSupabaseConfigured()) {
        this.app.services.license
          .createRemoteLicense({ code, plan: validation.plan, expiresAt: validation.expiresAt, durationLabel, accessMode: item.accessMode, teacherSlots: item.teacherSlots, ownerName: item.ownerName })
          .catch(() => this.app.services.toast.show("تم إنشاء الكود محليًا. تحقق من اتصال Supabase إذا أردت مزامنته", "error"));
      } else {
        this.app.services.toast.show("تم إنشاء الكود محليًا فقط. فعّل Supabase للتحكم الحقيقي", "error");
      }
    });
    document.querySelectorAll("[data-duration-unit]").forEach((button) => button.addEventListener("click", () => {
      document.querySelectorAll("[data-duration-unit]").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      qs('input[name="durationUnit"]').value = button.dataset.durationUnit;
    }));

    qs("#copy-code").addEventListener("click", () => this.copy(qs("#latest-code").dataset.fullCode || qs("#latest-code").textContent));
    document.querySelectorAll("[data-copy]").forEach((button) => button.addEventListener("click", () => this.copy(button.dataset.copy)));
    document.querySelectorAll("[data-code-access]").forEach((select) => select.addEventListener("change", async () => {
      try {
        const result = await this.saveAccessModeForCode(select.dataset.codeAccess, select.value);
        this.app.services.toast.show(result.message, result.ok ? "success" : "error");
        if (!result.ok) await this.render();
      } catch {
        this.app.services.toast.show("تعذر تحديث الصلاحية الآن. حاول مرة أخرى بعد التأكد من الاتصال", "error");
      }
    }));
    document.querySelectorAll("[data-save-request-access]").forEach((button) => button.addEventListener("click", async () => {
      const request = activationRequests.find((item) => item.id === button.dataset.saveRequestAccess);
      const select = qs(`[data-request-access="${button.dataset.saveRequestAccess}"]`);
      if (!request || !select) return;
      if (request.status !== "approved") {
        this.app.services.toast.show("اختر الصلاحية ثم فعّل الاشتراك ليتم تطبيقها على الحساب", "error");
        return;
      }
      try {
        const result = await this.saveAccessModeForCode(request.code, select.value);
        this.app.services.toast.show(result.message, result.ok ? "success" : "error");
        if (!result.ok) await this.render();
      } catch {
        this.app.services.toast.show("تعذر تحديث صلاحية هذا الطلب الآن", "error");
      }
    }));
    document.querySelectorAll("[data-request-duration]").forEach((select) => select.addEventListener("change", () => {
      const request = activationRequests.find((item) => item.id === select.dataset.requestDuration);
      if (!request) return;
      document.querySelectorAll(`[data-request-price="${select.dataset.requestDuration}"]`)
        .forEach((target) => { target.textContent = this.requestPriceLabel(request, select.value); });
    }));
    document.querySelectorAll("[data-request-teacher-slots]").forEach((input) => input.addEventListener("input", () => {
      const request = activationRequests.find((item) => item.id === input.dataset.requestTeacherSlots);
      if (!request) return;
      request.teacherSlots = Math.max(0, Number(input.value || 0));
      document.querySelectorAll(`[data-request-teacher-slots="${input.dataset.requestTeacherSlots}"]`)
        .forEach((item) => {
          if (item !== input) item.value = input.value;
        });
      const duration = qs(`[data-request-duration="${input.dataset.requestTeacherSlots}"]`)?.value || request.requestedPlan;
      document.querySelectorAll(`[data-request-price="${input.dataset.requestTeacherSlots}"]`)
        .forEach((target) => { target.textContent = this.requestPriceLabel(request, duration); });
    }));
    document.querySelectorAll("[data-revoke-code]").forEach((button) => button.addEventListener("click", async () => this.revokeCode(button.dataset.revokeCode)));
    document.querySelectorAll("[data-mark-renewal-unpaid]").forEach((button) => button.addEventListener("click", async () => {
      const request = activationRequests.find((item) => item.id === button.dataset.markRenewalUnpaid);
      const ok = await this.app.services.modal.confirm({
        title: "لم يتم الدفع",
        message: `هل تريد تسجيل أن "${request?.customerName || "المستخدم"}" لم يدفع؟ سيظهر له تنبيه أن التجديد لم يتم وأن الحساب سيتوقف عند نهاية الاشتراك الحالي.`,
        confirmLabel: "نعم، لم يتم الدفع",
        cancelLabel: "إلغاء"
      });
      if (!ok) return;
      try {
        const result = await this.app.services.license.markActivationRequestUnpaid(button.dataset.markRenewalUnpaid);
        this.app.services.toast.show(result.message, result.ok ? "success" : "error");
        await this.render();
      } catch {
        this.app.services.toast.show("تعذر تسجيل حالة عدم الدفع", "error");
      }
    }));
    document.querySelectorAll("[data-approve-request]").forEach((button) => button.addEventListener("click", async () => {
      const select = qs(`[data-request-duration="${button.dataset.approveRequest}"]`);
      const accessSelect = qs(`[data-request-access="${button.dataset.approveRequest}"]`);
      const teacherSlotsInputs = [...document.querySelectorAll(`[data-request-teacher-slots="${button.dataset.approveRequest}"]`)];
      const request = activationRequests.find((item) => item.id === button.dataset.approveRequest);
      if (request && teacherSlotsInputs.length) request.teacherSlots = Math.max(...teacherSlotsInputs.map((input) => Math.max(0, Number(input.value || 0))));
      const selectedLabel = select.selectedOptions[0]?.textContent || request?.requestedLabel || "الاشتراك";
      const ok = await this.app.services.modal.confirm({
        title: "تأكيد التفعيل",
        message: `هل تأكدت من وصول التحويل باسم "${request?.customerName || "المستخدم"}" وتريد تحويل الكود إلى ${selectedLabel}؟`,
        confirmLabel: "نعم، فعّل الاشتراك",
        cancelLabel: "إلغاء"
      });
      if (!ok) return;
      try {
        const result = await this.app.services.license.approveActivationRequest(button.dataset.approveRequest, select.value, accessSelect?.value || "admin", request?.teacherSlots);
        if (result.ok && request?.code) await this.applyAccessModeForCurrentDevice(request.code, accessSelect?.value || "admin");
        this.app.services.toast.show(result.message, result.ok ? "success" : "error");
        await this.render();
      } catch {
        this.app.services.toast.show("تعذر تفعيل الطلب الآن. تحقق من الاتصال ثم حاول مرة أخرى", "error");
      }
    }));

    qs("#admin-pin-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.target));
      try {
        const changed = await this.app.services.license.changeAdminPin(data.currentPin, data.nextPin);
        if (!changed) {
          this.app.services.toast.show("كلمة المرور الحالية غير صحيحة", "error");
          return;
        }
      } catch {
        this.app.services.toast.show("تعذر حفظ كلمة المرور في Supabase. تأكد من جدول admin_settings", "error");
        return;
      }
      this.app.services.toast.show("تم تغيير كلمة مرور لوحة الإدارة", "success");
      event.target.reset();
    });

    renderIcons();
  }

  async saveAccessModeForCode(code, accessMode) {
    const result = await this.app.services.license.updateLicenseAccessMode(code, accessMode);
    if (!result.ok) return result;
    const normalizedCode = normalizeCode(code);
    this.generatedCodes = this.generatedCodes.map((item) => normalizeCode(item.code) === normalizedCode ? { ...item, accessMode } : item);
    localStorage.setItem("yusr-generated-codes-v1", JSON.stringify(this.generatedCodes));
    await this.applyAccessModeForCurrentDevice(code, accessMode);
    return result;
  }

  async applyAccessModeForCurrentDevice(code, accessMode) {
    const active = this.app.services.license.getActiveLicense();
    if (!active || normalizeCode(active.code) !== normalizeCode(code)) return;
    await this.app.services.store.updateSettings({
      accessMode,
      readOnlyMode: accessMode === "readonly"
    });
    document.dispatchEvent(new CustomEvent("yusr-access-mode-updated", { detail: { accessMode } }));
  }

  async updateSiteViewsCount() {
    try {
      const count = await this.app.services.license.getSiteViewsCount();
      const target = qs("#site-views-count");
      if (target) target.textContent = new Intl.NumberFormat("ar-SA").format(count);
    } catch {
      const target = qs("#site-views-count");
      if (target) target.textContent = new Intl.NumberFormat("ar-SA").format(this.app.services.license.getLocalSiteViewsCount());
    }
  }

  bindAdminSectionTabs() {
    const active = localStorage.getItem("yusr-admin-section-v1") || "requests";
    this.applyAdminSection(active);
    document.querySelectorAll("[data-admin-section-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        localStorage.setItem("yusr-admin-section-v1", button.dataset.adminSectionTab);
        this.applyAdminSection(button.dataset.adminSectionTab);
      });
    });
  }

  applyAdminSection(section) {
    document.querySelectorAll("[data-admin-section]").forEach((item) => {
      item.hidden = item.dataset.adminSection !== section;
    });
    const grid = qs(".license-grid");
    if (grid) grid.hidden = !["create", "pin", "views"].includes(section);
    document.querySelectorAll("[data-admin-section-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.adminSectionTab === section);
    });
  }

  readinessChecks() {
    const settings = this.app.services.store.getSettings();
    const subjects = this.app.services.store.getSubjects();
    const activeLicense = this.app.services.license.getActiveLicense();
    const hasBackupData = Boolean(localStorage.getItem("yusr-app-state-v1"));
    const hasPwa = Boolean(document.querySelector('link[rel="manifest"]')) && "serviceWorker" in navigator;
    const notificationState = "Notification" in window ? Notification.permission : "unsupported";
    const canPrint = typeof window.print === "function";
    const hasAccessModes = ["admin", "teacher", "delegate", "readonly"].includes(settings.accessMode || "admin");
    return [
      {
        icon: "smartphone",
        title: "اختبار الجوال",
        ok: matchMedia("(max-width: 860px)").matches || hasPwa,
        message: hasPwa ? "PWA والخدمة الخلفية موجودة. اختبرها مرة من هاتف حقيقي بعد الرفع." : "افتح الرابط من الهاتف وتأكد من التحضير والكشف والدرجات."
      },
      {
        icon: "database",
        title: "Supabase",
        ok: isSupabaseConfigured(),
        message: isSupabaseConfigured() ? "بيانات Supabase مفعلة في المشروع." : "أضف بيانات Supabase حتى تعمل الأكواد والصلاحيات فعليًا."
      },
      {
        icon: "shield-check",
        title: "الصلاحيات",
        ok: hasAccessModes,
        message: "المشرف، المعلم، المندوب، والقراءة فقط مفعلة وتُطبّق تلقائيًا عند تغيير الكود."
      },
      {
        icon: "archive",
        title: "النسخ الاحتياطي",
        ok: hasBackupData,
        message: hasBackupData ? "يوجد ملف بيانات محلي يمكن تصديره من الإعدادات." : "جرّب إضافة بيانات ثم تصدير نسخة احتياطية واستيرادها."
      },
      {
        icon: "file-text",
        title: "PDF والطباعة",
        ok: canPrint,
        message: "التصدير يستخدم A4، والكشف الشهري بالعرض، والتاريخ يتبع إعداد ميلادي/هجري."
      },
      {
        icon: "key-round",
        title: "الاشتراك والتفعيل",
        ok: Boolean(activeLicense),
        message: activeLicense ? `الكود الحالي فعال حتى ${this.formatDate(activeLicense.expiresAt)}.` : "اختبر كود مؤقت ثم حوّله من طلبات التفعيل."
      },
      {
        icon: "wallet-cards",
        title: "صفحة طلب التفعيل",
        ok: true,
        message: "تحتوي على الأسعار، طرق الدفع، اسم المحول، كود مؤقت، وطلب يظهر في لوحة الإدارة."
      },
      {
        icon: "bell",
        title: "الإشعارات",
        ok: notificationState === "granted",
        message: notificationState === "granted" ? "صلاحية الإشعارات ممنوحة." : "فعّلها من الإعدادات بعد تثبيت التطبيق أو فتحه عبر HTTPS."
      },
      {
        icon: "lock",
        title: "الأمان",
        ok: isSupabaseConfigured(),
        message: "الحماية الحالية تعتمد على Supabase. للنسخة التجارية الأقوى أضف لاحقًا Edge Functions."
      },
      {
        icon: "cloud-upload",
        title: "الرفع والتحديث",
        ok: hasPwa,
        message: "بعد كل تعديل ارفع نفس المجلد إلى Cloudflare Pages وتأكد من ظهور النسخة الجديدة."
      }
    ];
  }

  readinessScore() {
    const checks = this.readinessChecks();
    return Math.round((checks.filter((item) => item.ok).length / checks.length) * 100);
  }

  async loadActivationRequests() {
    try {
      return await this.app.services.license.listActivationRequests();
    } catch {
      return this.app.services.license.listLocalActivationRequests();
    }
  }

  async loadPricing() {
    try {
      return await this.app.services.license.loadRemoteActivationPricing();
    } catch {
      return this.app.services.license.getActivationPricing();
    }
  }

  async refreshRemoteCodes() {
    if (!isSupabaseConfigured()) return;
    try {
      const remoteCodes = await this.app.services.license.listRemoteLicenses();
      const remoteItems = remoteCodes
        .filter((item) => item.status !== "revoked" && !isExpiredLicense(item.expires_at))
        .map((item) => ({
          code: item.code,
          plan: item.plan,
          expiresAt: item.expires_at,
          durationLabel: item.duration_label,
          accessMode: item.access_mode || accessModeFromDurationLabel(item.duration_label) || "admin",
          teacherSlots: Number(item.teacher_slots || 0),
          ownerName: item.owner_name || ownerNameFromDurationLabel(item.duration_label),
          status: item.status,
          deviceId: item.device_id,
          createdAt: item.created_at
        }));
      const localOnly = this.generatedCodes.filter((local) => !isExpiredLicense(local.expiresAt) && !remoteItems.some((remote) => remote.code === local.code));
      this.generatedCodes = [...remoteItems, ...localOnly];
    } catch {
      this.app.services.toast.show("جدول licenses غير موجود في Supabase. شغّل ملف docs/supabase-licenses.sql", "error");
    }
  }

  renderLogin() {
    qs("#view").innerHTML = `
      <section class="license-page">
        <article class="license-card glass-panel">
          <img class="license-logo" src="./assets/yusr-logo.png" alt="" />
          <span class="eyebrow">لوحة الإدارة</span>
          <h2>دخول لوحة الإدارة</h2>
          <form class="form-grid" id="admin-login-form">
            <label>رمز لوحة الإدارة<input name="pin" type="password" inputmode="numeric" placeholder="رمز لوحة الإدارة" required /></label>
            <button class="primary-button"><i data-lucide="lock-keyhole"></i>دخول</button>
          </form>
        </article>
      </section>
    `;
    qs("#admin-login-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.target));
      if (!(await this.app.services.license.adminLogin(data.pin))) {
        this.app.services.toast.show("رمز لوحة الإدارة غير صحيح", "error");
        return;
      }
      this.render();
    });
    renderIcons();
  }

  async revokeCode(code) {
    const ok = await this.app.services.modal.confirm({
      title: "حذف كود التفعيل",
      message: "هل تريد حذف هذا الكود؟ إذا كان Supabase مفعلا سيتم إيقافه عند العميل أيضا.",
      confirmLabel: "حذف الكود"
    });
    if (!ok) return;
    let remoteRevoked = false;
    if (isSupabaseConfigured()) {
      try {
        await this.app.services.license.revokeRemoteLicense(code);
        remoteRevoked = true;
      } catch {
        this.app.services.toast.show("اختفى الكود من اللوحة، لكن تعذر إيقافه أونلاين. تأكد من جدول Supabase.", "error");
      }
    }
    this.generatedCodes = this.generatedCodes.filter((item) => item.code !== code);
    localStorage.setItem("yusr-generated-codes-v1", JSON.stringify(this.generatedCodes));
    if (remoteRevoked) this.app.services.toast.show("تم حذف الكود وإيقافه", "success");
    else if (!isSupabaseConfigured()) this.app.services.toast.show("تم حذف الكود من اللوحة محليًا", "success");
    await this.render();
  }

  async copy(text) {
    if (!text || text.includes("لم يتم")) return;
    try {
      if (navigator.clipboard) await navigator.clipboard.writeText(text);
      else this.fallbackCopy(text);
    } catch {
      this.fallbackCopy(text);
    }
    this.app.services.toast.show("تم نسخ الكود", "success");
  }

  fallbackCopy(text) {
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

  durationLabel(value, unit) {
    const labels = { days: "أيام", weeks: "أسابيع", months: "شهور" };
    return `${value} ${labels[unit] || "شهور"}`;
  }

  requestPriceLabel(request, plan = request?.requestedPlan) {
    const quote = this.app.services.license.calculateActivationPrice(
      request?.accountRole || request?.accessMode || "teacher",
      plan || request?.requestedPlan || "month",
      request?.teacherSlots ?? 0,
      request?.currency || "SAR"
    );
    return quote.label;
  }

  requestDurationOptions(request) {
    const role = request?.accountRole || request?.accessMode || "teacher";
    const options = role === "admin"
      ? [["month", "شهر"], ["year", "سنة"]]
      : [["week", "أسبوع"], ["month", "شهر"], ["year", "سنة"]];
    const selected = request?.requestedPlan || (role === "admin" ? "month" : "week");
    return options.map(([value, label]) => {
      const price = this.requestPriceLabel(request, value);
      return `<option value="${value}" ${value === selected ? "selected" : ""}>${label} - ${price}</option>`;
    }).join("");
  }

  formatDate(value, dateStyle = "medium") {
    const settings = this.app.services.store.getSettings();
    const calendar = settings.dateCalendar === "islamic" ? "islamic-umalqura" : "gregory";
    return new Intl.DateTimeFormat("ar-SA", { dateStyle, calendar }).format(new Date(value));
  }
}

function licenseStatus(item) {
  if (item.status === "revoked") return `<span class="status-badge status-absent">محذوف</span>`;
  if (item.deviceId) return `<span class="status-badge status-present">مستخدم</span>`;
  return `<span class="status-badge status-empty">غير مستخدم</span>`;
}

function requestStatus(item) {
  if (item.status === "approved") return `<span class="status-badge status-present">تم التفعيل</span>`;
  if (item.status === "payment_review") return `<span class="status-badge status-late">تحقق من الدفع</span>`;
  if (item.status === "unpaid") return `<span class="status-badge status-absent">لم يتم الدفع</span>`;
  return `<span class="status-badge status-late">بانتظار التحقق</span>`;
}

function isClosedRequest(item = {}) {
  return ["approved", "unpaid", "expired", "rejected"].includes(item.status);
}

function isRenewalRequest(item = {}) {
  return item.requestKind === "renewal"
    || String(item.requestedLabel || "").includes("إعادة تفعيل")
    || String(item.statusLabel || "").includes("إعادة تفعيل");
}

function requestPaymentHint(item) {
  if (item.status === "approved") return "تمت مراجعة الدفع وتحويل الكود";
  if (item.status === "payment_review") return "محاولة دفع ثانية: لا تفتح التطبيق إلا بعد اعتماد صاحب التطبيق";
  if (item.status === "unpaid") return "تم رفض التجديد لأن الدفع لم يصل";
  return "راجع اسم المحول وحدد الصلاحية قبل التفعيل";
}

function requestActionLabel(item) {
  if (item.status === "approved") return "تم التفعيل";
  if (item.status === "payment_review") return "اعتماد الدفع";
  if (item.status === "unpaid") return "بانتظار دفع جديد";
  return "تفعيل الحساب";
}

function isManagerRequest(item) {
  return (item?.accountRole || item?.accessMode) === "admin";
}

function cleanDurationLabel(value = "") {
  return String(value || "").split("|| YUSR_META:")[0].trim();
}

function codeOwnerName(item = {}) {
  const name = item.ownerName || item.customerName || ownerNameFromDurationLabel(item.durationLabel);
  return escapeAttribute(name || "غير محدد");
}

function ownerNameFromDurationLabel(value = "") {
  const marker = "YUSR_META:";
  const raw = String(value || "");
  const index = raw.indexOf(marker);
  if (index === -1) return "";
  try {
    const json = decodeURIComponent(escape(atob(raw.slice(index + marker.length).trim())));
    return String(JSON.parse(json)?.ownerName || "").trim();
  } catch {
    return "";
  }
}

function accessModeFromDurationLabel(value = "") {
  const meta = licenseMetaFromDurationLabel(value);
  return ["admin", "teacher", "delegate", "readonly"].includes(meta.accessMode) ? meta.accessMode : "";
}

function licenseMetaFromDurationLabel(value = "") {
  const marker = "YUSR_META:";
  const raw = String(value || "");
  const index = raw.indexOf(marker);
  if (index === -1) return {};
  try {
    const json = decodeURIComponent(escape(atob(raw.slice(index + marker.length).trim())));
    return JSON.parse(json) || {};
  } catch {
    return {};
  }
}

function displayCode(value = "") {
  const raw = String(value || "");
  if (/<\/?(title|html|head|body|script|style)\b/i.test(raw) || raw.toLowerCase().includes("<!doctype")) {
    return "كود غير صالح - احذفه وأنشئ كودًا جديدًا";
  }
  if (raw.startsWith("YUSR_META:")) return "بيانات صلاحية داخلية - استخدم زر النسخ عند الحاجة";
  return raw;
}

function escapeAttribute(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function planPriceLabel(plan) {
  const prices = {
    week: "15 ريال سعودي",
    month: "35 ريال سعودي",
    quarter: "حسب الاتفاق",
    year: "200 ريال سعودي"
  };
  return prices[plan] || "حسب الاختيار";
}

function pricingGroup(role, title, values, fields) {
  const nameMap = {
    teacher: "teacher",
    admin: "admin",
    delegate: "delegate"
  };
  const keyPrefix = nameMap[role];
  return `
    <section class="pricing-card">
      <h4>${title}</h4>
      <div class="pricing-input-grid">
        ${fields.map(([key, label]) => {
          const inputName = `${keyPrefix}${key.charAt(0).toUpperCase()}${key.slice(1)}`;
          return `
            <label>${label}
              <div class="price-input">
                <input class="field" name="${inputName}" type="number" min="0" value="${Number(values?.[key] || 0)}" required />
                <span>ريال</span>
              </div>
            </label>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function requestDurationOptions(selected) {
  const options = [
    ["week", "أسبوع"],
    ["month", "شهر"],
    ["quarter", "3 أشهر"],
    ["year", "سنة"]
  ];
  return options.map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join("");
}

function accessModeOptions(selected = "admin") {
  const options = [
    ["admin", "مشرف"],
    ["teacher", "معلم"],
    ["delegate", "مندوب تحضير"],
    ["readonly", "قراءة فقط"]
  ];
  return options.map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join("");
}

function accessModeLabel(value = "admin") {
  const labels = {
    admin: "مشرف",
    teacher: "معلم",
    delegate: "مندوب تحضير",
    readonly: "قراءة فقط"
  };
  return labels[value] || labels.admin;
}

function normalizeCode(code) {
  return String(code || "").trim().toUpperCase();
}

function isExpiredLicense(value) {
  if (!value) return false;
  return new Date(value) < startOfToday();
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}
