import { renderIcons } from "../utils/dom.js?v=35";

// مكوّن التنبيهات الصغيرة التي تظهر أسفل الشاشة ثم تختفي تلقائيًا.
export class Toast {
  constructor(root) {
    this.root = root;
  }

  show(message, type = "info") {
    // نوع التنبيه يحدد اللون والأيقونة: نجاح، خطأ، أو معلومة.
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    const icon = type === "success" ? "check-circle-2" : type === "error" ? "circle-alert" : "sparkles";
    toast.innerHTML = `<i data-lucide="${icon}"></i><span>${message}</span>`;
    this.root.append(toast);
    renderIcons();
    setTimeout(() => toast.remove(), 3600);
  }
}
