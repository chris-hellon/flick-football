import { describe, expect, it } from "vitest";
import { CX, H, RB, RP } from "../../src/client/src/engine/constants";
import type { Match } from "../../src/client/src/rules/match";
import { frames, harness, playerOf } from "./helpers";

function playToHalfTime(m: Match): void {
  m.clockLeft = 0.05;
  frames(m, 0.2);
  expect(m.banner?.text).toBe("HALF TIME");
  frames(m, 3);
}

describe("half time and change of ends", () => {
  it("flips up() and lines the teams up at the other end", () => {
    const { m } = harness({ fmt: "t3" });
    expect(m.up(0)).toBe(true);
    expect(m.half).toBe(1);
    playToHalfTime(m);
    expect(m.half).toBe(2);
    expect(m.swapped).toBe(true);
    expect(m.up(0)).toBe(false);
    expect(m.up(1)).toBe(true);
    expect(m.clockLeft).toBeGreaterThan(176);
    // Home's outfield players now stand in the top half, away's in the bottom half.
    expect(
      m.world.players.filter((p) => p.team === 0).every((p) => p.y < H / 2),
    ).toBe(true);
    expect(
      m.world.players.filter((p) => p.team === 1).every((p) => p.y > H / 2),
    ).toBe(true);
    // Keepers swap goals.
    expect(m.world.keepers[0].y).toBeLessThan(H / 2);
    expect(m.world.keepers[1].y).toBeGreaterThan(H / 2);
  });

  it("gives the second-half kick-off to the side that didn't start, from the correct side of the ball", () => {
    const { m } = harness({ fmt: "t3" });
    playToHalfTime(m);
    expect(m.turn).toBe(1);
    const { ball } = m.world;
    expect(ball.x).toBe(CX);
    expect(ball.y).toBe(H / 2);
    // Away now attacks up, so its kicker stands below the ball.
    const kicker = m.world.players.find((p) => p.team === 1 && p.x === CX);
    expect(kicker?.y).toBe(H / 2 + RP + RB + 4);
  });

  it("points goal kicks at the right goal in each half", () => {
    const { m } = harness({ fmt: "t3" });
    m.doRestart(1, CX, 75, "gk");
    const taker1 = m.world.players.find(
      (p) => p.team === 1 && p.x === CX && p.y < 75,
    );
    expect(taker1).toBeDefined(); // away defends the top goal: taker stands behind the ball, nearer the goal line
    playToHalfTime(m);
    m.doRestart(1, CX, H - 75, "gk");
    const taker2 = m.world.players.find(
      (p) => p.team === 1 && p.x === CX && p.y > H - 75,
    );
    expect(taker2).toBeDefined();
  });

  it("scores second-half goals at the swapped ends", () => {
    const { m } = harness({ fmt: "t3" });
    playToHalfTime(m);
    m.doFlick(playerOf(m, 0, 0), 0, 1, false);
    m.world.ball.last = 0;
    m.world.ball.shotOK = true;
    m.world.ball.x = CX;
    m.world.ball.y = H + RB + 4; // home now attacks the bottom goal
    m.frame(1 / 60);
    expect(m.score).toEqual([1, 0]);
  });

  it("only validates shots from the shooting area home now attacks", () => {
    const { m } = harness({ fmt: "t3" });
    playToHalfTime(m);
    const { ball } = m.world;
    const p = playerOf(m, 0, 8);
    ball.y = 300;
    m.contact(p, ball, 300);
    expect(ball.shotOK).toBe(false);
    ball.y = 800;
    m.contact(p, ball, 300);
    expect(ball.shotOK).toBe(true);
  });

  it("goes to golden goal when a Cup tie is level at full time", () => {
    const h = harness({ fmt: "t3", cup: true });
    playToHalfTime(h.m);
    h.m.clockLeft = 0.05;
    frames(h.m, 0.2);
    expect(h.m.banner?.text).toBe("GOLDEN GOAL");
    frames(h.m, 3);
    expect(h.m.half).toBe("gg");
    expect(h.fullTime).toBe(0);
  });

  it("ends a level friendly at full time as a draw", () => {
    const h = harness({ fmt: "t3" });
    playToHalfTime(h.m);
    h.m.clockLeft = 0.05;
    frames(h.m, 1);
    expect(h.m.phase).toBe("over");
    expect(h.m.winner()).toBeNull();
  });
});
