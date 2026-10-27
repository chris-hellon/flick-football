import { describe, expect, it } from "vitest";
import {
  CX,
  GOAL_AREA_D,
  H,
  KEEPER_KICK,
  KEEPER_LINE,
  KR,
  RB,
} from "../../src/client/src/engine/constants";
import { ballSpeedFor } from "../../src/client/src/ai/plan";
import { clearAround, frames, harness, playerOf, settle } from "./helpers";

describe("the keeper's ball (home attacks the top goal in the first half)", () => {
  it("gives a goal kick to the keeper, who is the only one who can kick it", () => {
    const { m, statuses } = harness();
    m.doRestart(1, CX, 75, "gk");
    const k = m.world.keepers[1];
    const { ball } = m.world;
    expect(m.keeperBall).toBe(1);
    expect(ball.y).toBe(GOAL_AREA_D - RB - 2); // the front edge of the goal area
    expect(statuses.at(-1)).toMatch(
      /keeper has the ball\. Drag near the ball to move your keeper, or drag back from your keeper/,
    );
    expect(m.pickPlayer(k.x, k.y)).toBe(k);
    const outfield = playerOf(m, 1, 5);
    expect(m.pickPlayer(outfield.x, outfield.y)).toBeNull();
    expect(m.humanFlick(outfield, 0, 600)).toBe(false);

    expect(m.humanFlick(k, 0, 600)).toBe(true);
    expect(ball.vy).toBeCloseTo(600 * KEEPER_KICK);
    expect(k.y).toBe(KEEPER_LINE);
    expect(m.keeperBall).toBeNull();
    settle(m);
    expect(m.turn).toBe(1); // the kick counts as a touch: away keep the ball
  });

  it("lets a human side move its keeper behind the ball before the kick", () => {
    const { m } = harness();
    m.doRestart(1, CX, 75, "gk");
    const k = m.world.keepers[1];
    const { ball } = m.world;
    expect(m.placing).toBe(k);
    expect(m.canPlace()).toBe(true);

    // Back and to one side of the ball: allowed, and it stays there while aiming.
    expect(m.placeTaker(ball.x - 50, ball.y - 20)).toBe(true);
    expect(k.x).toBeCloseTo(ball.x - 50);
    expect(k.y).toBeCloseTo(ball.y - 20);
    frames(m, 1);
    expect(k.x).toBeCloseTo(ball.x - 50);
    expect(k.y).toBeCloseTo(ball.y - 20);

    // Never upfield of the ball, behind the end line or onto the ball.
    m.placeTaker(ball.x, ball.y + 60);
    expect(k.y).toBeLessThanOrEqual(ball.y);
    m.placeTaker(ball.x, -40);
    expect(k.y).toBeGreaterThanOrEqual(0);
    m.placeTaker(ball.x + 1, ball.y);
    expect(Math.hypot(k.x - ball.x, k.y - ball.y)).toBeGreaterThanOrEqual(
      KR + RB + 2 - 1e-6,
    );

    // After the kick the keeper walks back onto its line.
    m.placeTaker(ball.x - 40, ball.y - 30);
    expect(m.humanFlick(k, 0, 600)).toBe(true);
    expect(m.placing).toBeNull();
    settle(m);
    frames(m, 1);
    expect(k.y).toBe(KEEPER_LINE);
  });

  it("doesn't offer the move to the computer's keeper", () => {
    const { m } = harness({ mode: "cpu" });
    m.doRestart(1, CX, 75, "gk");
    expect(m.keeperBall).toBe(1);
    expect(m.placing).toBeNull();
    expect(m.canPlace()).toBe(false);
  });

  it("won't let a keeper be flicked in open play", () => {
    const { m } = harness();
    const k = m.world.keepers[0];
    expect(m.humanFlick(k, 0, -600)).toBe(false);
    expect(m.pickPlayer(k.x, k.y)).toBeNull();
  });

  it("lets the keeper gather a ball that comes to rest in the goal area", () => {
    const { m, statuses } = harness();
    const { ball } = m.world;
    const p = playerOf(m, 0, 8);
    clearAround(m, [p], CX, 200);
    p.x = CX;
    p.y = 140;
    ball.x = CX;
    ball.y = 110;
    // A soft push that leaves the ball inside the top goal area.
    m.doFlick(p, 0, -1, false);
    p.vx = p.vy = 0;
    ball.vy = -ballSpeedFor(110 - GOAL_AREA_D / 2);
    settle(m);
    expect(statuses.some((s) => /keeper gathers the ball/.test(s))).toBe(true);
    frames(m, 1.5);
    expect(m.keeperBall).toBe(1);
    expect(m.turn).toBe(1);
  });

  it("doesn't gather a ball that was already sitting in the goal area and didn't move", () => {
    const { m } = harness();
    const { ball } = m.world;
    const p = playerOf(m, 0, 0);
    ball.x = CX + 60; // inside the goal area, clear of the keeper
    ball.y = 45;
    clearAround(m, [p], CX + 60, 45);
    m.doFlick(p, 100, 0, false); // a flick that misses the ball
    settle(m);
    expect(m.keeperBall).toBeNull();
    expect(m.turn).toBe(1);
  });

  it("has the computer take its keeper's kicks upfield", () => {
    const { m } = harness({ mode: "cpu" });
    m.doRestart(1, CX, 75, "gk");
    const y0 = m.world.ball.y;
    frames(m, 3);
    expect(m.world.ball.y).toBeGreaterThan(y0 + 100);
  });

  it("rolls a ball about as far as planned", () => {
    for (const d of [150, 400, 800]) {
      const { m } = harness();
      const { ball } = m.world;
      m.world.players.forEach((p) => {
        p.x = -1000;
      });
      ball.x = CX;
      ball.y = H - 60;
      m.doFlick(m.world.keepers[0], 0, -ballSpeedFor(d) / KEEPER_KICK, false);
      settle(m);
      expect(Math.abs(H - 60 - ball.y - d)).toBeLessThan(d * 0.08);
    }
  });
});
