import { describe, expect, it } from "vitest";
import { CX, H } from "../../src/client/src/engine/constants";
import { clearAround, flickAt, harness, playerOf, settle } from "./helpers";

describe("possession", () => {
  it("keeps the ball when the flicked player touches it", () => {
    const { m } = harness();
    const p = playerOf(m, 0, 4);
    clearAround(m, [p], CX, H / 2);
    flickAt(m, p, CX + 60, H / 2 - 200, 500);
    settle(m);
    expect(m.turn).toBe(0);
    expect(m.phase).toBe("aim");
    expect(m.stats[0].flicks).toBe(1);
  });

  it("passes the ball over when the flick misses it", () => {
    const { m } = harness();
    const p = playerOf(m, 0, 0);
    m.doFlick(p, 0, 300, false); // a defender, flicked away from play
    settle(m);
    expect(m.turn).toBe(1);
    expect(m.phase).toBe("aim");
  });

  it("locks a player after three consecutive flicks", () => {
    const { m } = harness();
    const p = playerOf(m, 0, 4);
    for (let i = 0; i < 3; i++) {
      expect(m.locked).toBeNull();
      clearAround(m, [p], m.world.ball.x, m.world.ball.y);
      // Side to side across the halfway line, so the ball stays in play.
      flickAt(m, p, m.world.ball.x + (i % 2 ? -150 : 150), m.world.ball.y, 350);
      settle(m);
      expect(m.turn).toBe(0);
    }
    expect(m.locked).toBe(p.id);
    expect(m.pickPlayer(p.x, p.y)?.id).not.toBe(p.id);
    expect(m.humanFlick(p, 0, -400)).toBe(false);
    // A team-mate can still flick.
    const mate = playerOf(m, 0, 1);
    expect(m.humanFlick(mate, 0, -200)).toBe(true);
  });

  it("gives a foul when the flicked player hits an opponent before the ball", () => {
    const { m } = harness();
    const { ball } = m.world;
    const p = playerOf(m, 0, 4);
    const opp = playerOf(m, 1, 3);
    clearAround(m, [p, opp], ball.x, ball.y);
    p.x = ball.x;
    p.y = ball.y + 120;
    opp.x = ball.x;
    opp.y = ball.y + 60;
    m.doFlick(p, 0, -900, false);
    settle(m);
    expect(m.turn).toBe(1);
    expect(m.stats[0].fouls).toBe(1);
  });

  it("lets the defenders take a block flick when it is switched on, and puts the ball back if they touch it", () => {
    const { m } = harness({ block: true });
    const p = playerOf(m, 0, 4);
    clearAround(m, [p], CX, H / 2);
    flickAt(m, p, CX, H / 2 - 200, 330); // gently: a ball left in the goal area goes to the keeper
    settle(m);
    expect(m.phase).toBe("block");
    expect(m.actor()).toBe(1);
    const before = { x: m.world.ball.x, y: m.world.ball.y };
    const d = playerOf(m, 1, 8);
    clearAround(m, [d], before.x, before.y);
    flickAt(m, d, before.x, before.y + 100, 500);
    settle(m);
    expect(m.phase).toBe("aim");
    expect(m.turn).toBe(0);
    expect(m.world.ball.x).toBeCloseTo(before.x);
    expect(m.world.ball.y).toBeCloseTo(before.y);
  });
});
