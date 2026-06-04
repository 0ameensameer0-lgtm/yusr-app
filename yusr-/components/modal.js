import { renderIcons } from "../utils/dom.js?v=35";

// مكوّن موحد لكل النوافذ المنبثقة حتى لا تتكرر أكواد المودال داخل الصفحات.
export class Modal {
  constructor(root) {
    this.root = root;
  }

  open({ title, body, actions = [] }) {
    // actions تستقبل أزرارًا قابلة للتنفيذ، ويمكن للدالة إرجاع false لمنع إغلاق النافذة.
    this.root.innerHTML = `
      <div class="modal-backdrop" role="dialog" aria-modal="true">
        <article class="modal">
          <header>
            <h2>${title}</h2>
            <button class="icon-button" data-modal-close aria-label="إغلاق"><i data-lucide="x"></i></button>
          </header>
          <div class="modal-body">${body}</div>
          <footer>
            ${actions.map((action, index) => `<button class="${action.variant === "primary" ? "primary-button" : action.variant === "danger" ? "danger-button" : "ghost-button"}" data-action="${index}">${action.label}</button>`).join("")}
          </footer>
        </article>
      </div>
    `;
    this.root.querySelector("[data-modal-close]").addEventListener("click", () => this.close());
    this.root.querySelector(".modal-backdrop").addEventListener("click", (event) => {
      if (event.target.classList.contains("modal-backdrop")) this.close();
    });
    actions.forEach((action, index) => {
      this.root.querySelector(`[data-action="${index}"]`).addEventListener("click", async () => {
        if (action.action === "close") return this.close();
        if (typeof action.action === "function") {
          const shouldClose = await action.action(this.root);
          if (shouldClose !== false) this.close();
        }
      });
    });
    renderIcons();
  }

  close() {
    this.root.innerHTML = "";
  }

  confirm({ title, message, confirmLabel = "تأكيد", cancelLabel = "إلغاء", danger = true }) {
    // confirm يغلف المودال داخل Promise حتى نستطيع استخدام await قبل الحذف أو العمليات الحساسة.
    return new Promise((resolve) => {
      this.open({
        title,
        body: `
          <div class="empty-state compact confirm-state">
            <div class="confirm-icon"><i data-lucide="triangle-alert"></i></div>
            <h3>${title}</h3>
            <p>${message}</p>
          </div>
        `,
        actions: [
          { label: cancelLabel, action: () => resolve(false) },
          { label: confirmLabel, variant: danger ? "danger" : "primary", action: () => resolve(true) }
        ]
      });
    });
  }
}
