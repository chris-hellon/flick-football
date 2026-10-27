import type { Body, TeamBody } from "../engine/body";
import { CX, DEC_B, DEC_P, GW, H, RB, RP, W, ZONE } from "../engine/constants";
import type { World } from "../engine/world";
import { clamp, rnd, type Rng } from "../util/math";
import type { AiSkill } from "./skill";

export interface FlickPlan {
  p: TeamBody;
  vx: number;
  vy: number;
}

// All planning assumes the computer (team 1) attacks down the screen, towards y = H.

function pathBlocked(world: World, p: Body, cx: number, cy: number, ignoreBall: boolean): boolean {
  const sx = cx - p.x;
  const sy = cy - p.y;
  const L2 = sx * sx + sy * sy || 1;
  const list: Body[] = ignoreBall
    ? [...world.players, ...world.keepers]
    : [...world.players, ...world.keepers, world.ball];
  for (const q of list) {
    if (q === p) continue;
    const t = clamp(((q.x - p.x) * sx + (q.y - p.y) * sy) / L2, 0, 1);
    const ex = p.x + sx * t - q.x;
    const ey = p.y + sy * t - q.y;
    if (ex * ex + ey * ey < (p.r + q.r + 3) ** 2) return true;
  }
  return false;
}

function mirrorAll(world: World): void {
  for (const b of [...world.players, ...world.keepers, world.ball]) {
    b.x = W - b.x;
    b.y = H - b.y;
  }
}

/** Runs a planner in the computer's frame: mirrors the board when it attacks up, and turns the flick round. */
export function inAiFrame(
  world: World,
  attacksUp: boolean,
  fn: () => FlickPlan | null,
): FlickPlan | null {
  if (attacksUp) mirrorAll(world);
  let plan: FlickPlan | null;
  try {
    plan = fn();
  } finally {
    if (attacksUp) mirrorAll(world);
  }
  if (plan && attacksUp) {
    plan.vx = -plan.vx;
    plan.vy = -plan.vy;
  }
  return plan;
}

interface Target {
  x: number;
  y: number;
  v: number;
}

interface Candidate {
  cost: number;
  p: TeamBody;
  ux: number;
  uy: number;
  L: number;
  D: number;
  cos: number;
  shot: boolean;
}

export function planAttack(
  world: World,
  locked: number | null,
  A: AiSkill,
  rng: Rng,
): FlickPlan | null {
  const { ball } = world;
  const mine = world.players.filter((p) => p.team === 1 && p.id !== locked);
  const targets: Target[] = [];
  const k = world.keepers[0];
  if (ball.y > ZONE[1] - 10) {
    // The corner away from the keeper is worth most.
    const side = k.x > CX ? -1 : 1;
    targets.push({ x: CX + side * (GW / 2 - 14), y: H + 40, v: 520 });
    targets.push({ x: CX - side * (GW / 2 - 14), y: H + 40, v: 380 });
    targets.push({ x: CX, y: H + 40, v: 200 });
  }
  const fy = Math.min(ball.y + 230, H - 60);
  [-170, -80, 0, 80, 170].forEach((dx) =>
    targets.push({ x: clamp(ball.x + dx, 40, W - 40), y: fy, v: (fy - ball.y) * 0.8 }),
  );
  mine.forEach((q) => {
    if (q.y > ball.y + 50 && Math.hypot(q.x - ball.x, q.y - ball.y) < 380)
      targets.push({ x: q.x + (CX - q.x) * 0.15, y: q.y + 35, v: (q.y - ball.y) * 0.7 + 40 });
  });

  const cands: Candidate[] = [];
  for (const T of targets) {
    let dx = T.x - ball.x;
    let dy = T.y - ball.y;
    const D = Math.hypot(dx, dy);
    if (D < 10) continue;
    dx /= D;
    dy /= D;
    // Contact point: the spot behind the ball on the target line.
    const cx = ball.x - dx * (RP + RB);
    const cy = ball.y - dy * (RP + RB);
    for (const p of mine) {
      let ux = cx - p.x;
      let uy = cy - p.y;
      const L = Math.hypot(ux, uy);
      if (L < 2) continue;
      ux /= L;
      uy /= L;
      const cos = ux * dx + uy * dy;
      if (cos < 0.55) continue;
      const blocked = pathBlocked(world, p, cx, cy, true);
      cands.push({
        cost: L * 0.55 + (1 - cos) * 520 + (blocked ? 700 : 0) - T.v,
        p,
        ux,
        uy,
        L,
        D,
        cos,
        shot: T.y > H,
      });
    }
  }
  cands.sort((a, b) => a.cost - b.cost);

  const top = cands[0];
  if (top && top.cost < 600) {
    const pool = cands.filter((c) => c.cost < top.cost + 160).slice(0, A.topK);
    const best = pool[Math.floor(rng() * pool.length)] ?? top;
    const vb = Math.sqrt(2 * DEC_B * (best.D + (best.shot ? 60 : 0))) * 1.22;
    const vhit = vb / (1.39 * best.cos);
    const v0 = Math.sqrt(vhit * vhit + 2 * DEC_P * best.L) * 1.12 * (1 + rnd(rng, -A.pErr, A.pErr));
    const a = Math.atan2(best.uy, best.ux) + rnd(rng, -A.noise, A.noise);
    return { p: best.p, vx: Math.cos(a) * v0, vy: Math.sin(a) * v0 };
  }

  // Nothing good: nudge the nearest player at the ball, or move it goal-side.
  let p: TeamBody | null = null;
  let bd = 1e9;
  mine.forEach((q) => {
    const d = Math.hypot(q.x - ball.x, q.y - ball.y);
    if (d < bd) {
      bd = d;
      p = q;
    }
  });
  const near = p as TeamBody | null;
  if (!near) return null;
  let ux = ball.x - near.x;
  let uy = ball.y - near.y;
  const L = Math.hypot(ux, uy) || 1;
  ux /= L;
  uy /= L;
  if (uy > -0.25) {
    const v0 = Math.sqrt(380 * 380 + 2 * DEC_P * L);
    return { p: near, vx: ux * v0, vy: uy * v0 };
  }
  const gx = ball.x + (CX - ball.x) * 0.2;
  const gy = ball.y - 70;
  const mx = gx - near.x;
  const my = gy - near.y;
  const ml = Math.hypot(mx, my) || 1;
  const v0 = Math.sqrt(2 * DEC_P * ml) * 0.95;
  return { p: near, vx: (mx / ml) * v0, vy: (my / ml) * v0 };
}

/** Block flick: moves the nearest clear player between the ball and its own (top) goal. */
export function planBlock(world: World, A: AiSkill, rng: Rng): FlickPlan | null {
  const { ball } = world;
  if (rng() > A.blockProb || ball.y > 760) return null;
  let dx = CX - ball.x;
  let dy = 0 - ball.y;
  const D = Math.hypot(dx, dy) || 1;
  dx /= D;
  dy /= D;
  const dist = Math.min(95, D * 0.5);
  const P = { x: ball.x + dx * dist, y: ball.y + dy * dist };
  let best: { p: TeamBody; L: number; ux: number; uy: number } | null = null;
  for (const p of world.players) {
    if (p.team !== 1) continue;
    const L = Math.hypot(P.x - p.x, P.y - p.y);
    if (L < 12 || L > 420) continue;
    const sx = P.x - p.x;
    const sy = P.y - p.y;
    const L2 = sx * sx + sy * sy;
    const t = clamp(((ball.x - p.x) * sx + (ball.y - p.y) * sy) / L2, 0, 1);
    if (Math.hypot(p.x + sx * t - ball.x, p.y + sy * t - ball.y) < RP + RB + 10) continue;
    if (!best || L < best.L) best = { p, L, ux: sx / L, uy: sy / L };
  }
  if (!best) return null;
  const v0 = Math.sqrt(2 * DEC_P * best.L) * 0.93;
  return { p: best.p, vx: best.ux * v0, vy: best.uy * v0 };
}
