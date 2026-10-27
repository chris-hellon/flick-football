import { describe, expect, it } from "vitest";
import { RB, RP, RUN_OFF } from "../../src/client/src/engine/constants";
import { PLACE_R } from "../../src/client/src/rules/match";
import { frames, harness } from "./helpers";

const dist = (
  a: { x: number; y: number },
  b: { x: number; y: number },
): number => Math.hypot(a.x - b.x, a.y - b.y);

describe("moving the restart taker", () => {
  it("lets the restarting side move its taker around the ball before taking it", () => {
    const { m, statuses } = harness();
    m.doRestart(1, RB + 3, 400, "t");
    const tk = m.placing;
    expect(tk?.team).toBe(1);
    expect(m.canPlace()).toBe(true);
    expect(statuses.at(-1)).toMatch(/move your taker/i);

    // Off the pitch behind the ball, as for a real throw-in.
    expect(m.placeTaker(-20, 380)).toBe(true);
    expect(tk?.x).toBeCloseTo(-20);
    expect(tk?.y).toBeCloseTo(380);
  });

  it("keeps the taker within reach of the ball, not on it, and never past the run-off", () => {
    const { m } = harness();
    const { ball } = m.world;
    m.doRestart(0, RB + 3, 500, "t");
    const tk = m.placing;
    if (!tk) throw new Error("no taker");

    m.placeTaker(ball.x + 300, ball.y); // far away: pulled back onto the ring
    expect(dist(tk, ball)).toBeCloseTo(PLACE_R);
    m.placeTaker(ball.x + 1, ball.y); // on top of the ball: pushed out to touching distance
    expect(dist(tk, ball)).toBeGreaterThanOrEqual(RP + RB + 2 - 1e-9);
    m.placeTaker(-200, ball.y);
    expect(tk.x).toBeGreaterThanOrEqual(-RUN_OFF);
  });

  it("won't move the taker into another player", () => {
    const { m } = harness();
    m.doRestart(0, 340, 520, "t");
    const tk = m.placing;
    const other = m.world.players.find(
      (p) => p !== tk && dist(p, m.world.ball) < 200,
    );
    if (!tk || !other) throw new Error("setup");
    const before = { x: tk.x, y: tk.y };
    // Aim straight at the other player's centre, if it's within reach.
    if (dist(other, m.world.ball) <= PLACE_R) {
      expect(m.placeTaker(other.x, other.y)).toBe(false);
      expect({ x: tk.x, y: tk.y }).toEqual(before);
    }
  });

  it("ends once the restart is taken, and isn't offered to the other side", () => {
    const { m } = harness();
    m.doRestart(0, RB + 3, 400, "t");
    const tk = m.placing;
    if (!tk) throw new Error("no taker");
    m.doFlick(tk, 300, 0, false);
    expect(m.placing).toBeNull();
    expect(m.canPlace()).toBe(false);
    frames(m, 0.1);
    expect(m.placeTaker(30, 400)).toBe(false);
  });

  it("isn't offered when the computer takes it", () => {
    const { m } = harness({ mode: "cpu" });
    m.doRestart(1, RB + 3, 400, "t");
    expect(m.canPlace()).toBe(false);
    expect(m.placeTaker(-20, 400)).toBe(false);
  });

  it("is offered for corners too", () => {
    const { m } = harness();
    m.doRestart(0, RB + 3, RB + 3, "c");
    expect(m.canPlace()).toBe(true);
    expect(m.placeTaker(-10, 40)).toBe(true);
  });

  it("moves the keeper, not an outfield player, for goal kicks", () => {
    const { m } = harness();
    m.doRestart(1, 340, 75, "gk");
    expect(m.placing).toBe(m.world.keepers[1]);
  });
});
