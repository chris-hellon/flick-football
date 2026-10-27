import type { Ball, Body } from "./body";
import { CX, DEC_B, DEC_P, E, GW, H, LIN_B, LIN_P, RB, RUN_OFF, STOP_SPEED, W } from "./constants";
import type { World } from "./world";
import { clamp, rnd, type Rng } from "../util/math";

/** Called for every collision that closes, with the relative normal speed. */
export type ContactHandler = (a: Body, b: Body, speed: number) => void;

export function integrate(b: Body, dt: number): void {
  const isBall = b.kind === "ball";
  const dec = isBall ? DEC_B : DEC_P;
  const lin = isBall ? LIN_B : LIN_P;
  const s = Math.hypot(b.vx, b.vy);
  if (s > 0) {
    const ns = Math.max(0, s - dec * dt) * (1 - lin * dt);
    const f = ns / s;
    b.vx *= f;
    b.vy *= f;
  }
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  if (isBall) b.spin += (s * dt) / RB;
}

export function collide(a: Body, b: Body, onContact: ContactHandler): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const min = a.r + b.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min || d2 === 0) return;
  const d = Math.sqrt(d2);
  const nx = dx / d;
  const ny = dy / d;
  const ov = min - d;
  const sum = a.im + b.im;
  if (sum === 0) return;
  a.x -= (nx * ov * a.im) / sum;
  a.y -= (ny * ov * a.im) / sum;
  b.x += (nx * ov * b.im) / sum;
  b.y += (ny * ov * b.im) / sum;
  const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (vn >= 0) return;
  const j = (-(1 + E) * vn) / sum;
  a.vx -= j * a.im * nx;
  a.vy -= j * a.im * ny;
  b.vx += j * b.im * nx;
  b.vy += j * b.im * ny;
  onContact(a, b, -vn);
}

/** Players may slide a little beyond the lines, then bounce back softly. */
export function bounds(b: Body): void {
  if (b.kind !== "p") return;
  const lo = -RUN_OFF;
  const hiX = W + RUN_OFF;
  const hiY = H + RUN_OFF;
  if (b.x < lo) {
    b.x = lo;
    b.vx = Math.abs(b.vx) * 0.4;
  }
  if (b.x > hiX) {
    b.x = hiX;
    b.vx = -Math.abs(b.vx) * 0.4;
  }
  if (b.y < lo) {
    b.y = lo;
    b.vy = Math.abs(b.vy) * 0.4;
  }
  if (b.y > hiY) {
    b.y = hiY;
    b.vy = -Math.abs(b.vy) * 0.4;
  }
}

export interface KeeperSkill {
  /** Units per second. */
  speed: number;
  /** Seconds between reads of the ball. */
  delay: number;
  /** Maximum error in the predicted crossing point. */
  err: number;
}

/** Keepers are on rods: they move along x only, re-reading the ball a few times a second. */
export function moveKeeper(k: Body, ball: Body, sk: KeeperSkill, dt: number, rng: Rng): void {
  k.react -= dt;
  if (k.react <= 0) {
    k.react = sk.delay;
    let tx = CX + (ball.x - CX) * 0.4;
    const toward = k.y > H / 2 ? ball.vy > 40 : ball.vy < -40;
    if (toward) {
      const tt = (k.y - ball.y) / ball.vy;
      if (tt > 0) tx = ball.x + ball.vx * tt + rnd(rng, -sk.err, sk.err);
    }
    k.tx = clamp(tx, CX - GW / 2 + 12, CX + GW / 2 - 12);
  }
  k.vx = clamp((k.tx - k.x) * 6, -sk.speed, sk.speed);
  k.vy = 0;
  k.x += k.vx * dt;
}

/** Moves players and ball one sub-step and resolves every collision. */
export function advance(world: World, dt: number, onContact: ContactHandler): void {
  for (const b of world.movers) integrate(b, dt);
  const all = world.bodies;
  for (let i = 0; i < all.length; i++) {
    const a = all[i] as Body;
    for (let j = i + 1; j < all.length; j++) collide(a, all[j] as Body, onContact);
  }
  for (const b of world.movers) bounds(b);
}

export const ballIsOut = (ball: Ball): boolean =>
  ball.y < -RB || ball.y > H + RB || ball.x < -RB || ball.x > W + RB;

export const settled = (movers: readonly Body[]): boolean =>
  movers.every((b) => Math.hypot(b.vx, b.vy) < STOP_SPEED);
