import { describe, expect, it } from "vitest";
import type { TeamBody } from "../../src/client/src/engine/body";
import {
  FULL_PULL_PX,
  launchSpeed,
  MAXDRAG,
  MAXV,
  MINV,
} from "../../src/client/src/engine/constants";
import { pull } from "../../src/client/src/render/renderer";

describe("flick pull", () => {
  const p = { x: 100, y: 100 } as TeamBody;

  it("measures from where the press started, not the player's centre", () => {
    // Pressed 30 units off centre, then pulled back 5: a 5-unit pull, below the minimum.
    expect(
      pull({ p, sx: 130, sy: 100, x: 130, y: 105, k: 1, block: false }),
    ).toEqual({ dx: 0, dy: -5, d: 5 });
  });

  it("points the flick opposite the pull", () => {
    const { dx, dy, d } = pull({
      p,
      sx: 90,
      sy: 110,
      x: 90,
      y: 150,
      k: 1,
      block: false,
    });
    expect(d).toBe(40);
    expect(dx).toBe(0);
    expect(dy).toBeLessThan(0);
  });

  it("takes the same on-screen pull for full power on a small pitch as on a big one", () => {
    // k as the input sets it: CSS px per world unit × MAXDRAG / full-power pixels.
    const k = (pxPerUnit: number, fullPx: number) =>
      (pxPerUnit * MAXDRAG) / fullPx;
    for (const [pxPerUnit, fullPx] of [
      [0.44, FULL_PULL_PX.touch], // a phone
      [0.62, FULL_PULL_PX.mouse], // a desktop window
      [0.77, FULL_PULL_PX.mouse], // a big screen
    ] as const) {
      const worldPull = fullPx / pxPerUnit; // the world distance under fullPx on screen
      const { d } = pull({
        p,
        sx: 100,
        sy: 100,
        x: 100,
        y: 100 + worldPull,
        k: k(pxPerUnit, fullPx),
        block: false,
      });
      expect(d).toBeCloseTo(MAXDRAG);
    }
  });

  it("softens short and medium pulls but keeps a full pull at full power", () => {
    const linear = (d: number) => MINV + (d / MAXDRAG) * (MAXV - MINV);
    expect(launchSpeed(MAXDRAG)).toBe(MAXV);
    expect(launchSpeed(MAXDRAG * 2)).toBe(MAXV);
    for (const d of [12, 30, 75, 120])
      expect(launchSpeed(d)).toBeLessThan(linear(d));
    expect(launchSpeed(30)).toBeLessThan(launchSpeed(31));
  });
});
