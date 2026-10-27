import { describe, expect, it } from "vitest";
import { CX, GW } from "../../src/client/src/engine/constants";
import { keeperSkill } from "../../src/client/src/ai/skill";
import { seeded } from "../../src/client/src/util/math";
import { harness, playerOf } from "./helpers";

/** Calibrated so the prototype measured ~80% vs Easy and ~63% vs Medium. */
const SHOT_SPEED = 520;

/**
 * Corner shots from about 300 units out at the computer's keeper (top goal, first half).
 * Returns the share that score.
 */
function cornerShotRate(lvl: number, shots: number, seed: number): number {
  const rng = seeded(seed);
  let goals = 0;
  for (let i = 0; i < shots; i++) {
    const { m } = harness({ mode: "cpu", lvl, fmt: "g5" }, seed * 1000 + i);
    const { ball } = m.world;
    const side = rng() < 0.5 ? -1 : 1;
    const bx = CX + (rng() - 0.5) * 160;
    const by = 300 + (rng() - 0.5) * 40;
    for (const p of m.world.players) {
      p.x = -30;
      p.y = 1000;
    }
    ball.x = bx;
    ball.y = by;
    // Keeper settled in its usual shading position before the shot.
    const k = m.world.keepers[1];
    k.x = k.tx = CX + (bx - CX) * 0.4;
    const tx = CX + side * (GW / 2 - 14) + (rng() - 0.5) * 16;
    const ty = -20;
    const dx = tx - bx;
    const dy = ty - by;
    const d = Math.hypot(dx, dy);
    const p = playerOf(m, 0, 8);
    p.x = bx - (dx / d) * 30;
    p.y = by - (dy / d) * 30;
    m.humanFlick(p, (dx / d) * SHOT_SPEED, (dy / d) * SHOT_SPEED);
    for (let f = 0; f < 600 && m.phase === "moving"; f++) m.frame(1 / 60);
    if (m.score[0] === 1) goals++;
  }
  return goals / shots;
}

describe("keepers", () => {
  it("uses the tuned skills (computer keeper gets better with level, human keeper fixed)", () => {
    expect(keeperSkill(1, true, 1)).toEqual({
      speed: 106,
      delay: 0.22,
      err: 20,
    });
    expect(keeperSkill(0, true, 2)).toEqual({
      speed: 120,
      delay: 0.18,
      err: 14,
    });
    expect(keeperSkill(1, false, 2)).toEqual({
      speed: 120,
      delay: 0.18,
      err: 14,
    });
  });

  it("is beatable: corner shots score against Medium within the measured band", () => {
    const medium = cornerShotRate(1, 200, 11);
    expect(medium).toBeGreaterThanOrEqual(0.5);
    expect(medium).toBeLessThanOrEqual(0.75);
  });

  it("is easier at Easy than at Medium, and saves shots straight at it", () => {
    const easy = cornerShotRate(0, 200, 11);
    const medium = cornerShotRate(1, 200, 11);
    expect(easy).toBeGreaterThan(medium);
    // Straight at the keeper: saved.
    const { m } = harness({ mode: "cpu", lvl: 1 }, 3);
    for (const p of m.world.players) {
      p.x = -30;
      p.y = 1000;
    }
    m.world.ball.x = CX;
    m.world.ball.y = 300;
    const p = playerOf(m, 0, 8);
    p.x = CX;
    p.y = 330;
    m.humanFlick(p, 0, -1250);
    for (let f = 0; f < 600 && m.phase === "moving"; f++) m.frame(1 / 60);
    expect(m.score[0]).toBe(0);
  });
});
