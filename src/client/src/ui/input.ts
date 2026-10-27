import { launchSpeed, MIN_DRAG } from "../engine/constants";
import type { TeamBody } from "../engine/body";
import type { Drag, Renderer, ViewState } from "../render/renderer";
import type { Match } from "../rules/match";

/** Press on a player, drag back, release: the slingshot flick. */
export class Input {
  drag: Drag | null = null;
  hover: TeamBody | null = null;
  private readonly match: Match;

  constructor(cv: HTMLCanvasElement, match: Match, renderer: Renderer, onFirstTouch: () => void) {
    this.match = match;
    cv.addEventListener("pointerdown", (e) => {
      onFirstTouch();
      if (match.phase === "replay") return match.endReplay();
      if (!match.canAim()) return;
      const w = renderer.toWorld(e.clientX, e.clientY);
      const p = match.pickPlayer(w.x, w.y);
      if (!p) {
        match.tappedLocked(w.x, w.y);
        return;
      }
      this.drag = { p, x: w.x, y: w.y, block: match.phase === "block" };
      cv.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    cv.addEventListener("pointermove", (e) => {
      const w = renderer.toWorld(e.clientX, e.clientY);
      if (this.drag) {
        this.drag.x = w.x;
        this.drag.y = w.y;
        return;
      }
      this.hover = match.canAim() ? match.pickPlayer(w.x, w.y) : null;
    });
    cv.addEventListener("pointerup", () => this.release(false));
    cv.addEventListener("pointercancel", () => this.release(true));
    cv.addEventListener("pointerleave", () => {
      this.hover = null;
    });
  }

  private release(cancel: boolean): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    const p = drag.p;
    const dx = p.x - drag.x;
    const dy = p.y - drag.y;
    const d = Math.hypot(dx, dy);
    if (cancel || d < MIN_DRAG) return;
    const v = launchSpeed(d);
    this.match.humanFlick(p, (dx / d) * v, (dy / d) * v);
  }

  /** Drops a drag the match no longer allows (half time, restart, Cup opened). */
  tick(): void {
    if (!this.match.canAim()) {
      this.drag = null;
      this.hover = null;
    }
  }

  clear(): void {
    this.drag = null;
    this.hover = null;
  }

  view(): ViewState {
    return { drag: this.drag, hover: this.hover };
  }
}
