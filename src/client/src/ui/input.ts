import { launchSpeed, MIN_DRAG } from "../engine/constants";
import type { TeamBody } from "../engine/body";
import type { AimDto } from "../net/protocol";
import type { Drag, Renderer, ViewState } from "../render/renderer";
import type { Phase } from "../rules/match";

/** What the pointer may do right now; the app decides (offline, hosting or guest). */
export interface Controls {
  phase(): Phase;
  canAim(): boolean;
  pickPlayer(x: number, y: number): TeamBody | null;
  tappedLocked(x: number, y: number): void;
  flick(p: TeamBody, vx: number, vy: number): void;
  /** The aim preview while dragging (null when the drag ends). */
  aim(a: AimDto | null): void;
  replayTap(): void;
}

/** Press on a player, drag back, release: the slingshot flick. */
export class Input {
  drag: Drag | null = null;
  hover: TeamBody | null = null;
  private readonly controls: Controls;

  constructor(
    cv: HTMLCanvasElement,
    controls: Controls,
    renderer: Renderer,
    onFirstTouch: () => void,
  ) {
    this.controls = controls;
    cv.addEventListener("pointerdown", (e) => {
      onFirstTouch();
      if (controls.phase() === "replay") return controls.replayTap();
      if (!controls.canAim()) return;
      const w = renderer.toWorld(e.clientX, e.clientY);
      const p = controls.pickPlayer(w.x, w.y);
      if (!p) return controls.tappedLocked(w.x, w.y);
      this.drag = { p, x: w.x, y: w.y, block: controls.phase() === "block" };
      cv.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    cv.addEventListener("pointermove", (e) => {
      const w = renderer.toWorld(e.clientX, e.clientY);
      if (this.drag) {
        this.drag.x = w.x;
        this.drag.y = w.y;
        controls.aim(this.aim());
        return;
      }
      this.hover = controls.canAim() ? controls.pickPlayer(w.x, w.y) : null;
    });
    cv.addEventListener("pointerup", () => this.release(false));
    cv.addEventListener("pointercancel", () => this.release(true));
    cv.addEventListener("pointerleave", () => {
      this.hover = null;
    });
  }

  /** The current drag as a flick velocity, for aim previews. */
  aim(): AimDto | null {
    const drag = this.drag;
    if (!drag) return null;
    const dx = drag.p.x - drag.x;
    const dy = drag.p.y - drag.y;
    const d = Math.hypot(dx, dy);
    if (d < 4) return null;
    const v = launchSpeed(d);
    return {
      id: drag.p.id,
      vx: Math.round((dx / d) * v),
      vy: Math.round((dy / d) * v),
      b: drag.block ? 1 : 0,
    };
  }

  private release(cancel: boolean): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    this.controls.aim(null);
    const p = drag.p;
    const dx = p.x - drag.x;
    const dy = p.y - drag.y;
    const d = Math.hypot(dx, dy);
    if (cancel || d < MIN_DRAG) return;
    const v = launchSpeed(d);
    this.controls.flick(p, (dx / d) * v, (dy / d) * v);
  }

  /** Drops a drag the rules no longer allow (half time, restart, Cup opened). */
  tick(): void {
    if (!this.controls.canAim()) this.clear();
  }

  clear(): void {
    if (this.drag) this.controls.aim(null);
    this.drag = null;
    this.hover = null;
  }

  view(): ViewState {
    return { drag: this.drag, hover: this.hover };
  }
}
