(function () {
  "use strict";

  const routeIcons = {
    home: "fa-house",
    punch: "fa-fingerprint",
    location: "fa-location-dot",
    requests: "fa-file-signature",
    "action-center": "fa-bell",
    notifications: "fa-bell",
    kpi: "fa-chart-line",
    team: "fa-people-group",
    "manager-hub": "fa-user-tie",
    "manager-kpi": "fa-square-poll-vertical",
    "committee-hub": "fa-scale-balanced",
    disputes: "fa-handshake-angle",
    profile: "fa-user-gear",
    settings: "fa-gear",
    decisions: "fa-bullhorn",
    risk: "fa-shield-halved",
    employees: "fa-users",
    attendance: "fa-calendar-check",
    reports: "fa-file-pdf",
    users: "fa-user-lock",
    audit: "fa-clock-rotate-left",
    documents: "fa-folder-open",
  };

  const textIcons = [
    [/واتساب|whatsapp/i, "fa-brands fa-whatsapp"],
    [/اتصال|هاتف|phone|call/i, "fa-solid fa-phone"],
    [/تفاصيل|عرض|فتح/i, "fa-solid fa-arrow-up-right-from-square"],
    [/رجوع|عودة/i, "fa-solid fa-arrow-right"],
    [/تحديث|refresh/i, "fa-solid fa-rotate"],
    [/تطبيق|بحث|filter/i, "fa-solid fa-filter"],
    [/تصدير|PDF|تقرير/i, "fa-solid fa-file-pdf"],
    [/حفظ/i, "fa-solid fa-floppy-disk"],
    [/إرسال|ارسال|طلب/i, "fa-solid fa-paper-plane"],
    [/اعتماد|مقبول|معتمد/i, "fa-solid fa-circle-check"],
    [/رفض|مرفوض/i, "fa-solid fa-circle-xmark"],
    [/خروج|logout/i, "fa-solid fa-right-from-bracket"],
    [/موقع|لوكيشن|GPS|خريطة/i, "fa-solid fa-location-dot"],
    [/إجازة|اجازة/i, "fa-solid fa-umbrella-beach"],
    [/مأمورية/i, "fa-solid fa-route"],
    [/حضور|بصمة/i, "fa-solid fa-fingerprint"],
    [/موظف|الموظفين|فريق/i, "fa-solid fa-users"],
    [/إعدادات|اعدادات|كلمة المرور/i, "fa-solid fa-gear"],
  ];

  function iconClassFor(element) {
    const route = element.getAttribute("data-route") || "";
    if (route && routeIcons[route]) return `fa-solid ${routeIcons[route]}`;
    const href = element.getAttribute("href") || "";
    if (href.startsWith("tel:")) return "fa-solid fa-phone";
    if (/wa\.me|whatsapp/i.test(href)) return "fa-brands fa-whatsapp";
    const text = (element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent || "").trim();
    const match = textIcons.find(([pattern]) => pattern.test(text));
    return match ? match[1] : "";
  }

  function hasIcon(element) {
    return Boolean(element.querySelector(":scope > .fa-solid, :scope > .fa-regular, :scope > .fa-brands"));
  }

  function buttonText(element) {
    return (element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent || "").trim();
  }

  function stripLeadingEmojiText(element) {
    if (!(element instanceof HTMLElement)) return;
    const emojiPattern = /^[\s\p{Extended_Pictographic}\uFE0F\u200D↩✓⚠🔴]+/u;
    element.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        node.textContent = String(node.textContent || "").replace(emojiPattern, "");
      }
    });
  }

  function normalizeButton(element) {
    if (!(element instanceof HTMLElement)) return;
    const isButton = element.matches("button, a.button, .button, .btn");
    if (!isButton || element.dataset.buttonReady === "1") return;

    if (!element.classList.contains("button") && !element.classList.contains("btn")) {
      element.classList.add("button");
    }

    if (
      !element.classList.contains("primary") &&
      !element.classList.contains("ghost") &&
      !element.classList.contains("danger") &&
      !element.classList.contains("icon-only") &&
      !element.classList.contains("icon-action")
    ) {
      const text = buttonText(element);
      if (element.matches(".compact-metric-badge, .quick-action-card, .employee-bottom-nav button")) {
        element.classList.add("ghost");
      } else if (/حذف|رفض|مرفوض|خروج|logout|delete|remove|reject/i.test(text)) {
        element.classList.add("danger");
      } else if (/إرسال|ارسال|حفظ|اعتماد|معتمد|تطبيق|طلب|تصدير|submit|save|approve|send|export/i.test(text)) {
        element.classList.add("primary");
      } else {
        element.classList.add("ghost");
      }
    }

    const visibleText = element.textContent.trim();
    if (!visibleText && (element.getAttribute("aria-label") || element.getAttribute("title"))) {
      element.classList.add("icon-only");
    }

    element.dataset.buttonReady = "1";
  }

  function decorateAction(element) {
    if (!(element instanceof HTMLElement) || element.dataset.iconReady === "1") return;
    if (!element.matches("button, a.button, .quick-action-card, .more-drawer-item, .compact-metric-badge")) return;
    if (hasIcon(element)) {
      element.dataset.iconReady = "1";
      return;
    }
    const iconClass = iconClassFor(element);
    if (!iconClass) return;
    const icon = document.createElement("i");
    icon.className = iconClass;
    icon.setAttribute("aria-hidden", "true");
    stripLeadingEmojiText(element);
    element.prepend(icon);
    element.classList.add("ui-iconized");
    element.dataset.iconReady = "1";
  }

  function decorateScope(scope = document) {
    scope.querySelectorAll?.("button, a.button, .button, .btn").forEach(normalizeButton);
    scope.querySelectorAll?.("button, a.button, .quick-action-card, .more-drawer-item, .compact-metric-badge").forEach(decorateAction);
    scope.querySelectorAll?.("table").forEach(decorateTable);
  }

  function decorateTable(table) {
    if (!(table instanceof HTMLTableElement) || table.dataset.labelsReady === "1") return;
    const headers = Array.from(table.querySelectorAll("thead th")).map((cell) => cell.textContent.trim()).filter(Boolean);
    if (!headers.length) return;
    table.querySelectorAll("tbody tr").forEach((row) => {
      Array.from(row.children).forEach((cell, index) => {
        if (cell instanceof HTMLElement && !cell.hasAttribute("data-label")) {
          cell.setAttribute("data-label", headers[index] || "");
        }
      });
    });
    table.classList.add("ui-table-cards");
    table.dataset.labelsReady = "1";
  }

  function start() {
    document.documentElement.classList.add("fontawesome-ready");
    decorateScope(document);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          normalizeButton(node);
          decorateAction(node);
          decorateScope(node);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
