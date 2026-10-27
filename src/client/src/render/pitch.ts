import { CX, GD, GW, H, W, ZONE } from "../engine/constants";
import { COL } from "./colours";

type Ctx = CanvasRenderingContext2D;

/** Draws fn at (x, y), turned upright when the view is flipped. */
export function upright(c: Ctx, flip: boolean, x: number, y: number, fn: () => void): void {
  c.save();
  c.translate(x, y);
  if (flip) c.rotate(Math.PI);
  fn();
  c.restore();
}

/** A small tile of light and dark specks for the baize texture. */
export function makeNoise(c: Ctx): CanvasPattern | null {
  const n = document.createElement("canvas");
  n.width = n.height = 96;
  const nc = n.getContext("2d");
  if (!nc) return null;
  for (let i = 0; i < 1400; i++) {
    nc.fillStyle = Math.random() < 0.5 ? "rgba(255,255,255,.045)" : "rgba(0,0,0,.07)";
    nc.fillRect(Math.random() * 96, Math.random() * 96, 1 + Math.random() * 1.5, 1);
  }
  return c.createPattern(n, "repeat");
}

function dot(c: Ctx, x: number, y: number, r: number): void {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fillStyle = COL.chalk;
  c.fill();
}

export function drawPitch(c: Ctx, flip: boolean, noise: CanvasPattern | null): void {
  c.save();
  c.shadowColor = "rgba(0,0,0,.55)";
  c.shadowBlur = 30;
  c.fillStyle = COL.surround;
  c.fillRect(-46, -54, W + 92, H + 108);
  c.restore();
  for (let i = 0; i < 14; i++) {
    c.fillStyle = i % 2 ? COL.stripeA : COL.stripeB;
    c.fillRect(0, i * 75, W, 75);
  }
  if (noise) {
    c.fillStyle = noise;
    c.fillRect(-46, -54, W + 92, H + 108);
  }
  c.strokeStyle = COL.chalk;
  c.lineWidth = 3;
  c.lineJoin = "round";
  c.strokeRect(0, 0, W, H);
  c.beginPath();
  c.moveTo(0, H / 2);
  c.lineTo(W, H / 2);
  c.stroke();
  c.beginPath();
  c.arc(CX, H / 2, 91.5, 0, Math.PI * 2);
  c.stroke();
  dot(c, CX, H / 2, 4);
  for (const top of [true, false]) {
    const y0 = top ? 0 : H;
    const sg = top ? 1 : -1;
    c.strokeRect(CX - 201.5, top ? 0 : H - 165, 403, 165);
    c.strokeRect(CX - 91.5, top ? 0 : H - 55, 183, 55);
    const sy = y0 + sg * 110;
    dot(c, CX, sy, 3.5);
    const a = Math.asin(55 / 91.5);
    c.beginPath();
    if (top) c.arc(CX, sy, 91.5, a, Math.PI - a);
    else c.arc(CX, sy, 91.5, Math.PI + a, -a);
    c.stroke();
    // Shooting-area line and label.
    c.save();
    c.setLineDash([12, 10]);
    c.lineWidth = 2;
    c.globalAlpha = 0.6;
    const zy = top ? ZONE[0] : ZONE[1];
    c.beginPath();
    c.moveTo(0, zy);
    c.lineTo(W, zy);
    c.stroke();
    c.restore();
    c.save();
    c.fillStyle = COL.chalk;
    c.globalAlpha = 0.55;
    c.font = "600 13px Archivo, sans-serif";
    c.textBaseline = top !== flip ? "bottom" : "top";
    c.textAlign = flip ? "right" : "left";
    upright(c, flip, 10, zy + (top ? -6 : 6), () => c.fillText("SHOOTING AREA", 0, 0));
    c.restore();
    // Goal and net.
    const gy = top ? -GD : H;
    c.save();
    c.fillStyle = "rgba(0,0,0,.25)";
    c.fillRect(CX - GW / 2, gy, GW, GD);
    c.strokeStyle = COL.net;
    c.lineWidth = 1;
    for (let x = CX - GW / 2; x <= CX + GW / 2; x += 8) {
      c.beginPath();
      c.moveTo(x, gy);
      c.lineTo(x, gy + GD);
      c.stroke();
    }
    for (let y = gy; y <= gy + GD; y += 8) {
      c.beginPath();
      c.moveTo(CX - GW / 2, y);
      c.lineTo(CX + GW / 2, y);
      c.stroke();
    }
    c.lineWidth = 3.5;
    c.strokeStyle = "#ffffff";
    c.beginPath();
    c.moveTo(CX - GW / 2, y0);
    c.lineTo(CX - GW / 2, top ? -GD : H + GD);
    c.lineTo(CX + GW / 2, top ? -GD : H + GD);
    c.lineTo(CX + GW / 2, y0);
    c.stroke();
    c.restore();
  }
  (
    [
      [0, 0, 0],
      [W, 0, Math.PI / 2],
      [W, H, Math.PI],
      [0, H, Math.PI * 1.5],
    ] as const
  ).forEach(([x, y, s]) => {
    c.beginPath();
    c.arc(x, y, 12, s, s + Math.PI / 2);
    c.stroke();
  });
}
