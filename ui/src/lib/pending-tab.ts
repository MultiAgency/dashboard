export type PendingTab = { go: (href: string) => void; close: () => void };

export function openPendingTab(message: string): PendingTab {
  const tab = typeof window === "undefined" ? null : window.open("", "_blank");
  if (tab) {
    try {
      tab.opener = null;
      tab.document.title = message;
      tab.document.body.textContent = message;
    } catch {}
  }
  return {
    go: (href) => {
      if (tab && !tab.closed) tab.location.href = href;
      else window.open(href, "_blank", "noopener,noreferrer");
    },
    close: () => {
      if (tab && !tab.closed) tab.close();
    },
  };
}
