import { isSupabaseConfigured, supabaseConfig } from "../supabase-config.js?v=25";

const ACTIVE_LICENSE_KEY = "yusr-active-license-v1";
const ADMIN_SESSION_KEY = "yusr-admin-session-v1";
const ADMIN_PIN_KEY = "yusr-admin-pin-v1";
const DEVICE_KEY = "yusr-device-id-v1";
const LOCAL_VIEWS_KEY = "yusr-site-views-v1";
const SESSION_VIEW_KEY = "yusr-session-view-recorded-v1";
const FREE_TRIAL_KEY = "yusr-free-trial-used-v1";
const LOCAL_REQUESTS_KEY = "yusr-activation-requests-v1";
const PAYMENT_ATTEMPTS_KEY = "yusr-payment-attempts-v1";
const ACTIVATION_PRICING_KEY = "yusr-activation-pricing-v1";
const MANAGED_TEACHERS_KEY = "yusr-managed-teacher-codes-v1";
const MANAGED_ACCOUNT_DATA_KEY = "yusr-managed-account-data-v1";
const PROFILE_NAME_OVERRIDES_KEY = "yusr-profile-name-overrides-v1";
const LICENSE_SECRET = "YUSR-LICENSE-LOCAL-2026";
const DEFAULT_ADMIN_PIN = "1122";
const ADMIN_SETTING_ID = "admin_pin";
const PRICING_SETTING_ID = "activation_pricing";
const CURRENCY_RATES = {
  SAR: { id: "SAR", label: "ريال سعودي", rate: 1 },
  YER: { id: "YER", label: "ريال يمني", rate: 140 }
};
const DEFAULT_ACTIVATION_PRICING = {
  teacher: { week: 15, month: 15, year: 200 },
  admin: { month: 15, year: 200, extraTeacherMonth: 10, extraTeacherYear: 120 },
  delegate: { week: 10, month: 25, year: 120 }
};

export class LicenseService {
  constructor() {
    // كل جهاز يحصل على معرف ثابت محليًا حتى لا يستخدم نفس الكود على أكثر من جهاز.
    this.ensureDeviceId();
    if (!localStorage.getItem(ADMIN_PIN_KEY)) localStorage.setItem(ADMIN_PIN_KEY, DEFAULT_ADMIN_PIN);
  }

  getDeviceId() {
    return localStorage.getItem(DEVICE_KEY);
  }

  ensureDeviceId() {
    if (!localStorage.getItem(DEVICE_KEY)) {
      localStorage.setItem(DEVICE_KEY, crypto.randomUUID());
    }
  }

  recordSiteView(path = location.hash || "#/activate") {
    if (sessionStorage.getItem(SESSION_VIEW_KEY)) return;
    sessionStorage.setItem(SESSION_VIEW_KEY, "true");
    localStorage.setItem(LOCAL_VIEWS_KEY, String(this.getLocalSiteViewsCount() + 1));
    if (!isSupabaseConfigured()) return;
    this.supabaseRequest("", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: crypto.randomUUID(),
        device_id: this.getDeviceId(),
        path,
        created_at: new Date().toISOString()
      })
    }, "site_views").catch(() => {});
  }

  getLocalSiteViewsCount() {
    return Number(localStorage.getItem(LOCAL_VIEWS_KEY) || "0");
  }

  async getSiteViewsCount() {
    if (!isSupabaseConfigured()) return this.getLocalSiteViewsCount();
    const response = await fetch(`${supabaseConfig.url}/rest/v1/site_views?select=id`, {
      headers: {
        apikey: supabaseConfig.anonKey,
        Authorization: `Bearer ${supabaseConfig.anonKey}`,
        Prefer: "count=exact",
        Range: "0-0"
      }
    });
    if (!response.ok) throw new Error("تعذر تحميل عدد المشاهدات");
    const range = response.headers.get("content-range") || "";
    const count = Number(range.split("/")[1]);
    return Number.isFinite(count) ? count : this.getLocalSiteViewsCount();
  }

  isActive() {
    const license = this.getActiveLicense();
    if (!license) return false;
    return new Date(license.expiresAt) >= startOfToday();
  }

  async checkAccess() {
    const active = this.getActiveLicense();
    if (!active) return false;
    // عند عدم إعداد Supabase نتحقق من التاريخ المحلي فقط حتى يعمل التطبيق بدون خادم.
    if (!isSupabaseConfigured()) {
      if (new Date(active.expiresAt) < startOfToday()) {
        this.deactivate();
        return false;
      }
      return true;
    }
    // مع Supabase نراجع حالة الكود من قاعدة البيانات: فعال، منتهي، محذوف، أو مستخدم بجهاز آخر.
    const remote = await this.getRemoteLicense(active.code);
    if (!remote || remote.status !== "active") {
      this.deactivate();
      return false;
    }
    if (remote.device_id && remote.device_id !== this.getDeviceId()) {
      this.deactivate();
      return false;
    }
    if (!remote.device_id) {
      await this.updateRemoteLicense(active.code, {
        device_id: this.getDeviceId(),
        activated_at: active.activatedAt || new Date().toISOString()
      }).catch(() => {});
    }
    if (new Date(remote.expires_at) < startOfToday()) {
      this.deactivate();
      return false;
    }
    const meta = parseLicenseMeta(remote.duration_label);
    const teacherSlots = await this.resolveRemoteTeacherSlots(active.code, remote, active.teacherSlots || meta.teacherSlots);
    const accessMode = await this.resolveRemoteAccessMode(active.code, remote, active.accessMode);
    const ownerName = String(this.getProfileNameOverride(active.code) || remote.owner_name || active.ownerName || meta.ownerName || active.customerName || "").trim();
    localStorage.setItem(ACTIVE_LICENSE_KEY, JSON.stringify({
      code: active.code,
      plan: remote.plan,
      serial: active.serial || remote.serial || "",
      expiresAt: remote.expires_at,
      activatedAt: active.activatedAt || remote.activated_at || new Date().toISOString(),
      deviceId: this.getDeviceId(),
      accessMode,
      ownerName,
      teacherSlots,
      parentCode: remote.parent_code || active.parentCode || meta.parentCode || null,
      permissions: parsePermissions(remote.permissions) || active.permissions || meta.permissions || defaultPermissionsForMode(accessMode)
    }));
    return true;
  }

  getActiveLicense() {
    const active = JSON.parse(localStorage.getItem(ACTIVE_LICENSE_KEY) || "null");
    if (!active) return null;
    const localLicense = this.findLocalGeneratedLicense(active.code);
    const profileOverride = this.getProfileNameOverride(active.code);
    if (profileOverride && active.ownerName !== profileOverride) {
      const patched = { ...active, ownerName: profileOverride, customerName: profileOverride };
      localStorage.setItem(ACTIVE_LICENSE_KEY, JSON.stringify(patched));
      return patched;
    }
    if (localLicense && (!active.parentCode || !active.ownerName)) {
      // ترقية بيانات قديمة: إذا كان الكود تابعًا لكن النسخة المحفوظة لا تحمل parentCode نكملها من سجل الأكواد.
      const patched = {
        ...active,
        parentCode: active.parentCode || localLicense.parentCode || null,
        ownerName: active.ownerName || localLicense.ownerName || "",
        teacherSlots: Math.max(0, Number(active.teacherSlots || localLicense.teacherSlots || 0)),
        permissions: active.permissions || localLicense.permissions || defaultPermissionsForMode(localLicense.accessMode)
      };
      localStorage.setItem(ACTIVE_LICENSE_KEY, JSON.stringify(patched));
      return patched;
    }
    return active;
  }

  listProfileNameOverrides() {
    try {
      const value = JSON.parse(localStorage.getItem(PROFILE_NAME_OVERRIDES_KEY) || "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  getProfileNameOverride(code) {
    const normalizedCode = normalizeCode(code);
    if (!normalizedCode) return "";
    return String(this.listProfileNameOverrides()[normalizedCode] || "").trim();
  }

  setProfileNameOverride(code, name) {
    const normalizedCode = normalizeCode(code);
    const cleanName = String(name || "").trim();
    if (!normalizedCode || !cleanName) return;
    const overrides = this.listProfileNameOverrides();
    overrides[normalizedCode] = cleanName;
    localStorage.setItem(PROFILE_NAME_OVERRIDES_KEY, JSON.stringify(overrides));
  }

  async updateActiveOwnerName(name) {
    const active = this.getActiveLicense();
    const cleanName = String(name || "").trim();
    if (!active || !cleanName) return { ok: false, message: "اكتب الاسم أولاً" };
    this.setProfileNameOverride(active.code, cleanName);
    const patchedActive = { ...active, ownerName: cleanName, customerName: cleanName };
    localStorage.setItem(ACTIVE_LICENSE_KEY, JSON.stringify(patchedActive));
    const localLicense = this.findLocalGeneratedLicense(active.code);
    if (localLicense) {
      this.upsertLocalGeneratedCodes([{ ...localLicense, ownerName: cleanName }]);
    }
    if (isSupabaseConfigured() && isBrowserOnline()) {
      const remote = await this.getRemoteLicense(active.code).catch(() => null);
      const labelWithMeta = attachLicenseMeta(remote?.duration_label || active.durationLabel || "", {
        accessMode: active.accessMode,
        parentCode: active.parentCode,
        ownerName: cleanName,
        permissions: active.permissions,
        teacherSlots: active.teacherSlots || 0
      });
      await this.updateRemoteLicense(active.code, {
        owner_name: cleanName,
        duration_label: labelWithMeta
      }).catch((error) => {
        if (!isAccessModeSchemaError(error)) return;
        return this.updateRemoteLicense(active.code, { duration_label: labelWithMeta }).catch(() => {});
      });
    }
    return { ok: true, message: "تم تحديث اسم الحساب" };
  }

  activateTemporaryRequest(request) {
    const result = this.validateCode(request?.code);
    if (!result.valid) return result;
    // الكود المؤقت يفتح التطبيق ليوم واحد حتى يراجع صاحب التطبيق عملية الدفع.
    const accessMode = normalizeAccessMode(request.accessMode || request.accountRole || "teacher");
    const permissions = request.permissions || defaultPermissionsForMode(accessMode);
    const ownerName = this.getProfileNameOverride(request?.code) || request.ownerName || request.customerName || "";
    localStorage.setItem(ACTIVE_LICENSE_KEY, JSON.stringify({
      code: normalizeCode(request.code),
      plan: "TEMP",
      serial: result.serial,
      expiresAt: result.expiresAt,
      activatedAt: new Date().toISOString(),
      deviceId: this.getDeviceId(),
      accessMode,
      ownerName,
      teacherSlots: Math.max(0, Number(request.teacherSlots || 0)),
      parentCode: null,
      permissions,
      customerName: request.customerName || ""
    }));
    return { valid: true, message: "تم تفعيل الكود المؤقت لمدة يوم واحد", accessMode, ownerName };
  }

  async activate(code) {
    if (isSupabaseConfigured()) return this.activateRemote(code);
    // fallback محلي للتجربة أو العمل بدون Supabase.
    const result = this.validateCode(code);
    if (!result.valid) return result;
    const localLicense = this.findLocalGeneratedLicense(normalizeCode(code));
    const accessMode = normalizeAccessMode(localLicense?.accessMode);
    const ownerName = String(this.getProfileNameOverride(code) || localLicense?.ownerName || "").trim();
    // إذا كان الكود تابعًا لمشرف، نحفظ parentCode حتى تظهر أدوات التصدير والمتابعة الخاصة بالمشرف.
    localStorage.setItem(ACTIVE_LICENSE_KEY, JSON.stringify({
      code: normalizeCode(code),
      plan: result.plan,
      serial: result.serial,
      expiresAt: result.expiresAt,
      activatedAt: new Date().toISOString(),
      deviceId: this.getDeviceId(),
      accessMode,
      ownerName,
      parentCode: localLicense?.parentCode || null,
      teacherSlots: Math.max(0, Number(localLicense?.teacherSlots || 0)),
      permissions: localLicense?.permissions || defaultPermissionsForMode(accessMode)
    }));
    return { valid: true, message: "تم تفعيل التطبيق بنجاح", accessMode, ownerName };
  }

  hasUsedFreeTrial() {
    return localStorage.getItem(FREE_TRIAL_KEY) === "true";
  }

  async startFreeTrial() {
    if (this.hasUsedFreeTrial()) {
      return { valid: false, message: "تم استخدام التجربة المجانية مسبقًا على هذا الجهاز" };
    }
    const code = this.generateCode({ plan: "TRIAL", duration: 1, durationUnit: "days" });
    const validation = this.validateCode(code);
    if (isSupabaseConfigured()) {
      await this.createRemoteLicense({
        code,
        plan: "TRIAL",
        expiresAt: validation.expiresAt,
        durationLabel: "استخدام مجاني ليوم واحد",
        status: "active",
        deviceId: this.getDeviceId(),
        activatedAt: new Date().toISOString(),
        accessMode: "admin"
      }).catch(() => {});
    }
    localStorage.setItem(FREE_TRIAL_KEY, "true");
    localStorage.setItem(ACTIVE_LICENSE_KEY, JSON.stringify({
      code,
      plan: "TRIAL",
      serial: validation.serial,
      expiresAt: validation.expiresAt,
      activatedAt: new Date().toISOString(),
      deviceId: this.getDeviceId(),
      accessMode: "admin"
    }));
    return { valid: true, message: "تم تفعيل الاستخدام المجاني لمدة يوم واحد فقط", accessMode: "admin" };
  }

  async activateRemote(code) {
    const normalized = normalizeCode(code);
    const remote = await this.getRemoteLicense(normalized);
    if (!remote) return { valid: false, message: "كود التفعيل غير موجود" };
    if (remote.status !== "active") return { valid: false, message: "هذا الكود موقوف أو محذوف" };
    if (new Date(remote.expires_at) < startOfToday()) return { valid: false, message: "انتهت صلاحية كود التفعيل" };
    if (remote.device_id && remote.device_id !== this.getDeviceId()) {
      return { valid: false, message: "هذا الكود مستخدم على جهاز آخر" };
    }
    const activatedAt = remote.activated_at || new Date().toISOString();
    if (!remote.device_id) {
      await this.updateRemoteLicense(normalized, {
        device_id: this.getDeviceId(),
        activated_at: activatedAt
      }).catch(() => {});
    }
    const accessMode = await this.resolveRemoteAccessMode(normalized, remote, "teacher");
    const teacherSlots = await this.resolveRemoteTeacherSlots(normalized, remote, 0);
    const meta = parseLicenseMeta(remote.duration_label);
    const finalAccessMode = accessModeFromRemoteRow(remote, accessMode);
    const permissions = parsePermissions(remote.permissions) || meta.permissions || defaultPermissionsForMode(finalAccessMode);
    const ownerName = String(this.getProfileNameOverride(normalized) || remote.owner_name || meta.ownerName || "").trim();
    const parentCode = remote.parent_code || meta.parentCode || null;
    // الاسم الذي يكتبه المشرف عند إنشاء الكود يُحفظ هنا ليظهر في حساب المعلم أو المندوب.
    const activeLicense = {
      code: normalized,
      plan: remote.plan,
      serial: remote.serial || "",
      expiresAt: remote.expires_at,
      activatedAt,
      deviceId: this.getDeviceId(),
      accessMode: finalAccessMode,
      ownerName,
      teacherSlots,
      parentCode,
      permissions
    };
    localStorage.setItem(ACTIVE_LICENSE_KEY, JSON.stringify(activeLicense));
    if (parentCode) {
      const managedItem = {
        ...activeLicense,
        status: remote.status || "active",
        durationLabel: remote.duration_label || "",
        createdAt: remote.created_at || "",
        accessMode: finalAccessMode
      };
      this.upsertLocalGeneratedCodes([managedItem]);
      this.saveLocalManagedCodesForParent(parentCode, [managedItem, ...this.listManagedCodes(parentCode)]);
    }
    return { valid: true, message: "تم تفعيل التطبيق بنجاح", accessMode: finalAccessMode, ownerName };
  }

  deactivate() {
    localStorage.removeItem(ACTIVE_LICENSE_KEY);
  }

  validateCode(code) {
    const normalized = normalizeCode(code);
    const parts = normalized.split("-");
    if (parts.length !== 5 || parts[0] !== "YUSR") return { valid: false, message: "صيغة الكود غير صحيحة" };
    const [, plan, expiry, serial, checksum] = parts;
    if (!/^\d{8}$/.test(expiry)) return { valid: false, message: "تاريخ الكود غير صحيح" };
    const expected = licenseChecksum(plan, expiry, serial);
    if (checksum !== expected) return { valid: false, message: "كود التفعيل غير صحيح" };
    const expiresAt = parseExpiry(expiry);
    if (new Date(expiresAt) < startOfToday()) return { valid: false, message: "انتهت صلاحية كود التفعيل" };
    return { valid: true, plan, serial, expiresAt };
  }

  generateCode({ plan = "PRO", duration = 12, durationUnit = "months" } = {}) {
    const expiry = new Date();
    const amount = Number(duration || 1);
    if (durationUnit === "days") expiry.setDate(expiry.getDate() + amount);
    else if (durationUnit === "weeks") expiry.setDate(expiry.getDate() + amount * 7);
    else expiry.setMonth(expiry.getMonth() + amount);
    const expiryPart = expiry.toISOString().slice(0, 10).replaceAll("-", "");
    const serial = randomSerial();
    const normalizedPlan = String(plan || "PRO").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "PRO";
    return `YUSR-${normalizedPlan}-${expiryPart}-${serial}-${licenseChecksum(normalizedPlan, expiryPart, serial)}`;
  }

  async createRemoteLicense({ code, plan, expiresAt, durationLabel, status = "active", deviceId = null, activatedAt = null, accessMode = "admin", teacherSlots = 0, parentCode = null, permissions = null, ownerName = "" }) {
    if (!isSupabaseConfigured()) return { ok: false, message: "Supabase غير مفعل" };
    const cleanedAccessMode = normalizeAccessMode(accessMode);
    const cleanedPermissions = permissions || defaultPermissionsForMode(cleanedAccessMode);
    const labelWithMeta = attachLicenseMeta(durationLabel, {
      accessMode: cleanedAccessMode,
      parentCode,
      ownerName,
      permissions: cleanedPermissions,
      teacherSlots
    });
    // صف الترخيص في Supabase يمثل كودًا واحدًا: نوع الحساب، المدة، الجهاز، والصلاحيات.
    const row = {
      code,
      plan,
      status,
      expires_at: expiresAt,
      duration_label: labelWithMeta,
      device_id: deviceId,
      activated_at: activatedAt,
      access_mode: cleanedAccessMode,
      teacher_slots: Number(teacherSlots || 0),
      permissions: JSON.stringify(cleanedPermissions),
      owner_name: String(ownerName || "").trim(),
      parent_code: parentCode,
      created_at: new Date().toISOString()
    };
    await this.supabaseRequest("", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(row)
    }).catch((error) => {
      if (!isAccessModeSchemaError(error)) throw error;
      const fallbackRow = { ...row };
      delete fallbackRow.access_mode;
      delete fallbackRow.teacher_slots;
      delete fallbackRow.permissions;
      delete fallbackRow.owner_name;
      delete fallbackRow.parent_code;
      return this.supabaseRequest("", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(fallbackRow)
      });
    });
    return { ok: true };
  }

  async resolveRemoteTeacherSlots(code, remote = null, fallback = 0) {
    const direct = Number(remote?.teacher_slots ?? 0);
    const fallbackNumber = Number(fallback || 0);
    if (!isSupabaseConfigured()) return Math.max(0, direct, fallbackNumber);
    const requestSlots = await this.getActivationRequestTeacherSlots(code).catch(() => 0);
    return Math.max(0, direct, fallbackNumber, requestSlots);
  }

  async getActivationRequestTeacherSlots(code) {
    if (!isSupabaseConfigured()) return 0;
    let rows = [];
    try {
      rows = await this.supabaseRequest(`?code=eq.${encodeURIComponent(normalizeCode(code))}&select=teacher_slots,requested_label,requested_role,access_mode&limit=1`, {}, "activation_requests");
    } catch {
      rows = await this.supabaseRequest(`?code=eq.${encodeURIComponent(normalizeCode(code))}&select=*&limit=1`, {}, "activation_requests");
    }
    const row = rows[0];
    if (!row) return 0;
    return Math.max(Number(row.teacher_slots ?? 0), parseTeacherSlots(row.requested_label));
  }

  async getActivationRequestAccessMode(code) {
    if (!isSupabaseConfigured()) return null;
    let rows = [];
    try {
      rows = await this.supabaseRequest(`?code=eq.${encodeURIComponent(normalizeCode(code))}&select=access_mode,requested_role&limit=1`, {}, "activation_requests");
    } catch {
      return null;
    }
    const row = rows?.[0];
    if (!row) return null;
    const requestedRoleMode = row?.requested_role ? activationRoleMeta(row.requested_role).accessMode : "";
    const mode = normalizeAccessMode(requestedRoleMode || row?.access_mode);
    return mode || null;
  }

  async resolveRemoteAccessMode(code, remote, fallbackMode = "teacher") {
    const fromRequest = await this.getActivationRequestAccessMode(code).catch(() => null);
    if (fromRequest) return fromRequest;
    const meta = parseLicenseMeta(remote?.duration_label);
    const fromMeta = normalizeAccessMode(meta.accessMode);
    if (["teacher", "delegate", "readonly"].includes(fromMeta)) return fromMeta;
    const explicit = normalizeAccessMode(remote?.access_mode);
    if (["teacher", "delegate", "readonly"].includes(explicit)) return explicit;
    const fromPlan = accessModeFromPlan(remote?.plan);
    if (fromPlan) return fromPlan;
    if (["teacher", "delegate"].includes(fallbackMode) && explicit === "admin") {
      return fallbackMode;
    }
    return normalizeAccessMode(remote?.access_mode || fallbackMode);
  }

  getActivationPricing() {
    const saved = JSON.parse(localStorage.getItem(ACTIVATION_PRICING_KEY) || "null");
    return normalizePricing(saved);
  }

  async loadRemoteActivationPricing() {
    if (!isSupabaseConfigured()) return this.getActivationPricing();
    const rows = await this.supabaseRequest(`?id=eq.${encodeURIComponent(PRICING_SETTING_ID)}&select=value&limit=1`, {}, "admin_settings");
    const pricing = normalizePricing(rows[0]?.value ? JSON.parse(rows[0].value) : null);
    localStorage.setItem(ACTIVATION_PRICING_KEY, JSON.stringify(pricing));
    return pricing;
  }

  async saveActivationPricing(pricing) {
    const normalized = normalizePricing(pricing);
    localStorage.setItem(ACTIVATION_PRICING_KEY, JSON.stringify(normalized));
    if (!isSupabaseConfigured()) return { ok: true, message: "تم حفظ الأسعار محليًا" };
    await this.supabaseRequest("", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        id: PRICING_SETTING_ID,
        value: JSON.stringify(normalized),
        updated_at: new Date().toISOString()
      })
    }, "admin_settings");
    return { ok: true, message: "تم حفظ الأسعار" };
  }

  calculateActivationPrice(accountRole = "teacher", requestedPlan = "month", teacherSlots = 0, currency = "") {
    const pricing = this.getActivationPricing();
    const selectedCurrency = currency || pricing.currency || "SAR";
    const role = activationRoleMeta(accountRole);
    const plan = activationPlanMeta(requestedPlan, role.id);
    const slots = Math.max(0, Number(teacherSlots || 0));
    let amount = safePrice(pricing[role.id]?.[plan.id]);
    if (role.id === "admin") {
      const extraKey = plan.id === "year" ? "extraTeacherYear" : "extraTeacherMonth";
      amount += slots * safePrice(pricing.admin[extraKey]);
    }
    const currencyMeta = currencyMetaFor(selectedCurrency);
    const displayAmount = Math.round(amount * currencyMeta.rate);
    return {
      amount,
      currency: currencyMeta.id,
      displayAmount,
      label: `${displayAmount.toLocaleString("ar-SA")} ${currencyMeta.label}`,
      role,
      plan,
      teacherSlots: role.id === "admin" ? slots : 1
    };
  }

  async createActivationRequest({ customerName, requestedPlan, accountRole = "teacher", teacherSlots = 0, currency = "", requestKind = "activation" }) {
    const role = activationRoleMeta(accountRole);
    const plan = activationPlanMeta(requestedPlan, role.id);
    const cleanName = String(customerName || "").trim().replace(/[^\p{L}\s.'-]/gu, "");
    const cleanSlots = Number(String(teacherSlots || "0").replace(/\D/g, "") || 0);
    const quote = this.calculateActivationPrice(role.id, plan.id, cleanSlots, currency || this.getActivationPricing().currency || "SAR");
    const unpaidAttempt = await this.findUnpaidExpiredPaymentAttempt(cleanName);
    const needsPaymentReview = Boolean(unpaidAttempt);
    const code = this.generateCode({ plan: "TEMP", duration: 1, durationUnit: "days" });
    const validation = this.validateCode(code);
    const request = {
      id: crypto.randomUUID(),
      customerName: cleanName,
      requestedPlan: plan.id,
      requestedLabel: plan.label,
      accountRole: role.id,
      accountRoleLabel: role.label,
      teacherSlots: quote.teacherSlots,
      quotedPrice: quote.amount,
      currency: quote.currency,
      displayPrice: quote.displayAmount,
      priceLabel: quote.label,
      code,
      status: needsPaymentReview ? "payment_review" : "pending",
      statusLabel: needsPaymentReview ? "بحاجة تحقق من الدفع" : "بانتظار التحقق",
      accessMode: role.accessMode,
      createdAt: new Date().toISOString(),
      paymentAttempt: needsPaymentReview ? 2 : 1,
      previousPaymentCode: unpaidAttempt?.code || "",
      requiresAdminApproval: needsPaymentReview,
      requestKind: requestKind === "renewal" ? "renewal" : "activation"
    };
    if (!/^[\p{L}][\p{L}\s.'-]{1,}$/u.test(request.customerName)) return { ok: false, message: "أدخل الاسم فقط بدون أرقام أو رموز" };
    if (isSupabaseConfigured()) {
      await this.createRemoteLicense({
        code,
        plan: "TEMP",
        expiresAt: validation.expiresAt,
        durationLabel: needsPaymentReview ? "بانتظار تحقق الدفع" : "مؤقت يوم واحد",
        status: needsPaymentReview ? "pending_review" : "active",
        deviceId: null,
        activatedAt: null,
        accessMode: request.accessMode,
        teacherSlots: request.teacherSlots
      });
      const fullRow = {
        id: request.id,
        customer_name: request.customerName,
        requested_plan: request.requestedPlan,
        requested_label: request.requestedLabel,
        requested_role: request.accountRole,
        requested_role_label: request.accountRoleLabel,
        request_kind: request.requestKind,
        teacher_slots: request.teacherSlots,
        quoted_price: request.quotedPrice,
        currency: request.currency,
        display_price: request.displayPrice,
        price_label: request.priceLabel,
        code,
        status: request.status,
        access_mode: request.accessMode,
        payment_attempt: request.paymentAttempt,
        previous_payment_code: request.previousPaymentCode,
        created_at: request.createdAt
      };
      await this.supabaseRequest("", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(fullRow)
      }, "activation_requests").catch(() => {
        return this.supabaseRequest("", {
          method: "POST",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
          id: request.id,
          customer_name: request.customerName,
          requested_plan: request.requestedPlan,
          requested_label: `${request.requestKind === "renewal" ? "إعادة تفعيل - " : ""}${request.accountRoleLabel} - ${request.requestedLabel} - ${request.priceLabel}${request.accountRole === "admin" ? ` - ${request.teacherSlots} معلم إضافي` : ""}${request.paymentAttempt > 1 ? " - محاولة دفع ثانية" : ""}`,
          code,
          status: request.status,
          access_mode: request.accessMode,
          created_at: request.createdAt
          })
        }, "activation_requests");
      });
    } else {
      const requests = this.listLocalActivationRequests();
      requests.unshift(request);
      localStorage.setItem(LOCAL_REQUESTS_KEY, JSON.stringify(requests));
    }
    this.recordPaymentAttempt({
      code,
      customerName: request.customerName,
      requestedPlan: request.requestedPlan,
      accountRole: request.accountRole,
      status: request.status,
      createdAt: request.createdAt,
      expiresAt: validation.expiresAt,
      paymentAttempt: request.paymentAttempt
    });
    if (!needsPaymentReview) {
      localStorage.setItem(ACTIVE_LICENSE_KEY, JSON.stringify({
        code,
        plan: "TEMP",
        serial: validation.serial,
        expiresAt: validation.expiresAt,
        activatedAt: new Date().toISOString(),
          deviceId: this.getDeviceId(),
          accessMode: request.accessMode,
          teacherSlots: request.teacherSlots,
          parentCode: null,
          customerName: request.customerName
        }));
    }
    return {
      ok: true,
      needsPaymentReview,
      message: needsPaymentReview
        ? "للأسف في المرة الأولى لم يتم تأكيد الدفع. هذه المرة لن يتم فتح التطبيق حتى يسمح صاحب التطبيق."
        : "تم إنشاء كود مؤقت لمدة يوم واحد",
      request
    };
  }

  async listActivationRequests() {
    if (!isSupabaseConfigured()) return this.listLocalActivationRequests();
    const rows = await this.supabaseRequest("?select=*&order=created_at.desc", {}, "activation_requests");
    const licenseMap = await this.listRemoteLicensesByCodes(rows.map((row) => row.code));
    const requests = rows.map((row) => ({
      id: row.id,
      customerName: row.customer_name,
      requestedPlan: row.requested_plan,
      requestedLabel: row.requested_label,
      requestKind: row.request_kind || parseRequestKind(row.requested_label),
      accountRole: row.requested_role || normalizeAccessMode(row.access_mode),
      accountRoleLabel: row.requested_role_label || accessModeLabel(row.access_mode),
      teacherSlots: Math.max(Number(row.teacher_slots ?? 0), parseTeacherSlots(row.requested_label)),
      quotedPrice: Number(row.quoted_price || 0),
      currency: row.currency || "SAR",
      displayPrice: Number(row.display_price || row.quoted_price || 0),
      priceLabel: row.price_label || "",
      code: row.code,
      status: row.status,
      statusLabel: requestStatusLabel(row.status),
      accessMode: normalizeAccessMode(row.access_mode),
      paymentAttempt: Number(row.payment_attempt || parsePaymentAttempt(row.requested_label) || 1),
      previousPaymentCode: row.previous_payment_code || "",
      createdAt: row.created_at,
      approvedAt: row.approved_at,
      license: licenseMap.get(normalizeCode(row.code))
    }));
    requests
      .filter((request) => isExpiredRequestLicense(request))
      .forEach((request) => {
        this.supabaseRequest(`?id=eq.${encodeURIComponent(request.id)}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ status: "expired" })
        }, "activation_requests").catch(() => {});
      });
    requests
      .filter((request) => isExpiredPendingRequest(request))
      .forEach((request) => {
        this.supabaseRequest(`?id=eq.${encodeURIComponent(request.id)}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ status: "expired" })
        }, "activation_requests").catch(() => {});
      });
    return requests.filter((request) => !isExpiredPendingRequest(request) && !isExpiredRequestLicense(request) && request.status !== "expired");
  }

  listLocalActivationRequests() {
    const requests = JSON.parse(localStorage.getItem(LOCAL_REQUESTS_KEY) || "[]");
    const activeRequests = requests.filter((request) => !isExpiredPendingRequest(request) && request.status !== "expired");
    if (activeRequests.length !== requests.length) localStorage.setItem(LOCAL_REQUESTS_KEY, JSON.stringify(activeRequests));
    return activeRequests;
  }

  listPaymentAttempts() {
    try {
      const attempts = JSON.parse(localStorage.getItem(PAYMENT_ATTEMPTS_KEY) || "[]");
      return Array.isArray(attempts) ? attempts : [];
    } catch {
      return [];
    }
  }

  recordPaymentAttempt(attempt) {
    const normalizedCode = normalizeCode(attempt.code);
    if (!normalizedCode) return;
    const attempts = this.listPaymentAttempts().filter((item) => normalizeCode(item.code) !== normalizedCode);
    attempts.unshift({
      ...attempt,
      code: normalizedCode,
      deviceId: this.getDeviceId()
    });
    localStorage.setItem(PAYMENT_ATTEMPTS_KEY, JSON.stringify(attempts.slice(0, 30)));
  }

  markPaymentAttemptApproved(code) {
    const normalizedCode = normalizeCode(code);
    if (!normalizedCode) return;
    const attempts = this.listPaymentAttempts().map((item) => normalizeCode(item.code) === normalizedCode ? {
      ...item,
      status: "approved",
      approvedAt: new Date().toISOString()
    } : item);
    localStorage.setItem(PAYMENT_ATTEMPTS_KEY, JSON.stringify(attempts));
  }

  async findUnpaidExpiredPaymentAttempt(customerName = "") {
    const cleanName = String(customerName || "").trim();
    const attempts = this.listPaymentAttempts()
      .filter((item) => item.status !== "approved")
      .filter((item) => !cleanName || !item.customerName || normalizeArabicName(item.customerName) === normalizeArabicName(cleanName))
      .filter((item) => new Date(item.expiresAt || item.createdAt || 0) < startOfToday());
    for (const attempt of attempts) {
      if (await this.isPaymentAttemptStillUnapproved(attempt)) return attempt;
    }
    return null;
  }

  async isPaymentAttemptStillUnapproved(attempt) {
    const code = normalizeCode(attempt?.code);
    if (!code) return false;
    if (!isSupabaseConfigured()) return true;
    const remote = await this.getRemoteLicense(code).catch(() => null);
    if (!remote) return true;
    if (remote.plan && remote.plan !== "TEMP") return false;
    const rows = await this.supabaseRequest(`?code=eq.${encodeURIComponent(code)}&select=status&limit=1`, {}, "activation_requests").catch(() => []);
    return rows[0]?.status !== "approved";
  }

  async approveActivationRequest(id, durationKey, accessMode = "admin", teacherSlotsOverride = null) {
    const plan = activationPlanMeta(durationKey);
    const expiresAt = expiryFromPlan(plan).toISOString();
    const normalizedAccessMode = normalizeAccessMode(accessMode);
    if (isSupabaseConfigured()) {
      const requests = await this.listActivationRequests();
      const request = requests.find((item) => item.id === id);
      if (!request) return { ok: false, message: "الطلب غير موجود" };
      const teacherSlots = Math.max(0, Number(teacherSlotsOverride ?? request.teacherSlots ?? 0));
      const licensePatch = {
        plan: plan.remotePlan,
        status: "active",
        expires_at: expiresAt,
        duration_label: attachLicenseMeta(plan.label, {
          accessMode: normalizedAccessMode,
          teacherSlots,
          ownerName: request.customerName
        }),
        access_mode: normalizedAccessMode,
        teacher_slots: teacherSlots,
        revoked_at: null
      };
      await this.updateRemoteLicense(request.code, licensePatch).catch((error) => {
        if (!isAccessModeSchemaError(error)) throw error;
        const fallbackPatch = { ...licensePatch };
        delete fallbackPatch.access_mode;
        delete fallbackPatch.teacher_slots;
        return this.updateRemoteLicense(request.code, fallbackPatch);
      });
      const requestPatch = {
        status: "approved",
        approved_duration: plan.id,
        approved_label: plan.label,
        access_mode: normalizedAccessMode,
        teacher_slots: teacherSlots,
        approved_at: new Date().toISOString()
      };
      await this.supabaseRequest(`?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(requestPatch)
      }, "activation_requests").catch((error) => {
        if (!isAccessModeSchemaError(error)) throw error;
        const fallbackPatch = { ...requestPatch };
        delete fallbackPatch.access_mode;
        delete fallbackPatch.teacher_slots;
        return this.supabaseRequest(`?id=eq.${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify(fallbackPatch)
        }, "activation_requests");
      });
      const verifiedLicense = await this.getRemoteLicense(request.code).catch(() => null);
      const verifiedMode = verifiedLicense ? await this.resolveRemoteAccessMode(request.code, verifiedLicense, normalizedAccessMode) : normalizedAccessMode;
      if (verifiedLicense && verifiedMode !== normalizedAccessMode) {
        return { ok: false, message: "تم تفعيل الاشتراك، لكن لم يتم حفظ الصلاحية. تأكد من عمود access_mode في جدول licenses" };
      }
    } else {
      const requests = this.listLocalActivationRequests().map((request) => request.id === id ? {
        ...request,
        status: "approved",
        statusLabel: "تم التفعيل",
        approvedDuration: plan.id,
        approvedLabel: plan.label,
        accessMode: normalizedAccessMode,
        teacherSlots: Math.max(0, Number(teacherSlotsOverride ?? request.teacherSlots ?? 0)),
        approvedAt: new Date().toISOString()
      } : request);
      localStorage.setItem(LOCAL_REQUESTS_KEY, JSON.stringify(requests));
    }
    const approvedRequest = (await this.listActivationRequests().catch(() => this.listLocalActivationRequests())).find((request) => request.id === id);
    if (approvedRequest?.code) this.markPaymentAttemptApproved(approvedRequest.code);
    return { ok: true, message: "تم تحويل الكود إلى اشتراك رسمي" };
  }

  async markActivationRequestUnpaid(id) {
    const now = new Date().toISOString();
    if (isSupabaseConfigured()) {
      const requests = await this.listActivationRequests();
      const request = requests.find((item) => item.id === id);
      if (!request) return { ok: false, message: "الطلب غير موجود" };
      await this.supabaseRequest(`?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "unpaid",
          approved_at: now
        })
      }, "activation_requests");
      this.recordPaymentAttempt({
        code: request.code,
        customerName: request.customerName,
        requestedPlan: request.requestedPlan,
        accountRole: request.accountRole,
        status: "unpaid",
        createdAt: request.createdAt || now,
        expiresAt: request.license?.expiresAt || request.license?.expires_at || now,
        paymentAttempt: Number(request.paymentAttempt || 1)
      });
      return { ok: true, message: "تم تسجيل أن الدفع لم يصل" };
    }
    let found = false;
    const requests = this.listLocalActivationRequests().map((request) => {
      if (request.id !== id) return request;
      found = true;
      return { ...request, status: "unpaid", statusLabel: "لم يتم الدفع", reviewedAt: now };
    });
    if (!found) return { ok: false, message: "الطلب غير موجود" };
    localStorage.setItem(LOCAL_REQUESTS_KEY, JSON.stringify(requests));
    return { ok: true, message: "تم تسجيل أن الدفع لم يصل" };
  }

  async getActivationRequestByCode(code) {
    const normalizedCode = normalizeCode(code);
    if (!normalizedCode) return null;
    if (isSupabaseConfigured()) {
      const rows = await this.supabaseRequest(`?code=eq.${encodeURIComponent(normalizedCode)}&select=*&order=created_at.desc&limit=1`, {}, "activation_requests").catch(() => []);
      const row = rows[0];
      if (!row) return null;
      const license = await this.getRemoteLicense(normalizedCode).catch(() => null);
      return {
        id: row.id,
        customerName: row.customer_name,
        requestedPlan: row.requested_plan,
        requestedLabel: row.requested_label,
        requestKind: row.request_kind || parseRequestKind(row.requested_label),
        accountRole: row.requested_role || normalizeAccessMode(row.access_mode),
        accountRoleLabel: row.requested_role_label || accessModeLabel(row.access_mode),
        code: row.code,
        status: row.status,
        statusLabel: requestStatusLabel(row.status),
        accessMode: normalizeAccessMode(row.access_mode),
        paymentAttempt: Number(row.payment_attempt || parsePaymentAttempt(row.requested_label) || 1),
        createdAt: row.created_at,
        approvedAt: row.approved_at,
        license
      };
    }
    return this.listLocalActivationRequests().find((request) => normalizeCode(request.code) === normalizedCode) || null;
  }

  async updateLicenseAccessMode(code, accessMode) {
    const normalized = normalizeAccessMode(accessMode);
    const normalizedCode = normalizeCode(code);
    if (isSupabaseConfigured()) {
      const currentRemote = await this.getRemoteLicense(normalizedCode).catch(() => null);
      const currentMeta = parseLicenseMeta(currentRemote?.duration_label);
      const metaLabel = attachLicenseMeta(cleanDurationLabel(currentRemote?.duration_label || durationLabelFor(1, "months")), {
        ...currentMeta,
        accessMode: normalized,
        ownerName: currentRemote?.owner_name || currentMeta.ownerName || "",
        teacherSlots: currentRemote?.teacher_slots ?? currentMeta.teacherSlots ?? 0
      });
      const result = await this.updateRemoteLicense(normalizedCode, { access_mode: normalized }).catch((error) => {
        if (isAccessModeSchemaError(error)) return { schemaMissing: true };
        throw error;
      });
      if (result?.schemaMissing) {
        await this.updateRemoteLicense(normalizedCode, { duration_label: metaLabel }).catch(() => {});
        await this.supabaseRequest(`?code=eq.${encodeURIComponent(normalizedCode)}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ access_mode: normalized })
        }, "activation_requests").catch(() => {});
        return { ok: true, message: "تم حفظ الصلاحية داخل بيانات الكود" };
      }
      const remote = await this.getRemoteLicense(normalizedCode).catch(() => null);
      if (!remote) {
        return { ok: false, message: "لم يتم العثور على الكود في Supabase" };
      }
      const remoteMode = await this.resolveRemoteAccessMode(normalizedCode, remote, normalized);
      if (remoteMode !== normalized) {
        await this.updateRemoteLicense(normalizedCode, { duration_label: metaLabel }).catch(() => {});
      }
      await this.supabaseRequest(`?code=eq.${encodeURIComponent(normalizedCode)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ access_mode: normalized })
      }, "activation_requests").catch(() => {});
    }
    const licenses = this.listLocalGeneratedCodes().map((item) => normalizeCode(item.code) === normalizedCode ? { ...item, accessMode: normalized } : item);
    localStorage.setItem("yusr-generated-codes-v1", JSON.stringify(licenses));
    const requests = this.listLocalActivationRequests().map((request) => normalizeCode(request.code) === normalizedCode ? { ...request, accessMode: normalized } : request);
    localStorage.setItem(LOCAL_REQUESTS_KEY, JSON.stringify(requests));
    const active = this.getActiveLicense();
    if (active && normalizeCode(active.code) === normalizedCode) {
      localStorage.setItem(ACTIVE_LICENSE_KEY, JSON.stringify({ ...active, accessMode: normalized }));
    }
    return { ok: true, message: "تم تحديث صلاحية الكود" };
  }

  findLocalLicenseAccessMode(code) {
    const item = this.findLocalGeneratedLicense(code);
    return normalizeAccessMode(item?.accessMode);
  }

  findLocalGeneratedLicense(code) {
    return this.listLocalGeneratedCodes().find((license) => normalizeCode(license.code) === normalizeCode(code));
  }

  listLocalGeneratedCodes() {
    return JSON.parse(localStorage.getItem("yusr-generated-codes-v1") || "[]");
  }

  listLocalManagedCodeCache() {
    try {
      const value = JSON.parse(localStorage.getItem(MANAGED_TEACHERS_KEY) || "{}");
      if (Array.isArray(value)) {
        const parentCode = normalizeCode(this.getActiveLicense()?.code);
        return parentCode ? { [parentCode]: value } : {};
      }
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  listLocalManagedCodesFromCache(parentCode = this.getActiveLicense()?.code) {
    const normalizedParent = normalizeCode(parentCode);
    const cache = this.listLocalManagedCodeCache();
    return Array.isArray(cache[normalizedParent]) ? cache[normalizedParent] : [];
  }

  saveLocalManagedCodesForParent(parentCode, items = []) {
    const normalizedParent = normalizeCode(parentCode);
    if (!normalizedParent) return;
    const cache = this.listLocalManagedCodeCache();
    cache[normalizedParent] = mergeManagedCodeItems(normalizedParent, items);
    localStorage.setItem(MANAGED_TEACHERS_KEY, JSON.stringify(cache));
  }

  upsertLocalGeneratedCodes(items = []) {
    const next = new Map(this.listLocalGeneratedCodes().map((item) => [normalizeCode(item.code), item]));
    items.filter(Boolean).forEach((item) => {
      const code = normalizeCode(item.code);
      if (!code) return;
      next.set(code, mergeManagedCodeItem(next.get(code), item));
    });
    localStorage.setItem("yusr-generated-codes-v1", JSON.stringify([...next.values()]));
  }

  listManagedCodes(parentCode = this.getActiveLicense()?.code) {
    const normalizedParent = normalizeCode(parentCode);
    return mergeManagedCodeItems(normalizedParent, [
      ...this.listLocalGeneratedCodes(),
      ...this.listLocalManagedCodesFromCache(normalizedParent)
    ]).filter((item) => normalizeCode(item.parentCode) === normalizedParent
      && ["teacher", "delegate"].includes(item.accessMode)
      && item.status !== "revoked"
      && !isExpiredLicense(item.expiresAt));
  }

  async listManagedCodesWithUsage(parentCode = this.getActiveLicense()?.code) {
    const normalizedParent = normalizeCode(parentCode);
    const localItems = this.listManagedCodes(normalizedParent);
    const remoteItems = isSupabaseConfigured()
      ? await this.listRemoteManagedLicenses(normalizedParent).catch(() => [])
      : [];
    const items = mergeManagedCodeItems(normalizedParent, [...localItems, ...remoteItems]);
    if (!isSupabaseConfigured() || !items.length) {
      this.saveLocalManagedCodesForParent(normalizedParent, items);
      return items;
    }
    const remoteMap = await this.listRemoteLicensesByCodes(items.map((item) => item.code)).catch(() => new Map());
    const enriched = mergeManagedCodeItems(normalizedParent, items.map((item) => {
      const remote = remoteMap.get(normalizeCode(item.code));
      if (!remote) return item;
      const meta = parseLicenseMeta(remote.duration_label);
      const accessMode = accessModeFromRemoteRow(remote, item.accessMode);
      return {
        ...item,
        accessMode,
        status: remote.status || item.status,
        deviceId: remote.device_id || item.deviceId || "",
        activatedAt: remote.activated_at || item.activatedAt || "",
        ownerName: item.ownerName || remote.owner_name || meta.ownerName || "",
        parentCode: item.parentCode || remote.parent_code || meta.parentCode || parentCode,
        permissions: item.permissions || parsePermissions(remote.permissions) || meta.permissions || defaultPermissionsForMode(accessMode),
        expiresAt: remote.expires_at || item.expiresAt
      };
    }));
    this.upsertLocalGeneratedCodes(enriched);
    this.saveLocalManagedCodesForParent(normalizedParent, enriched);
    return enriched;
  }

  managedCodeLimit(parentCode = this.getActiveLicense()?.code) {
    const active = this.getActiveLicense();
    if (active && normalizeCode(active.code) === normalizeCode(parentCode)) {
      const localRequest = this.listLocalActivationRequests().find((request) => normalizeCode(request.code) === normalizeCode(parentCode));
      return normalizeManagedTeacherLimit(Math.max(0, Number(active.teacherSlots || 0), Number(localRequest?.teacherSlots || 0)), active);
    }
    const license = this.listLocalGeneratedCodes().find((item) => normalizeCode(item.code) === normalizeCode(parentCode));
    return normalizeManagedTeacherLimit(Math.max(0, Number(license?.teacherSlots || 0)), license);
  }

  async createManagedCode({ duration = 1, durationUnit = "months", requestedPlan = "", accessMode = "teacher", parentCode = this.getActiveLicense()?.code, ownerName = "" } = {}) {
    const normalizedParent = normalizeCode(parentCode);
    const mode = normalizeAccessMode(accessMode) === "delegate" ? "delegate" : "teacher";
    const cleanOwnerName = String(ownerName || "").trim().replace(/[^\p{L}\s.'-]/gu, "");
    if (!/^[\p{L}][\p{L}\s.'-]{1,}$/u.test(cleanOwnerName)) {
      return { ok: false, message: "أدخل اسم المعلم أو المندوب بدون أرقام أو رموز" };
    }
    const planMeta = requestedPlan ? activationPlanMeta(requestedPlan, mode) : null;
    const numericDuration = Math.max(1, Number(duration || 1));
    const finalDuration = planMeta ? (planMeta.id === "year" ? 12 : 1) : numericDuration;
    const finalDurationUnit = planMeta ? (planMeta.id === "week" ? "weeks" : "months") : durationUnit;
    let limit = this.managedCodeLimit(normalizedParent);
    if (limit === 0 && isSupabaseConfigured()) {
      const remoteSlots = await this.getActivationRequestTeacherSlots(normalizedParent).catch(() => 0);
      if (remoteSlots > 0) {
        limit = normalizeManagedTeacherLimit(remoteSlots, this.getActiveLicense());
        const active = this.getActiveLicense();
        if (active && normalizeCode(active.code) === normalizedParent) {
          localStorage.setItem(ACTIVE_LICENSE_KEY, JSON.stringify({ ...active, teacherSlots: remoteSlots }));
        }
      }
    }
    const existingManagedCodes = isSupabaseConfigured()
      ? mergeManagedCodeItems(normalizedParent, [
        ...this.listManagedCodes(normalizedParent),
        ...await this.listRemoteManagedLicenses(normalizedParent).catch(() => [])
      ])
      : this.listManagedCodes(normalizedParent);
    const used = existingManagedCodes.length;
    if (used >= limit) return { ok: false, message: `وصلت إلى الحد المسموح: ${limit} كود` };
    const plan = mode === "delegate" ? "DELEGATE" : "TEACHER";
    const code = this.generateCode({ plan, duration: finalDuration, durationUnit: finalDurationUnit });
    const validation = this.validateCode(code);
    // الكود التابع يرتبط بكود المشرف عبر parentCode، وهذا هو أساس معرفة أن الحساب تابع للمشرف.
    const item = {
      code,
      plan,
      expiresAt: validation.expiresAt,
      durationLabel: planMeta?.label || durationLabelFor(finalDuration, finalDurationUnit),
      accessMode: mode,
      permissions: defaultPermissionsForMode(mode),
      status: "active",
      parentCode: normalizedParent,
      ownerName: cleanOwnerName,
      teacherSlots: 1,
      createdAt: new Date().toISOString()
    };
    this.upsertLocalGeneratedCodes([item]);
    this.saveLocalManagedCodesForParent(normalizedParent, [item, ...existingManagedCodes]);
    if (isSupabaseConfigured() && isBrowserOnline()) {
      this.createRemoteLicense({
        code,
        plan,
        expiresAt: item.expiresAt,
        durationLabel: item.durationLabel,
        accessMode: mode,
        teacherSlots: 1,
        parentCode: normalizedParent,
        permissions: item.permissions,
        ownerName: item.ownerName
      }).catch(() => {});
    }
    return { ok: true, message: "تم إنشاء الكود", item };
  }

  async updateManagedCodePermissions(code, permissions = {}) {
    const normalizedCode = normalizeCode(code);
    const cleaned = normalizePermissions(permissions);
    const current = this.findLocalGeneratedLicense(normalizedCode)
      || this.listManagedCodes().find((item) => normalizeCode(item.code) === normalizedCode);
    const nextItem = current ? { ...current, permissions: cleaned } : null;
    if (nextItem) {
      this.upsertLocalGeneratedCodes([nextItem]);
      this.saveLocalManagedCodesForParent(nextItem.parentCode || this.getActiveLicense()?.code, [nextItem, ...this.listManagedCodes(nextItem.parentCode)]);
    }
    if (isSupabaseConfigured()) {
      const metaPatch = nextItem ? {
        duration_label: attachLicenseMeta(nextItem.durationLabel, {
          accessMode: nextItem.accessMode,
          parentCode: nextItem.parentCode,
          ownerName: nextItem.ownerName,
          permissions: cleaned,
          teacherSlots: nextItem.teacherSlots || 1
        })
      } : {};
      await this.updateRemoteLicense(normalizedCode, { permissions: JSON.stringify(cleaned), ...metaPatch }).catch(() => {});
    }
    const active = this.getActiveLicense();
    if (active && normalizeCode(active.code) === normalizedCode) {
      localStorage.setItem(ACTIVE_LICENSE_KEY, JSON.stringify({ ...active, permissions: cleaned }));
    }
    return { ok: true, message: "تم حفظ صلاحيات المعلم" };
  }

  async updateManagedCode(code, patch = {}) {
    const normalizedCode = normalizeCode(code);
    let current = this.findLocalGeneratedLicense(normalizedCode);
    if (!current && isSupabaseConfigured()) {
      const remote = await this.getRemoteLicense(normalizedCode).catch(() => null);
      current = this.remoteLicenseToManagedItem(remote, this.getActiveLicense()?.code);
      if (current) this.upsertLocalGeneratedCodes([current]);
    }
    if (!current) return { ok: false, message: "الكود غير موجود" };
    const nextMode = normalizeAccessMode(patch.accessMode || current.accessMode) === "delegate" ? "delegate" : "teacher";
    const modeChanged = nextMode !== current.accessMode;
    const permissions = modeChanged ? defaultPermissionsForMode(nextMode) : (current.permissions || defaultPermissionsForMode(nextMode));
    const ownerName = String(patch.ownerName ?? current.ownerName ?? "").trim().replace(/[^\p{L}\s.'-]/gu, "");
    if (!/^[\p{L}][\p{L}\s.'-]{1,}$/u.test(ownerName)) {
      return { ok: false, message: "أدخل الاسم بدون أرقام أو رموز" };
    }
    const nextItem = {
      ...current,
      ownerName,
      accessMode: nextMode,
      permissions
    };
    this.upsertLocalGeneratedCodes([nextItem]);
    this.saveLocalManagedCodesForParent(nextItem.parentCode || this.getActiveLicense()?.code, [nextItem, ...this.listManagedCodes(nextItem.parentCode)]);
    const labelWithMeta = attachLicenseMeta(nextItem.durationLabel, {
      accessMode: nextMode,
      parentCode: nextItem.parentCode,
      ownerName,
      permissions,
      teacherSlots: nextItem.teacherSlots || 1
    });
    if (isSupabaseConfigured()) {
      await this.updateRemoteLicense(normalizedCode, {
        owner_name: ownerName,
        access_mode: nextMode,
        permissions: JSON.stringify(permissions),
        duration_label: labelWithMeta
      }).catch((error) => {
        if (!isAccessModeSchemaError(error)) throw error;
        return this.updateRemoteLicense(normalizedCode, { duration_label: labelWithMeta }).catch(() => {});
      });
    }
    return { ok: true, message: "تم تعديل بيانات الكود", item: nextItem };
  }

  async deleteManagedCode(code) {
    const normalizedCode = normalizeCode(code);
    const before = this.listLocalGeneratedCodes();
    const after = before.filter((item) => normalizeCode(item.code) !== normalizedCode);
    localStorage.setItem("yusr-generated-codes-v1", JSON.stringify(after));
    this.removeLocalManagedCodeFromCache(normalizedCode);
    this.removeLocalManagedAccountData(normalizedCode);
    if (isSupabaseConfigured()) {
      await this.revokeRemoteLicense(normalizedCode).catch(() => {});
    }
    return { ok: true, message: "تم حذف الكود وإيقافه" };
  }

  removeLocalManagedCodeFromCache(code) {
    const normalizedCode = normalizeCode(code);
    const cache = this.listLocalManagedCodeCache();
    Object.keys(cache).forEach((parent) => {
      cache[parent] = Array.isArray(cache[parent])
        ? cache[parent].filter((item) => normalizeCode(item.code) !== normalizedCode)
        : [];
    });
    localStorage.setItem(MANAGED_TEACHERS_KEY, JSON.stringify(cache));
  }

  // مزامنة بدون إنترنت: المعلم أو المندوب يصدر هذا الملف ويسلمه للمشرف يدويًا.
  createManagedAccountSyncPayload({ ownerName = "", data = {} } = {}) {
    const active = this.getActiveLicense();
    const accessMode = normalizeAccessMode(active?.accessMode);
    if (!active || !["teacher", "delegate"].includes(accessMode)) {
      return { ok: false, message: "تصدير ملف المشرف متاح لحسابات المعلم والمندوب فقط" };
    }
    const isManagedChild = Boolean(active.parentCode);
    if (!isManagedChild) {
      return { ok: false, message: "تصدير ملف المشرف يظهر فقط للحسابات التابعة لمشرف" };
    }
    return {
      ok: true,
      payload: {
        app: "yusr-managed-sync",
        version: 1,
        exportedAt: new Date().toISOString(),
        code: normalizeCode(active.code),
        parentCode: active.parentCode ? normalizeCode(active.parentCode) : "",
        ownerName: String(active.ownerName || ownerName || active.customerName || "").trim(),
        accessMode,
        data
      }
    };
  }

  // يستورد المشرف الملف داخل صفحة الحساب المطابق، لذلك لا نحتاج اتصال إنترنت.
  importManagedAccountSync(payload, parentCode = this.getActiveLicense()?.code) {
    const normalizedParent = normalizeCode(parentCode);
    const source = payload?.app === "yusr-managed-sync" ? payload : null;
    if (!source || !source.data || typeof source.data !== "object") {
      return { ok: false, message: "ملف المزامنة غير صحيح" };
    }
    const code = normalizeCode(source.code);
    if (!code) return { ok: false, message: "ملف المزامنة لا يحتوي على كود الحساب" };
    const child = this.listManagedCodes(normalizedParent).find((item) => normalizeCode(item.code) === code);
    if (!child) {
      return { ok: false, message: "هذا الملف لا يتبع أكواد هذا المشرف. تأكد أنك تستورد ملف المعلم الصحيح" };
    }
    const sourceParent = normalizeCode(source.parentCode || source.parent_code || "");
    if (sourceParent && sourceParent !== normalizedParent) {
      return { ok: false, message: "هذا الملف تابع لمشرف آخر" };
    }
    const row = {
      code,
      parent_code: normalizedParent,
      owner_name: String(source.ownerName || child.ownerName || "").trim(),
      access_mode: normalizeAccessMode(source.accessMode || child.accessMode),
      data: source.data,
      updated_at: source.exportedAt || new Date().toISOString()
    };
    this.saveLocalManagedAccountData(row);
    return { ok: true, message: "تم استيراد بيانات الحساب التابع", code };
  }

  async saveManagedAccountData({ code, parentCode = null, ownerName = "", accessMode = "teacher", data = {} }) {
    const row = {
      code: normalizeCode(code),
      parent_code: parentCode ? normalizeCode(parentCode) : null,
      owner_name: String(ownerName || "").trim(),
      access_mode: normalizeAccessMode(accessMode),
      data,
      updated_at: new Date().toISOString()
    };
    // نحفظ محليًا أولًا؛ Supabase مجرد مزامنة مباشرة ولا يجب أن يعطل العمل بدون إنترنت.
    this.saveLocalManagedAccountData(row);
    if (!isSupabaseConfigured() || !isBrowserOnline()) return { ok: true, localOnly: true };
    try {
      await this.supabaseRequest("?on_conflict=code", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(row)
      }, "managed_account_data");
      return { ok: true };
    } catch (error) {
      console.warn("Managed account remote sync skipped", error);
      return { ok: true, localOnly: true, remoteSkipped: true };
    }
  }

  async getManagedAccountData(code) {
    const local = this.getLocalManagedAccountData(code);
    if (!isSupabaseConfigured() || !isBrowserOnline()) return local;
    const rows = await this.supabaseRequest(`?code=eq.${encodeURIComponent(normalizeCode(code))}&select=*&limit=1`, {}, "managed_account_data")
      .catch(() => []);
    return rows?.[0] || local;
  }

  async listManagedAccountDataForParent(parentCode = this.getActiveLicense()?.code) {
    const normalizedParent = normalizeCode(parentCode);
    const localRows = Object.values(this.listLocalManagedAccountData())
      .filter((row) => normalizeCode(row.parent_code) === normalizedParent);
    if (!normalizedParent || !isSupabaseConfigured() || !isBrowserOnline()) return localRows;
    const remoteRows = await this.supabaseRequest(`?parent_code=eq.${encodeURIComponent(normalizedParent)}&select=*`, {}, "managed_account_data")
      .catch(() => []);
    (remoteRows || []).forEach((row) => this.saveLocalManagedAccountData(row));
    const merged = new Map(localRows.map((row) => [normalizeCode(row.code), row]));
    (remoteRows || []).forEach((row) => merged.set(normalizeCode(row.code), row));
    return [...merged.values()];
  }

  saveLocalManagedAccountData(row) {
    const code = normalizeCode(row?.code);
    if (!code) return;
    const all = this.listLocalManagedAccountData();
    all[code] = {
      code,
      parent_code: row.parent_code ? normalizeCode(row.parent_code) : null,
      owner_name: String(row.owner_name || "").trim(),
      access_mode: normalizeAccessMode(row.access_mode),
      data: row.data || {},
      updated_at: row.updated_at || new Date().toISOString(),
      source: "local"
    };
    localStorage.setItem(MANAGED_ACCOUNT_DATA_KEY, JSON.stringify(all));
  }

  getLocalManagedAccountData(code) {
    return this.listLocalManagedAccountData()[normalizeCode(code)] || null;
  }

  removeLocalManagedAccountData(code) {
    const all = this.listLocalManagedAccountData();
    delete all[normalizeCode(code)];
    localStorage.setItem(MANAGED_ACCOUNT_DATA_KEY, JSON.stringify(all));
  }

  listLocalManagedAccountData() {
    try {
      const value = JSON.parse(localStorage.getItem(MANAGED_ACCOUNT_DATA_KEY) || "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  async revokeRemoteLicense(code) {
    if (!isSupabaseConfigured()) return { ok: false, message: "Supabase غير مفعل" };
    await this.updateRemoteLicense(code, { status: "revoked", revoked_at: new Date().toISOString() });
    return { ok: true };
  }

  async listRemoteLicenses() {
    if (!isSupabaseConfigured()) return [];
    return this.supabaseRequest("?select=*&order=created_at.desc");
  }

  async listRemoteManagedLicenses(parentCode = this.getActiveLicense()?.code) {
    if (!isSupabaseConfigured()) return [];
    const normalizedParent = normalizeCode(parentCode);
    if (!normalizedParent) return [];
    let rows = [];
    try {
      rows = await this.supabaseRequest(`?parent_code=eq.${encodeURIComponent(normalizedParent)}&select=*&order=created_at.desc`);
    } catch (error) {
      if (!isAccessModeSchemaError(error)) throw error;
    }
    if (!rows?.length) {
      rows = await this.listRemoteLicenses().catch(() => []);
    }
    return (rows || [])
      .map((row) => this.remoteLicenseToManagedItem(row, normalizedParent))
      .filter(Boolean)
      .filter((item) => item.status !== "revoked" && !isExpiredLicense(item.expiresAt));
  }

  remoteLicenseToManagedItem(row, parentCode = this.getActiveLicense()?.code) {
    if (!row?.code) return null;
    const normalizedParent = normalizeCode(parentCode);
    const meta = parseLicenseMeta(row.duration_label);
    const accessMode = accessModeFromRemoteRow(row);
    if (!["teacher", "delegate"].includes(accessMode)) return null;
    const rowParent = normalizeCode(row.parent_code || meta.parentCode || "");
    if (normalizedParent && rowParent && rowParent !== normalizedParent) return null;
    if (normalizedParent && !rowParent) return null;
    return {
      code: normalizeCode(row.code),
      plan: row.plan || (accessMode === "delegate" ? "DELEGATE" : "TEACHER"),
      expiresAt: row.expires_at,
      durationLabel: row.duration_label || durationLabelFor(1, "months"),
      accessMode,
      permissions: parsePermissions(row.permissions) || meta.permissions || defaultPermissionsForMode(accessMode),
      status: row.status || "active",
      parentCode: rowParent || normalizedParent,
      ownerName: String(row.owner_name || meta.ownerName || "").trim(),
      teacherSlots: Math.max(1, Number(row.teacher_slots ?? meta.teacherSlots ?? 1)),
      createdAt: row.created_at || "",
      deviceId: row.device_id || "",
      activatedAt: row.activated_at || ""
    };
  }

  async listRemoteLicensesByCodes(codes) {
    const uniqueCodes = [...new Set(codes.map(normalizeCode).filter(Boolean))];
    if (!uniqueCodes.length) return new Map();
    const quoted = uniqueCodes.map((code) => `"${code.replaceAll('"', "")}"`).join(",");
    let rows = await this.supabaseRequest(`?code=in.(${quoted})&select=*`).catch(() => []);
    if (!rows?.length) {
      rows = (await Promise.all(uniqueCodes.map((code) => this.getRemoteLicense(code).catch(() => null)))).filter(Boolean);
    }
    return new Map((rows || []).map((row) => [normalizeCode(row.code), row]));
  }

  async getRemoteLicense(code) {
    const rows = await this.supabaseRequest(`?code=eq.${encodeURIComponent(normalizeCode(code))}&select=*&limit=1`);
    return rows[0] || null;
  }

  async updateRemoteLicense(code, patch) {
    return this.supabaseRequest(`?code=eq.${encodeURIComponent(normalizeCode(code))}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(patch)
    });
  }

  async supabaseRequest(query = "", options = {}, table = supabaseConfig.table) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(`${supabaseConfig.url}/rest/v1/${table}${query}`, {
      method: options.method || "GET",
      headers: {
        apikey: supabaseConfig.anonKey,
        Authorization: `Bearer ${supabaseConfig.anonKey}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      body: options.body,
      signal: controller.signal
    }).finally(() => clearTimeout(timeoutId));
    if (!response.ok) {
      const details = await response.text().catch(() => "");
      if (response.status === 404) throw new Error(`جدول ${table} غير موجود في Supabase`);
      throw new Error(details || "تعذر الاتصال بخدمة التراخيص");
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  async adminLogin(pin) {
    const ok = await this.verifyAdminPin(pin);
    if (ok) localStorage.setItem(ADMIN_SESSION_KEY, "true");
    return ok;
  }

  adminLogout() {
    localStorage.removeItem(ADMIN_SESSION_KEY);
  }

  isAdmin() {
    return localStorage.getItem(ADMIN_SESSION_KEY) === "true";
  }

  async verifyAdminPin(pin) {
    if (!isSupabaseConfigured()) return String(pin) === localStorage.getItem(ADMIN_PIN_KEY);
    try {
      const remoteHash = await this.getRemoteAdminPinHash();
      return remoteHash === await adminPinHash(pin);
    } catch {
      return String(pin) === localStorage.getItem(ADMIN_PIN_KEY);
    }
  }

  async changeAdminPin(currentPin, nextPin) {
    if (!(await this.verifyAdminPin(currentPin))) return false;
    if (isSupabaseConfigured()) {
      await this.saveRemoteAdminPinHash(await adminPinHash(nextPin));
    }
    localStorage.setItem(ADMIN_PIN_KEY, String(nextPin));
    return true;
  }

  async getRemoteAdminPinHash() {
    const rows = await this.supabaseRequest(
      `?id=eq.${ADMIN_SETTING_ID}&select=value&limit=1`,
      {},
      "admin_settings"
    );
    if (rows[0]?.value) return rows[0].value;
    const defaultHash = await adminPinHash(localStorage.getItem(ADMIN_PIN_KEY) || DEFAULT_ADMIN_PIN);
    await this.saveRemoteAdminPinHash(defaultHash);
    return defaultHash;
  }

  async saveRemoteAdminPinHash(value) {
    await this.supabaseRequest("", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        id: ADMIN_SETTING_ID,
        value,
        updated_at: new Date().toISOString()
      })
    }, "admin_settings");
  }
}

async function adminPinHash(pin) {
  const bytes = new TextEncoder().encode(`YUSR_ADMIN_PIN|${String(pin)}|2026`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeCode(code) {
  return String(code || "").trim().toUpperCase().replace(/\s+/g, "");
}

function mergeManagedCodeItems(parentCode, items = []) {
  const normalizedParent = normalizeCode(parentCode);
  const map = new Map();
  items.filter(Boolean).forEach((item) => {
    const normalizedCode = normalizeCode(item.code);
    if (!normalizedCode) return;
    const parent = normalizeCode(item.parentCode || item.parent_code || normalizedParent);
    if (normalizedParent && parent !== normalizedParent) return;
    const accessMode = normalizeAccessMode(item.accessMode || item.access_mode || accessModeFromPlan(item.plan));
    if (!["teacher", "delegate"].includes(accessMode)) return;
    const normalizedItem = {
      ...item,
      code: normalizedCode,
      accessMode,
      parentCode: parent,
      permissions: item.permissions || defaultPermissionsForMode(accessMode)
    };
    map.set(normalizedCode, mergeManagedCodeItem(map.get(normalizedCode), normalizedItem));
  });
  return [...map.values()]
    .filter((item) => item.status !== "revoked" && !isExpiredLicense(item.expiresAt))
    .sort((a, b) => new Date(b.createdAt || b.activatedAt || 0) - new Date(a.createdAt || a.activatedAt || 0));
}

function mergeManagedCodeItem(base = null, incoming = null) {
  if (!base) return incoming;
  if (!incoming) return base;
  const accessMode = normalizeAccessMode(incoming.accessMode || base.accessMode);
  return {
    ...base,
    ...incoming,
    code: normalizeCode(incoming.code || base.code),
    accessMode,
    parentCode: normalizeCode(incoming.parentCode || base.parentCode),
    ownerName: String(incoming.ownerName || base.ownerName || "").trim(),
    permissions: incoming.permissions || base.permissions || defaultPermissionsForMode(accessMode),
    status: incoming.status || base.status || "active",
    deviceId: incoming.deviceId || base.deviceId || "",
    activatedAt: incoming.activatedAt || base.activatedAt || "",
    expiresAt: incoming.expiresAt || base.expiresAt,
    durationLabel: incoming.durationLabel || base.durationLabel,
    createdAt: incoming.createdAt || base.createdAt
  };
}

function licenseChecksum(plan, expiry, serial) {
  return hash(`${plan}|${expiry}|${serial}|${LICENSE_SECRET}`).toString(36).toUpperCase().slice(0, 5).padStart(5, "0");
}

function hash(input) {
  let h = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    h ^= input.charCodeAt(index);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function randomSerial() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function parseExpiry(value) {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T23:59:59.999Z`;
}

function activationRoleMeta(key) {
  const roles = {
    teacher: { id: "teacher", label: "معلم", accessMode: "teacher" },
    admin: { id: "admin", label: "مشرف", accessMode: "admin" },
    delegate: { id: "delegate", label: "مندوب تحضير", accessMode: "delegate" }
  };
  return roles[key] || roles.teacher;
}

function activationPlanMeta(key, role = "teacher") {
  const plans = {
    week: { id: "week", label: "أسبوع", days: 7, remotePlan: "WEEK" },
    month: { id: "month", label: "شهر", days: 30, remotePlan: "MONTH" },
    quarter: { id: "quarter", label: "3 أشهر", days: 90, remotePlan: "QUARTER" },
    year: { id: "year", label: "سنة", days: 365, remotePlan: "YEAR" }
  };
  if (role === "admin" && key === "week") return plans.month;
  return plans[key] || plans.month;
}

function normalizePricing(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    currency: currencyMetaFor(source.currency || "SAR").id,
    teacher: {
      week: safePrice(source.teacher?.week, DEFAULT_ACTIVATION_PRICING.teacher.week),
      month: safePrice(source.teacher?.month, DEFAULT_ACTIVATION_PRICING.teacher.month),
      year: safePrice(source.teacher?.year, DEFAULT_ACTIVATION_PRICING.teacher.year)
    },
    admin: {
      month: safePrice(source.admin?.month, DEFAULT_ACTIVATION_PRICING.admin.month),
      year: safePrice(source.admin?.year, DEFAULT_ACTIVATION_PRICING.admin.year),
      extraTeacherMonth: safePrice(source.admin?.extraTeacherMonth ?? source.admin?.extraTeacher, DEFAULT_ACTIVATION_PRICING.admin.extraTeacherMonth),
      extraTeacherYear: safePrice(source.admin?.extraTeacherYear, DEFAULT_ACTIVATION_PRICING.admin.extraTeacherYear)
    },
    delegate: {
      week: safePrice(source.delegate?.week, DEFAULT_ACTIVATION_PRICING.delegate.week),
      month: safePrice(source.delegate?.month, DEFAULT_ACTIVATION_PRICING.delegate.month),
      year: safePrice(source.delegate?.year, DEFAULT_ACTIVATION_PRICING.delegate.year)
    }
  };
}

function safePrice(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function currencyMetaFor(currency) {
  return CURRENCY_RATES[currency] || CURRENCY_RATES.SAR;
}

function parseTeacherSlots(value) {
  const match = String(value || "").match(/(\d+)\s*معلم/);
  return match ? Math.max(0, Number(match[1] || 0)) : 0;
}

function parsePaymentAttempt(value) {
  return String(value || "").includes("محاولة دفع ثانية") ? 2 : 1;
}

function parseRequestKind(value) {
  return String(value || "").includes("إعادة تفعيل") ? "renewal" : "activation";
}

function normalizeArabicName(value = "") {
  return String(value)
    .trim()
    .replace(/[إأآا]/g, "ا")
    .replace(/[ىي]/g, "ي")
    .replace(/[ة]/g, "ه")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeManagedTeacherLimit(value, license = null) {
  const count = Math.max(0, Number(value || 0));
  if ((license?.accessMode || "") !== "admin") return count;
  // الرقم الذي يدفعه المشرف هو عدد الأكواد التابعة التي يستطيع إنشاءها، ولا نحسب حساب المشرف نفسه ضمنها.
  return count;
}

function durationLabelFor(value, unit) {
  const labels = { days: "أيام", weeks: "أسابيع", months: "شهور" };
  return `${value} ${labels[unit] || "شهور"}`;
}

function cleanDurationLabel(value = "") {
  return String(value || "").split(" || YUSR_META:")[0].split("|| YUSR_META:")[0].trim();
}

function accessModeLabel(value = "admin") {
  const labels = {
    admin: "مشرف",
    teacher: "معلم",
    delegate: "مندوب تحضير",
    readonly: "قراءة فقط"
  };
  return labels[normalizeAccessMode(value)] || labels.admin;
}

function expiryFromPlan(plan) {
  const date = new Date();
  date.setDate(date.getDate() + Number(plan.days || 30));
  date.setHours(23, 59, 59, 999);
  return date;
}

function requestStatusLabel(status) {
  if (status === "approved") return "تم التفعيل";
  if (status === "expired") return "منتهي";
  if (status === "rejected") return "مرفوض";
  if (status === "unpaid") return "لم يتم الدفع";
  if (status === "payment_review") return "تحقق من الدفع";
  return "بانتظار التحقق";
}

function normalizeAccessMode(mode) {
  const allowed = new Set(["admin", "teacher", "delegate", "readonly"]);
  return allowed.has(String(mode || "")) ? String(mode) : "admin";
}

function accessModeFromPlan(plan) {
  const normalized = String(plan || "").toUpperCase();
  if (normalized.includes("DELEGATE")) return "delegate";
  if (normalized.includes("TEACHER")) return "teacher";
  return "";
}

function accessModeFromRemoteRow(row = {}, fallbackMode = "") {
  const meta = parseLicenseMeta(row?.duration_label);
  const metaMode = normalizeAccessMode(meta.accessMode);
  if (["teacher", "delegate", "readonly"].includes(metaMode)) return metaMode;
  const planMode = accessModeFromPlan(row?.plan);
  if (planMode) return planMode;
  const explicitMode = normalizeAccessMode(row?.access_mode);
  if (["teacher", "delegate", "readonly"].includes(explicitMode)) return explicitMode;
  const fallback = normalizeAccessMode(fallbackMode);
  if (["teacher", "delegate", "readonly"].includes(fallback)) return fallback;
  return explicitMode;
}

function defaultPermissionsForMode(mode) {
  const normalized = normalizeAccessMode(mode);
  if (normalized === "delegate") {
    return normalizePermissions({
      attendance: true,
      schedule: true,
      studentAdd: true,
      studentEdit: true,
      studentRequests: true
    });
  }
  return normalizePermissions({
    subjects: true,
    students: true,
    attendance: true,
    schedule: true,
    grades: true,
    stats: true,
    settings: true,
    studentAdd: false,
    studentEdit: true,
    studentDelete: false,
    studentRequests: true,
    subjectManage: false,
    scheduleManage: false,
    gradeColumnManage: true,
    gradeBoost: true
  });
}

function normalizePermissions(value = {}) {
  const source = typeof value === "string" ? parsePermissions(value) || {} : value || {};
  return {
    subjects: Boolean(source.subjects),
    students: Boolean(source.students),
    attendance: Boolean(source.attendance),
    schedule: Boolean(source.schedule),
    grades: Boolean(source.grades),
    stats: Boolean(source.stats),
    settings: Boolean(source.settings),
    studentAdd: Boolean(source.studentAdd),
    studentEdit: source.studentEdit !== false,
    studentDelete: Boolean(source.studentDelete),
    studentRequests: source.studentRequests !== false,
    subjectManage: Boolean(source.subjectManage),
    scheduleManage: Boolean(source.scheduleManage),
    gradeColumnManage: source.gradeColumnManage !== false,
    gradeBoost: source.gradeBoost !== false
  };
}

function parsePermissions(value) {
  if (!value) return null;
  if (typeof value === "object") return normalizePermissions(value);
  try {
    return normalizePermissions(JSON.parse(value));
  } catch {
    return null;
  }
}

function attachLicenseMeta(label = "", meta = {}) {
  const cleanMeta = {
    accessMode: normalizeAccessMode(meta.accessMode),
    parentCode: meta.parentCode ? normalizeCode(meta.parentCode) : "",
    ownerName: String(meta.ownerName || "").trim(),
    permissions: normalizePermissions(meta.permissions || defaultPermissionsForMode(meta.accessMode)),
    teacherSlots: Math.max(0, Number(meta.teacherSlots || 0))
  };
  const hasUsefulMeta = cleanMeta.parentCode || cleanMeta.ownerName || cleanMeta.accessMode !== "admin";
  const cleanLabel = String(label || "").split(" || YUSR_META:")[0].trim();
  if (!hasUsefulMeta) return cleanLabel;
  return `${cleanLabel || durationLabelFor(1, "months")} || YUSR_META:${encodeLicenseMeta(cleanMeta)}`;
}

function parseLicenseMeta(label = "") {
  const marker = "YUSR_META:";
  const index = String(label || "").indexOf(marker);
  if (index === -1) return {};
  return decodeLicenseMeta(String(label).slice(index + marker.length).trim());
}

function encodeLicenseMeta(value) {
  try {
    return btoa(unescape(encodeURIComponent(JSON.stringify(value))));
  } catch {
    return "";
  }
}

function decodeLicenseMeta(value) {
  try {
    return JSON.parse(decodeURIComponent(escape(atob(value))));
  } catch {
    return {};
  }
}

function isAccessModeSchemaError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("access_mode")
    || message.includes("teacher_slots")
    || message.includes("permissions")
    || message.includes("parent_code")
    || message.includes("requested_role")
    || message.includes("quoted_price")
    || message.includes("display_price")
    || message.includes("currency")
    || message.includes("schema cache")
    || message.includes("column");
}

function isExpiredPendingRequest(request) {
  if (request.status !== "pending") return false;
  const createdAt = new Date(request.createdAt || request.created_at || Date.now());
  return Date.now() - createdAt.getTime() > 24 * 60 * 60 * 1000;
}

function isExpiredRequestLicense(request) {
  if (request.status === "payment_review") return false;
  const license = request.license;
  if (!license) return request.status === "approved";
  if (license.status === "revoked") return true;
  return new Date(license.expires_at) < startOfToday();
}

function isExpiredLicense(value) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date < startOfToday();
}

function isBrowserOnline() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}
