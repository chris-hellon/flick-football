import { MAXV, RB } from "../engine/constants";
import type { Ball } from "../engine/body";
import type { Club } from "../rules/clubs";
import { clamp } from "../util/math";
import { COL } from "./colours";

type Ctx = CanvasRenderingContext2D;

function shoulders(
  c: Ctx,
  x: number,
  y: number,
  rx: number,
  ry: number,
  k: Club,
  keeper: boolean,
): void {
  c.save();
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  c.fillStyle = keeper ? k.gk : k.shirt;
  c.fill();
  if (!keeper && k.pat !== "solid") {
    c.clip();
    c.fillStyle = k.alt;
    if (k.pat === "stripes") {
      const w = (rx * 2) / 7;
      for (let i = 0; i < 3; i++) c.fillRect(x - rx + w * (1 + 2 * i), y - ry, w, ry * 2);
    } else if (k.pat === "hoops") c.fillRect(x - rx, y - ry * 0.28, rx * 2, ry * 0.56);
    else if (k.pat === "halves") c.fillRect(x, y - ry, rx, ry * 2);
    else if (k.pat === "sash") {
      c.translate(x, y);
      c.rotate(-0.7);
      c.fillRect(-rx * 1.3, -ry * 0.35, rx * 2.6, ry * 0.7);
    }
  }
  c.restore();
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  c.strokeStyle = "rgba(0,0,0,.4)";
  c.lineWidth = 1;
  c.stroke();
}

/** A figure on its domed base; faceUp says which goal it faces. */
export function drawFigure(
  c: Ctx,
  p: { x: number; y: number; r: number },
  k: Club,
  keeper: boolean,
  faceUp: boolean,
): void {
  const r = p.r;
  c.fillStyle = COL.shadow;
  c.beginPath();
  c.ellipse(p.x + 3, p.y + 4, r * 1.02, r * 0.95, 0, 0, Math.PI * 2);
  c.fill();
  const g = c.createRadialGradient(p.x - r * 0.35, p.y - r * 0.4, r * 0.1, p.x, p.y, r);
  g.addColorStop(0, k.base);
  g.addColorStop(1, k.baseDk);
  c.fillStyle = g;
  c.beginPath();
  c.arc(p.x, p.y, r, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = k.rim;
  c.lineWidth = 2;
  c.beginPath();
  c.arc(p.x, p.y, r * 0.66, 0, Math.PI * 2);
  c.stroke();
  const face = faceUp ? -1 : 1;
  shoulders(c, p.x, p.y - face, r * 0.62, r * 0.3, k, keeper);
  c.fillStyle = k.head;
  c.beginPath();
  c.arc(p.x, p.y + face * 1.5, r * 0.24, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "rgba(255,255,255,.22)";
  c.beginPath();
  c.ellipse(p.x - r * 0.45, p.y - r * 0.5, r * 0.22, r * 0.12, -0.6, 0, Math.PI * 2);
  c.fill();
}

export function drawBall(c: Ctx, b: Ball): void {
  c.fillStyle = COL.shadow;
  c.beginPath();
  c.ellipse(b.x + 2.5, b.y + 3, RB, RB * 0.9, 0, 0, Math.PI * 2);
  c.fill();
  const g = c.createRadialGradient(b.x - 2.5, b.y - 3, 1, b.x, b.y, RB);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(1, "#cfcabb");
  c.fillStyle = g;
  c.beginPath();
  c.arc(b.x, b.y, RB, 0, Math.PI * 2);
  c.fill();
  c.save();
  c.beginPath();
  c.arc(b.x, b.y, RB, 0, Math.PI * 2);
  c.clip();
  c.fillStyle = COL.ballDk;
  for (let i = 0; i < 3; i++) {
    const a = b.spin + i * 2.1;
    const px = b.x + Math.cos(a) * RB * 0.55;
    const py = b.y + Math.sin(a * 0.7) * RB * 0.5;
    c.beginPath();
    c.arc(px, py, 1.8, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
}

/** Dotted line ahead plus a power arc around the player (blue for block flicks). */
export function drawAim(
  c: Ctx,
  p: { x: number; y: number; r: number },
  vx: number,
  vy: number,
  alpha: number,
  block: boolean,
): void {
  const s = Math.hypot(vx, vy);
  if (s < 1) return;
  const ux = vx / s;
  const uy = vy / s;
  const pw = clamp(s / MAXV, 0, 1);
  c.save();
  c.globalAlpha = alpha;
  c.strokeStyle = COL.chalk;
  c.lineWidth = 2.5;
  c.setLineDash([2, 9]);
  c.lineCap = "round";
  c.beginPath();
  c.moveTo(p.x + ux * (p.r + 4), p.y + uy * (p.r + 4));
  c.lineTo(p.x + ux * (p.r + 40 + pw * 260), p.y + uy * (p.r + 40 + pw * 260));
  c.stroke();
  c.setLineDash([]);
  c.strokeStyle = block ? COL.block : COL.amber;
  c.lineWidth = 4;
  const a0 = Math.atan2(uy, ux) + Math.PI;
  c.beginPath();
  c.arc(p.x, p.y, p.r + 8, a0 - pw * Math.PI, a0 + pw * Math.PI);
  c.stroke();
  c.restore();
}
