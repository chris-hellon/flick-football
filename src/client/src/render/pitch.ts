// Placeholder pitch for Phase 0. The full renderer (stripes, nets, figures) is ported in Phase 1.
// Dimensions match the prototype's world units.
export const W = 680;
export const H = 1050;
export const GW = 150;
const VX0 = -50;
const VY0 = -58;
const VW = 780;
const VH = 1166;

const COL = {
  surround: "#1f5a2c",
  stripeA: "#2f7d3c",
  stripeB: "#2a7337",
  chalk: "rgba(246,243,232,.92)",
};

// Fits the canvas inside its parent box, keeping the pitch's aspect ratio, then draws it.
export function drawPitch(cv: HTMLCanvasElement): void {
  const ctx = cv.getContext("2d");
  const box = cv.parentElement;
  if (!ctx || !box) return;
  const cssScale = Math.min(box.clientWidth / VW, box.clientHeight / VH);
  cv.style.width = `${Math.floor(VW * cssScale)}px`;
  cv.style.height = `${Math.floor(VH * cssScale)}px`;
  const scale = cssScale * (window.devicePixelRatio || 1);
  cv.width = Math.round(VW * scale);
  cv.height = Math.round(VH * scale);

  ctx.setTransform(scale, 0, 0, scale, -VX0 * scale, -VY0 * scale);
  ctx.fillStyle = COL.surround;
  ctx.fillRect(VX0, VY0, VW, VH);

  const bands = 10;
  for (let i = 0; i < bands; i++) {
    ctx.fillStyle = i % 2 ? COL.stripeB : COL.stripeA;
    ctx.fillRect(0, (H / bands) * i, W, H / bands);
  }

  ctx.strokeStyle = COL.chalk;
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, W, H);
  ctx.beginPath();
  ctx.moveTo(0, H / 2);
  ctx.lineTo(W, H / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, 70, 0, Math.PI * 2);
  ctx.stroke();

  for (const top of [true, false]) {
    const y = top ? 0 : H;
    const d = top ? 1 : -1;
    ctx.strokeRect(W / 2 - 200, y, 400, d * 165);
    ctx.strokeRect(W / 2 - 90, y, 180, d * 55);
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(W / 2 - GW / 2, y);
    ctx.lineTo(W / 2 + GW / 2, y);
    ctx.stroke();
    ctx.lineWidth = 3;
  }
}
