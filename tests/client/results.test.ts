import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLUB,
  DEFAULT_OPP,
  type ClubData,
} from "../../src/client/src/rules/clubs";
import {
  addResult,
  cleanResults,
  cupsWon,
  form,
  headToHead,
  MAX_RESULTS,
  recordRows,
  type MatchResult,
} from "../../src/client/src/rules/results";

const club = (name: string): ClubData => ({ ...DEFAULT_OPP, name });
const res = (o: Partial<MatchResult>): MatchResult => ({
  at: 1_790_000_000_000,
  kind: "cpu",
  lvl: 1,
  round: null,
  me: DEFAULT_CLUB,
  opp: club("Chalkhill Athletic"),
  gf: 1,
  ga: 0,
  gg: false,
  cpuFinished: false,
  ...o,
});

describe("results", () => {
  it("keeps the newest first and caps the list", () => {
    let list: MatchResult[] = [];
    for (let i = 0; i < MAX_RESULTS + 5; i++)
      list = addResult(list, res({ at: i }));
    expect(list).toHaveLength(MAX_RESULTS);
    expect(list[0]?.at).toBe(MAX_RESULTS + 4);
  });

  it("drops malformed stored entries and cleans the rest", () => {
    const stored: unknown = [
      res({}),
      { ...res({}), gf: -1 },
      { ...res({}), gf: 1.5 },
      { ...res({}), kind: "league" },
      { ...res({}), at: "yesterday" },
      null,
      "x",
      {
        ...res({ kind: "online" }),
        lvl: 2,
        opp: { name: "Bad\u0007Name<b>", shirt: "red" },
      },
    ];
    const list = cleanResults(stored);
    expect(list).toHaveLength(2);
    const online = list[1];
    expect(online?.lvl).toBeNull(); // only computer matches keep a difficulty
    expect(online?.opp.name).toBe("BadName<b>"); // control characters gone; HTML is escaped on display
    expect(online?.opp.shirt).toMatch(/^#[0-9a-f]{6}$/);
    expect(cleanResults("nope")).toEqual([]);
  });

  it("builds the record by kind of match, with a total", () => {
    const list = [
      res({ lvl: 0, gf: 3, ga: 0 }),
      res({ lvl: 0, gf: 1, ga: 1 }),
      res({ lvl: 2, gf: 0, ga: 2 }),
      res({ kind: "online", lvl: null, gf: 2, ga: 1 }),
      res({ kind: "cup", lvl: null, round: "Final", gf: 1, ga: 0, gg: true }),
    ];
    const rows = recordRows(list);
    expect(rows.map((r) => r.label)).toEqual([
      "Computer · Easy",
      "Computer · Hard",
      "Online friends",
      "Cup ties",
      "All matches",
    ]);
    expect(rows[0]?.rec).toEqual({ p: 2, w: 1, d: 1, l: 0, gf: 4, ga: 1 });
    expect(rows.at(-1)?.rec).toEqual({ p: 5, w: 3, d: 1, l: 1, gf: 7, ga: 4 });
    expect(cupsWon(list)).toBe(1);
    expect(form(list, 3)).toEqual(["W", "D", "L"]);
  });

  it("has no total row when there's only one kind of match", () => {
    expect(recordRows([res({}), res({})]).map((r) => r.label)).toEqual([
      "Computer · Medium",
    ]);
    expect(recordRows([])).toEqual([]);
  });

  it("groups head to head by club name, most played first", () => {
    const list = [
      res({ opp: club("Saltmarsh Swifts"), gf: 0, ga: 1 }),
      res({ opp: club("Chalkhill Athletic"), gf: 2, ga: 0 }),
      res({ opp: club("saltmarsh swifts "), gf: 4, ga: 1 }),
    ];
    const h = headToHead(list);
    expect(h.map((x) => [x.opp.name, x.rec.p, x.rec.w, x.rec.l])).toEqual([
      ["Saltmarsh Swifts", 2, 1, 1],
      ["Chalkhill Athletic", 1, 1, 0],
    ]);
  });
});
