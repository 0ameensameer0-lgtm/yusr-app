const dayOrder = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const nativeDayIndex = { "الأحد": 0, "الاثنين": 1, "الثلاثاء": 2, "الأربعاء": 3, "الخميس": 4, "الجمعة": 5, "السبت": 6 };

export class NotificationService {
  constructor(store, toast) {
    this.store = store;
    this.toast = toast;
    this.timer = null;
    this.lastNotificationKey = "";
    window.addEventListener("store-updated", () => this.scheduleNextLessonReminder());
  }

  async requestPermissionAndStart() {
    if (!("Notification" in window)) {
      this.toast.show("الإشعارات غير مدعومة في هذا المتصفح", "error");
      return false;
    }
    const result = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (result !== "granted") {
      this.toast.show("لم يتم منح صلاحية الإشعارات", "info");
      return false;
    }
    await this.store.updateSettings({ deviceNotifications: true, lessonReminders: true });
    this.scheduleNextLessonReminder();
    this.toast.show("تم تفعيل تذكير الحصص", "success");
    return true;
  }

  start() {
    this.scheduleNextLessonReminder();
  }

  scheduleNextLessonReminder() {
    clearTimeout(this.timer);
    const settings = this.store.getSettings();
    if (!settings.deviceNotifications || !settings.lessonReminders || Notification?.permission !== "granted") return;
    const next = this.getNextLessonReminder();
    if (!next) return;
    const delay = Math.max(0, next.remindAt.getTime() - Date.now());
    this.timer = setTimeout(() => {
      this.showLessonReminder(next);
      this.scheduleNextLessonReminder();
    }, Math.min(delay, 2147483647));
  }

  getNextLessonReminder() {
    const settings = this.store.getSettings();
    const minutes = Number(settings.reminderMinutes || 15);
    const now = new Date();
    const institutions = this.store.getInstitutions();
    const lessons = this.store.getSchedule()
      .map((lesson) => {
        const institution = institutions.find((item) => item.id === lesson.institutionId);
        const subject = this.store.getSubject(lesson.subjectId);
        const startsAt = nextLessonDate(lesson.day, lesson.start, now);
        const remindAt = new Date(startsAt.getTime() - minutes * 60 * 1000);
        return { lesson, institution, subject, startsAt, remindAt };
      })
      .filter((item) => item.remindAt >= now || item.startsAt >= now)
      .sort((a, b) => a.remindAt - b.remindAt);
    return lessons[0] || null;
  }

  async showLessonReminder(item) {
    const key = `${item.lesson.id}-${item.startsAt.toISOString()}`;
    if (this.lastNotificationKey === key) return;
    this.lastNotificationKey = key;
    const institution = item.institution?.name || "جهة غير محددة";
    const subject = item.subject?.name || "مادة غير محددة";
    const time = `${item.lesson.start} - ${item.lesson.end}`;
    const body = `${institution}\n${subject}\nالوقت: ${time}`;
    const title = "تذكير بالحصة";
    const options = {
      body,
      tag: key,
      icon: "./assets/yusr-app-icon.png",
      badge: "./assets/icon-192.svg",
      data: { url: "#/schedule" }
    };
    const registration = await navigator.serviceWorker?.ready.catch(() => null);
    if (registration?.showNotification) registration.showNotification(title, options);
    else new Notification(title, options);
  }
}

function nextLessonDate(day, time, fromDate) {
  const [hours, minutes] = String(time || "00:00").split(":").map(Number);
  const targetDay = nativeDayIndex[day] ?? dayOrder.indexOf(day);
  const date = new Date(fromDate);
  date.setHours(hours || 0, minutes || 0, 0, 0);
  const diff = (targetDay - fromDate.getDay() + 7) % 7;
  date.setDate(fromDate.getDate() + diff);
  if (date <= fromDate) date.setDate(date.getDate() + 7);
  return date;
}
