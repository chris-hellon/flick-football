import type { TeamBody } from "../engine/body";
import { CX, H, launchSpeed, MAXDRAG, VH, VW, VX0, VY0, W } from "../engine/constants";
import { type Match, PLACE_R } from "../rules/match";
import { clamp } from "../util/math";
import { COL, DISPLAY } from "./colours";
import { drawAim, drawBall, drawFigure } from "./figures";
import { drawPitch, makeNoise, upright } from "./pitch";

export interface Drag {
  p: TeamBody;
  /** Where the press started, in world units. */
  sx: number;
  sy: number;
  /** Pointer position in world units. */
  x: number;
  y: number;
  block: boolean;
}

/**
 * The pull of a drag: from where the press started back to the pointer, so a tiny pull is a
 * tiny flick wherever on the player you pressed. The flick goes the opposite way.
 */
export function pull(drag: Drag): { dx: number; dy: number; d: number } {
  const dx = drag.sx - drag.x;
  const dy = drag.sy - drag.y;
  return { dx, dy, d: Math.hypot(dx, dy) };
}

export interface ViewState {
  drag: Drag | null;
  hover: TeamBody | null;
  /** Dragging the restart taker into place right now. */
  placing?: boolean;
  /** Show the ring the restart taker can be moved within. */
  placeRing?: boolean;
  /** Another player's aim to show faded (online, from Phase 2). */
  remoteAim?: { p: TeamBody; vx: number; vy: number; block: boolean } | null;
}

/** Draws the match onto the stage canvas, scaled to fit and centred. */
export class Renderer {
  /** Turns the view round (the online guest sees their own goal at the bottom). */
  flip = false;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly view = { s: 1, ox: 0, oy: 0, dpr: 1 };
  private pitchCache: HTMLCanvasElement | null = null;
  private noise: CanvasPattern | null = null;
  private readonly cv: HTMLCanvasElement;
  private readonly stage: HTMLElement;

  constructor(cv: HTMLCanvasElement, stage: HTMLElement) {
    const ctx = cv.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not available");
    this.cv = cv;
    this.stage = stage;
    this.ctx = ctx;
  }

  resize(): void {
    const r = this.stage.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const v = this.view;
    v.dpr = dpr;
    this.cv.width = Math.round(r.width * dpr);
    this.cv.height = Math.round(r.height * dpr);
    v.s = Math.min(r.width / VW, r.height / VH);
    v.ox = (r.width - VW * v.s) / 2;
    v.oy = (r.height - VH * v.s) / 2;
    const cache = document.createElement("canvas");
    cache.width = this.cv.width;
    cache.height = this.cv.height;
    const pc = cache.getContext("2d");
    if (pc) {
      this.noise ??= makeNoise(pc);
      this.applyWorld(pc);
      drawPitch(pc, this.flip, this.noise);
    }
    this.pitchCache = cache;
  }

  private applyWorld(c: CanvasRenderingContext2D): void {
    const { dpr: d, s, ox, oy } = this.view;
    if (this.flip)
      c.setTransform(-s * d, 0, 0, -s * d, (ox + (VX0 + VW) * s) * d, (oy + (VY0 + VH) * s) * d);
    else c.setTransform(s * d, 0, 0, s * d, (ox - VX0 * s) * d, (oy - VY0 * s) * d);
  }

  toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.cv.getBoundingClientRect();
    const sx = (clientX - r.left - this.view.ox) / this.view.s;
    const sy = (clientY - r.top - this.view.oy) / this.view.s;
    return this.flip ? { x: VX0 + VW - sx, y: VY0 + VH - sy } : { x: sx + VX0, y: sy + VY0 };
  }

  render(m: Match, vs: ViewState): void {
    const c = this.ctx;
    const { world, phase } = m;
    const flip = this.flip;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.cv.width, this.cv.height);
    if (this.pitchCache) c.drawImage(this.pitchCache, 0, 0);
    this.applyWorld(c);

    // Keeper rods back through the goal.
    c.strokeStyle = COL.rod;
    c.lineWidth = 2.5;
    for (const k of world.keepers) {
      c.beginPath();
      c.moveTo(k.x, k.y);
      c.lineTo(k.x, k.y > H / 2 ? H + 52 : -52);
      c.stroke();
    }

    // Rings on the side that can flick.
    const pulse = 0.5 + 0.5 * Math.sin(m.clock * 5);
    if (
      m.cfg &&
      (phase === "aim" || phase === "think" || phase === "block" || phase === "blockthink")
    ) {
      const a = m.actor();
      // While a keeper has the ball, only that keeper is ringed.
      const flickers = m.keeperBall === a && phase !== "block" ? [world.keepers[a]] : world.players;
      for (const p of flickers) {
        if (p.team !== a) continue;
        c.save();
        if (a === m.turn && p.id === m.locked) {
          c.strokeStyle = "rgba(0,0,0,.45)";
          c.lineWidth = 2;
          c.setLineDash([3, 4]);
        } else {
          const base = phase === "block" || phase === "blockthink" ? "143,196,234" : "246,243,232";
          c.strokeStyle = p === vs.hover ? COL.amber : `rgba(${base},${0.35 + pulse * 0.35})`;
          c.lineWidth = p === vs.hover ? 3 : 2;
        }
        c.beginPath();
        c.arc(p.x, p.y, p.r + 5, 0, Math.PI * 2);
        c.stroke();
        c.restore();
      }
    }

    // Where the throw-in or corner taker can be moved to.
    if (vs.placeRing) {
      const b = world.ball;
      c.save();
      c.fillStyle = vs.placing ? "rgba(243,177,58,.12)" : "rgba(246,243,232,.06)";
      c.strokeStyle = vs.placing ? COL.amber : `rgba(246,243,232,${0.4 + pulse * 0.25})`;
      c.lineWidth = 2;
      c.setLineDash([6, 6]);
      c.beginPath();
      c.arc(b.x, b.y, PLACE_R, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.restore();
    }

    for (const k of world.keepers) drawFigure(c, k, m.kits[k.team], true, m.up(k.team));
    for (const p of world.players) drawFigure(c, p, m.kits[p.team], false, m.up(p.team));
    drawBall(c, world.ball);

    const drag = vs.drag;
    if (drag) {
      const p = drag.p;
      const { dx, dy, d } = pull(drag);
      if (d > 4) {
        const v = launchSpeed(d);
        const cd = Math.min(d, MAXDRAG);
        c.save();
        c.strokeStyle = "rgba(0,0,0,.4)";
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(p.x, p.y);
        c.lineTo(p.x - (dx / d) * cd, p.y - (dy / d) * cd);
        c.stroke();
        c.restore();
        drawAim(c, p, (dx / d) * v, (dy / d) * v, 1, drag.block);
      }
    }
    if (m.aiPlan)
      drawAim(
        c,
        m.aiPlan.p,
        m.aiPlan.vx,
        m.aiPlan.vy,
        Math.min(m.aiPlan.t * 3, 0.9),
        m.aiPlan.block,
      );
    const ra = vs.remoteAim;
    if (ra && !drag && (phase === "aim" || phase === "block"))
      drawAim(c, ra.p, ra.vx, ra.vy, 0.75, ra.block);

    for (const f of m.floaters) {
      c.save();
      c.globalAlpha = clamp(1.4 - f.t, 0, 1);
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.font = `900 30px ${DISPLAY}`;
      c.lineWidth = 5;
      c.strokeStyle = "rgba(0,0,0,.55)";
      upright(c, flip, f.x, f.y + (flip ? 1 : -1) * f.t * 30, () => {
        c.strokeText(f.text, 0, 0);
        c.fillStyle = COL.amber;
        c.fillText(f.text, 0, 0);
      });
      c.restore();
    }

    if (phase === "replay") {
      upright(c, flip, flip ? VX0 + VW - 10 : -40, flip ? VY0 + VH - 8 : -50, () => {
        c.fillStyle = "rgba(10,16,12,.75)";
        c.fillRect(0, 0, 150, 34);
        c.fillStyle = COL.red;
        c.globalAlpha = 0.5 + pulse * 0.5;
        c.beginPath();
        c.arc(18, 17, 7, 0, Math.PI * 2);
        c.fill();
        c.globalAlpha = 1;
        c.fillStyle = COL.chalk;
        c.font = `800 24px ${DISPLAY}`;
        c.textBaseline = "middle";
        c.fillText("REPLAY", 32, 18);
      });
    }

    const banner = m.banner;
    if (banner) {
      c.save();
      c.globalAlpha = Math.min(banner.t * 4, 1);
      c.textAlign = "center";
      c.fillStyle = "rgba(10,16,12,.75)";
      c.fillRect(-46, H / 2 - 74, W + 92, 148);
      c.fillStyle = COL.amber;
      c.font = `900 ${banner.text.length > 6 ? 86 : 104}px ${DISPLAY}`;
      c.textBaseline = "middle";
      upright(c, flip, CX, H / 2, () => {
        c.fillText(banner.text, 0, -12);
        c.fillStyle = banner.color;
        c.font = `800 26px ${DISPLAY}`;
        c.fillText(banner.sub.toUpperCase(), 0, 46);
      });
      c.restore();
    }
  }
}
