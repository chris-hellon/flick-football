import { el } from "./dom";
import { store } from "./settings";

export const TABS = ["play", "club", "cup", "results", "rules"] as const;
export type Tab = (typeof TABS)[number];
const isTab = (v: unknown): v is Tab => TABS.includes(v as Tab);

/** A small marker on a tab: something new to look at, or an online match in progress. */
export type TabFlag = "new" | "live" | null;

let current: Tab = "play";

const tabButton = (t: Tab): HTMLButtonElement => el<HTMLButtonElement>(`tab-${t}`);

/** Shows one panel of the side menu. focus: move keyboard focus to its tab (arrow keys). */
export function selectTab(t: Tab, focus = false): void {
  current = t;
  for (const x of TABS) {
    const on = x === t;
    const b = tabButton(x);
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
    el(`pane-${x}`).hidden = !on;
  }
  // Looking at a tab clears its "new" marker (a live match keeps its marker).
  if (tabButton(t).dataset.flag === "new") flagTab(t, null);
  if (focus) tabButton(t).focus();
  store.set("tab", t);
}

export const currentTab = (): Tab => current;

export function flagTab(t: Tab, flag: TabFlag): void {
  const b = tabButton(t);
  if (flag === "new" && t === current) return;
  if (flag) b.dataset.flag = flag;
  else delete b.dataset.flag;
}

/** Wires the tab bar (click, arrow keys, Home/End) and opens the tab used last time. */
export function initTabs(): void {
  const saved = store.get("tab");
  selectTab(isTab(saved) ? saved : "play");
  el("tabs").addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[role=tab]")?.dataset.tab;
    if (isTab(t)) selectTab(t);
  });
  el("tabs").addEventListener("keydown", (e) => {
    const i = TABS.indexOf(current);
    const next =
      e.key === "ArrowRight"
        ? TABS[(i + 1) % TABS.length]
        : e.key === "ArrowLeft"
          ? TABS[(i + TABS.length - 1) % TABS.length]
          : e.key === "Home"
            ? TABS[0]
            : e.key === "End"
              ? TABS[TABS.length - 1]
              : undefined;
    if (!next) return;
    e.preventDefault();
    selectTab(next, true);
  });
}
