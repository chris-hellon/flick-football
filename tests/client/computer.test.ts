import { describe, expect, it } from "vitest";
import { H } from "../../src/client/src/engine/constants";
import type { Match } from "../../src/client/src/rules/match";
import { frames, harness, settle } from "./helpers";

/** Lets the computer take one flick from a kick-off and returns how far the ball moved down the screen. */
function computerKickoffDelta(m: Match): number {
  m.kickoff(1);
  expect(m.phase).toBe("think");
  const y0 = m.world.ball.y;
  frames(m, 1.5); // think, then show the aim
  expect(m.phase).toBe("moving");
  settle(m);
  return m.world.ball.y - y0;
}

describe("computer opponent", () => {
  it("flicks towards the goal at the bottom in the first half and the top in the second", () => {
    let down = 0;
    let up = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const { m } = harness({ mode: "cpu", lvl: 2 }, seed);
      if (computerKickoffDelta(m) > 0) down++;
      m.swapped = true;
      m.phase = "pause";
      if (computerKickoffDelta(m) < 0) up++;
    }
    expect(down).toBeGreaterThanOrEqual(11);
    expect(up).toBeGreaterThanOrEqual(11);
  });

  it("shows its aim before flicking", () => {
    const { m } = harness({ mode: "cpu" });
    m.kickoff(1);
    frames(m, 0.7);
    expect(m.aiPlan).not.toBeNull();
    expect(m.aiPlan?.p.team).toBe(1);
  });

  it("does not move the ball into its own half during the opening kick-off", () => {
    const { m } = harness({ mode: "cpu", lvl: 1 }, 7);
    expect(computerKickoffDelta(m)).toBeGreaterThan(0);
    expect(m.world.ball.y).toBeGreaterThan(H / 2);
  });
});
