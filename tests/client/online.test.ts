import { describe, expect, it } from "vitest";
import { GuestView } from "../../src/client/src/net/guestView";
import { FxLog } from "../../src/client/src/net/fxLog";
import {
  buildState,
  changeKey,
  cleanAim,
  cleanFlick,
  cleanState,
  isCode,
  normaliseCode,
} from "../../src/client/src/net/protocol";
import { ORIGINAL_CLUBS, type Club } from "../../src/client/src/rules/clubs";
import { Match, silentFx, type Fx } from "../../src/client/src/rules/match";
import { frames, harness, playerOf, settle } from "./helpers";

function guestMatch(): Match {
  const k = ORIGINAL_CLUBS as Club[];
  return new Match(
    { status: () => {}, board: () => {}, fullTime: () => {} },
    silentFx,
    [k[2] as Club, k[3] as Club],
  );
}

describe("snapshots", () => {
  it("round-trips the host's match through the wire format", () => {
    const { m } = harness({ fmt: "t3" });
    const p = playerOf(m, 0, 4);
    m.doFlick(p, 0, -600, false);
    frames(m, 0.2);
    const s = JSON.parse(
      JSON.stringify(
        buildState(m, { id: 3, vx: 10, vy: -20, b: 0 }, [[1, "t", 0.5, 1]]),
      ),
    );
    expect(JSON.stringify(s).length).toBeLessThan(8 * 1024);

    const g = cleanState(s);
    expect(g).not.toBeNull();
    expect(g?.ph).toBe("moving");
    expect(g?.p).toHaveLength(46);
    expect(g?.k?.[0].name).toBe("Harbour Albion");
    expect(g?.am).toEqual({ id: 3, vx: 10, vy: -20, b: 0 });
    expect(g?.fmt).toBe("t3");
  });

  it("only changes key when something the guest can't derive changes", () => {
    const { m } = harness();
    const a = buildState(m, null, []);
    m.banner = { text: "GOAL!", sub: "x", t: 0, color: "#ffffff" };
    const b = buildState(m, null, []);
    m.banner.t = 0.9;
    const c = buildState(m, null, []);
    expect(changeKey(a)).not.toBe(changeKey(b));
    expect(changeKey(b)).toBe(changeKey(c));
  });

  it("cleans hostile snapshots instead of trusting them", () => {
    const g = cleanState({
      ph: "explode",
      tn: 7,
      lk: 99,
      sc: [-1, "2"],
      hf: 3,
      cl: 1e9,
      fmt: "x9",
      fo: ["9-9-9"],
      p: [1, 2, 3],
      st: "s".repeat(500),
      k: [
        {
          name: "<img src=x onerror=alert(1)>\u0000",
          shirt: "red",
          pat: "zigzag",
        },
        {},
      ],
      bn: { x: "GOAL!".repeat(10), s: 5, c: "javascript:", t: -4 },
      fl: [["SAVE", 1, 2, 0.5], ["BAD", "x"], 7],
      am: { id: 50, vx: 1, vy: 1 },
      fx: [
        [1, "t", 0.5, 1],
        [2, "boom", 0, 0],
      ],
      ft: [[1, 2], "nope"],
    });
    expect(g).not.toBeNull();
    if (!g) return;
    expect(g.ph).toBe("pause");
    expect(g.tn).toBe(0);
    expect(g.lk).toBeNull();
    expect(g.sc).toEqual([0, 0]);
    expect(g.hf).toBe(1);
    expect(g.cl).toBe(600);
    expect(g.fmt).toBe("t3");
    expect(g.fo).toEqual(["4-4-2", "4-4-2"]);
    expect(g.p).toBeNull();
    expect(g.st).toHaveLength(200);
    expect(g.k?.[0].name).toBe("<img src=x onerror=a"); // 20 chars, text only: rendered with textContent
    expect(g.k?.[0].shirt).toMatch(/^#[0-9a-f]{6}$/i);
    expect(g.k?.[0].pat).toBe("hoops");
    expect(g.bn?.text).toHaveLength(20);
    expect(g.bn?.color).toBe("#f3efe2");
    expect(g.bn?.t).toBe(0);
    expect(g.fl).toEqual([{ text: "SAVE", x: 1, y: 2, t: 0.5 }]);
    expect(g.am).toBeNull();
    expect(g.fx).toEqual([[1, "t", 0.5, 1]]);
    expect(g.ft).toEqual([
      [1, 2, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0],
    ]);
    expect(cleanState(null)).toBeNull();
    expect(cleanState([1, 2])).toBeNull();
  });

  it("checks flicks, aims and codes", () => {
    expect(cleanFlick({ n: 1, id: 12, vx: 1, vy: 2 })).toEqual({
      n: 1,
      id: 12,
      vx: 1,
      vy: 2,
      b: 0,
    });
    expect(cleanFlick({ n: 1, id: 3, vx: 1, vy: 2 })).toBeNull(); // a home player
    expect(cleanFlick({ n: 1, id: 12, vx: Infinity, vy: 2 })).toBeNull();
    expect(cleanAim({ id: 4, vx: 1, vy: 2, b: 1 })).toEqual({
      id: 4,
      vx: 1,
      vy: 2,
      b: 1,
    });
    expect(cleanAim(null)).toBeNull();
    expect(normaliseCode(" ab-c2d9x ")).toBe("ABC2D");
    expect(isCode("ABC2D")).toBe(true);
    expect(isCode("ABC1D")).toBe(false); // no 1, 0, O or I
  });
});

describe("the guest's view", () => {
  it("draws the host's snapshot: eases bodies, follows the phase, the kits and the change of ends", () => {
    const host = harness({ fmt: "t3" }).m;
    host.swapped = true;
    host.kickoff(1);
    const s = cleanState(
      JSON.parse(JSON.stringify(buildState(host, null, []))),
    );
    if (!s) throw new Error("bad state");
    const g = guestMatch();
    const boards: number[] = [];
    const view = new GuestView(g, silentFx, () => boards.push(1));

    view.apply(s);
    view.frame(1 / 60);

    expect(g.phase).toBe("aim");
    expect(g.turn).toBe(1);
    expect(g.swapped).toBe(true);
    expect(g.up(1)).toBe(true);
    expect(g.kits[0].name).toBe("Harbour Albion");
    expect(boards.length).toBeGreaterThan(0);
    expect(g.lastStatus).toBe(host.lastStatus);
    // First snapshot: far from the starting spots, so bodies jump straight there.
    host.world.players.forEach((p, i) => {
      expect(g.world.players[i]?.x).toBeCloseTo(Math.round(p.x * 10) / 10, 1);
      expect(g.world.players[i]?.y).toBeCloseTo(Math.round(p.y * 10) / 10, 1);
    });

    // A small move is eased, not snapped.
    const ball = host.world.ball;
    ball.x += 30;
    const s2 = cleanState(
      JSON.parse(JSON.stringify(buildState(host, null, []))),
    );
    if (!s2) throw new Error("bad state");
    view.apply(s2);
    view.frame(1 / 60);
    expect(g.world.ball.x).toBeGreaterThan(ball.x - 30);
    expect(g.world.ball.x).toBeLessThan(ball.x);
    for (let i = 0; i < 30; i++) view.frame(1 / 60);
    expect(g.world.ball.x).toBeCloseTo(ball.x, 0);
  });

  it("plays each of the host's sounds once, skipping ones from before it joined", () => {
    const played: string[] = [];
    const ear: Fx = {
      tock: () => void played.push("tock"),
      whistle: (n) => void played.push(`whistle ${n}`),
      cheer: () => void played.push("cheer"),
      ooh: () => void played.push("ooh"),
      crowd: () => {},
    };
    const host = harness().m;
    const log = new FxLog(silentFx);
    log.recording = true;
    log.whistle(1);
    const view = new GuestView(guestMatch(), ear, () => {});
    const send = (): void => {
      const s = cleanState(
        JSON.parse(JSON.stringify(buildState(host, null, log.entries))),
      );
      if (s) view.apply(s);
    };

    send();
    expect(played).toEqual([]); // the kick-off whistle happened before we arrived
    log.cheer();
    log.tock(0.5, 1.4);
    send();
    send();
    expect(played).toEqual(["cheer", "tock"]);
    log.whistle(3);
    send();
    expect(played).toEqual(["cheer", "tock", "whistle 3"]);
  });

  it("keeps only the last six sounds while hosting, and none otherwise", () => {
    const log = new FxLog(silentFx);
    log.cheer();
    expect(log.entries).toEqual([]);
    log.recording = true;
    for (let i = 0; i < 10; i++) log.tock(0.123456, 1);
    expect(log.entries).toHaveLength(6);
    expect(log.entries.at(-1)).toEqual([10, "t", 0.12, 1]);
  });
});

describe("when the online friend leaves", () => {
  it("the computer takes over the away side and flicks", () => {
    const { m } = harness({ mode: "online" });
    m.doFlick(playerOf(m, 0, 0), 0, 300, false); // a miss: away's turn
    settle(m);
    expect(m.turn).toBe(1);
    expect(m.phase).toBe("aim");

    m.handOverToComputer(1);

    expect(m.cfg?.mode).toBe("cpu");
    expect(m.phase).toBe("think");
    frames(m, 1.5);
    expect(m.stats[1].flicks).toBe(1);
  });
});
