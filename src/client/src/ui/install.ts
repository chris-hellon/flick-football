import { el } from "./dom";

/** What Chrome, Edge and Android hand over when the page can be installed. */
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const standalone = (): boolean =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** iPhone and iPad Safari can't prompt; they install from the Share menu. */
const isIos = (): boolean =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** The "Install the app" button where the browser offers it, or the Share tip on iPhone. */
export function initInstall(): void {
  const box = el("getApp");
  const btn = el<HTMLButtonElement>("installBtn");
  const tip = el("iosTip");
  let deferred: InstallPrompt | null = null;

  const sync = (): void => {
    const installed = standalone();
    btn.hidden = installed || !deferred;
    tip.hidden = installed || !!deferred || !isIos();
    box.hidden = btn.hidden && tip.hidden;
  };

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPrompt;
    sync();
  });
  btn.addEventListener("click", async () => {
    const d = deferred;
    if (!d) return;
    deferred = null;
    await d.prompt();
    await d.userChoice;
    sync();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    sync();
  });
  sync();
}

/** Shows the "Buy me a coffee" links when one is configured. */
export function initTip(url: string): void {
  for (const id of ["tipLink", "ftTip"]) {
    const a = el<HTMLAnchorElement>(id);
    a.hidden = !url;
    if (url) a.href = url;
  }
}
