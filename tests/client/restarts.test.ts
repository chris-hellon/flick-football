import { describe, expect, it } from "vitest";
import {
  CX,
  GW,
  H,
  KEEPER_LINE,
  KR,
  RB,
  W,
} from "../../src/client/src/engine/constants";
import type { Match } from "../../src/client/src/rules/match";
import { frames, harness, playerOf } from "./helpers";

/** Starts a harmless flick, then sends the ball over the top goal line at x. */
function overTopLine(m: Match, x: number): void {
  m.doFlick(playerOf(m, 0, 0), 0, 1, false);
  const { ball } = m.world;
  ball.x = x;
  ball.y = -RB - 4;
  ball.vx = 0;
  ball.vy = -100;
  m.frame(1 / 60);
}

describe("goals and restarts (home attacks the top goal in the first half)", () => {
  it("disallows a goal struck from outside the shooting area and gives a goal kick", () => {
    const { m, statuses } = harness();
    m.world.ball.last = 0;
    m.world.ball.shotOK = false;
    overTopLine(m, CX);
    expect(m.score).toEqual([0, 0]);
    expect(statuses.at(-1)).toMatch(/No goal/);
    frames(m, 1.5);
    expect(m.turn).toBe(1);
    expect(m.keeperBall).toBe(1);
    expect(m.world.ball.x).toBe(CX);
    expect(m.world.ball.y).toBe(KEEPER_LINE + KR + RB + 2);
  });

  it("counts a goal struck inside the shooting area", () => {
    const { m } = harness();
    m.world.ball.last = 0;
    m.world.ball.shotOK = true;
    overTopLine(m, CX + 20);
    expect(m.score).toEqual([1, 0]);
  });

  it("counts an own goal wherever it came from", () => {
    const { m, statuses } = harness();
    m.world.ball.last = 1;
    m.world.ball.shotOK = false;
    overTopLine(m, CX - 30);
    expect(m.score).toEqual([1, 0]);
    expect(statuses.at(-1)).toMatch(/Own goal/);
  });

  it("marks a shot from inside the area as valid when a player touches the ball there", () => {
    const { m } = harness();
    const { ball } = m.world;
    ball.x = CX;
    ball.y = 300;
    const p = playerOf(m, 0, 8);
    m.doFlick(p, 0, -1, false);
    m.contact(p, ball, 500);
    expect(ball.last).toBe(0);
    expect(ball.shotOK).toBe(true);
    ball.y = 500;
    m.contact(p, ball, 500);
    expect(ball.shotOK).toBe(false);
  });

  it("gives a corner when the keeper touched it last", () => {
    const { m } = harness();
    m.world.ball.last = 0;
    m.contact(m.world.ball, m.world.keepers[1], 200);
    expect(m.world.ball.touch).toBe(1);
    overTopLine(m, CX + GW);
    expect(m.stats[0].corners).toBe(1);
    frames(m, 1.5);
    expect(m.turn).toBe(0);
    expect(m.world.ball.x).toBe(W - RB - 3);
    expect(m.world.ball.y).toBe(RB + 3);
  });

  it("gives a corner when a defender touched it last", () => {
    const { m } = harness();
    m.contact(playerOf(m, 1, 2), m.world.ball, 200);
    overTopLine(m, CX - GW);
    frames(m, 1.5);
    expect(m.turn).toBe(0);
    expect(m.world.ball.x).toBe(RB + 3);
  });

  it("gives a goal kick when an attacker touched it last", () => {
    const { m } = harness();
    m.contact(playerOf(m, 0, 8), m.world.ball, 200);
    overTopLine(m, CX + GW);
    frames(m, 1.5);
    expect(m.turn).toBe(1);
    expect(m.keeperBall).toBe(1);
  });

  it("gives a throw-in to the side that did not touch it last", () => {
    const { m } = harness();
    m.doFlick(playerOf(m, 0, 0), 0, 1, false);
    m.contact(playerOf(m, 0, 4), m.world.ball, 200);
    m.world.ball.x = -RB - 5;
    m.world.ball.y = 400;
    m.frame(1 / 60);
    frames(m, 1.5);
    expect(m.turn).toBe(1);
    expect(m.world.ball.x).toBe(RB + 3);
    expect(m.world.ball.y).toBe(400);
  });

  it("ends a first-to-N match when the target is reached", () => {
    const h = harness({ fmt: "g3" });
    const { m } = h;
    for (let g = 0; g < 3; g++) {
      m.world.ball.last = 0;
      m.world.ball.shotOK = true;
      overTopLine(m, CX);
      frames(m, 12);
    }
    expect(m.score).toEqual([3, 0]);
    expect(m.phase).toBe("over");
    expect(h.fullTime).toBe(1);
  });

  it("puts the bottom goal the right way round for the away side", () => {
    const { m } = harness();
    m.doFlick(playerOf(m, 1, 0), 0, -1, false);
    m.world.ball.last = 1;
    m.world.ball.shotOK = true;
    m.world.ball.x = CX;
    m.world.ball.y = H + RB + 4;
    m.frame(1 / 60);
    expect(m.score).toEqual([0, 1]);
  });
});
