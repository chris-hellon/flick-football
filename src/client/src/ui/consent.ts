import { el } from "./dom";
import { store } from "./settings";

/**
 * Cookie consent for Google Analytics. Nothing from Google loads until the player taps Accept;
 * the choice is remembered on this device and can be changed from "Cookie settings".
 */
type Choice = "granted" | "denied";

type Gtag = (...args: unknown[]) => void;
declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
  }
}

const saved = (): Choice | null => {
  const v = store.get("consent");
  return v === "granted" || v === "denied" ? v : null;
};

let loaded = false;

/** Loads gtag.js and starts measuring. Only ever called after consent. */
function loadAnalytics(id: string): void {
  if (loaded || !id) return;
  loaded = true;
  window.dataLayer = window.dataLayer ?? [];
  // gtag must push the arguments object itself, as Google's snippet does.
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer?.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", id);
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.append(s);
}

/** Stops measuring after a change of mind, and removes Google's cookies from this site. */
function stopAnalytics(): void {
  window.gtag?.("consent", "update", { analytics_storage: "denied" });
  for (const c of document.cookie.split(";")) {
    const name = c.split("=")[0]?.trim();
    if (!name || !/^_ga/.test(name)) continue;
    for (const domain of ["", `; domain=${location.hostname}`, `; domain=.${location.hostname}`])
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain}`;
  }
}

export function initConsent(gaId: string): void {
  const banner = el("consent");
  const choose = (c: Choice): void => {
    store.set("consent", c);
    banner.hidden = true;
    if (c === "granted") {
      window.gtag?.("consent", "update", { analytics_storage: "granted" });
      loadAnalytics(gaId);
    } else stopAnalytics();
  };
  el("consentYes").addEventListener("click", () => choose("granted"));
  el("consentNo").addEventListener("click", () => choose("denied"));
  el("cookieBtn").addEventListener("click", () => {
    banner.hidden = false;
    el("consentYes").focus();
  });

  const c = saved();
  if (c === "granted") loadAnalytics(gaId);
  // Ask once, but only where there's something to ask about (not in development).
  banner.hidden = c !== null || !gaId;
  // With no analytics there are no cookies, so there's nothing to set.
  el("cookieBtn").hidden = !gaId;
}
