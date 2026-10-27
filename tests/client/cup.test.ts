import { describe, expect, it } from "vitest";
import {
  CLUB,
  ORIGINAL_CLUBS,
  autoCode,
  makeClub,
  DEFAULT_CLUB,
} from "../../src/client/src/rules/clubs";
import {
  cleanCup,
  cupLevel,
  myTie,
  newCup,
  recordResult,
} from "../../src/client/src/rules/cup";
import { seeded } from "../../src/client/src/util/math";

const teams = [
  ...ORIGINAL_CLUBS,
  makeClub(DEFAULT_CLUB),
  makeClub(DEFAULT_CLUB),
];

describe("the Cup", () => {
  it("draws eight teams including yours into four quarter-finals", () => {
    const cup = newCup(CLUB, seeded(4));
    const ids = cup.rounds[0]?.flatMap((t) => [t.a, t.b]) ?? [];
    expect(ids).toHaveLength(8);
    expect(new Set(ids).size).toBe(8);
    expect(ids).toContain(CLUB);
    expect(myTie(cup)).toBeDefined();
  });

  it("runs to a champion when you win every round", () => {
    const rng = seeded(9);
    const cup = newCup(CLUB, rng);
    for (let r = 0; r < 3; r++) recordResult(cup, 2, 1, false, teams, rng);
    expect(cup.champ).toBe(CLUB);
    expect(cleanCup(JSON.parse(JSON.stringify(cup)), CLUB)).not.toBeNull();
  });

  it("simulates the rest of the bracket when you are knocked out", () => {
    const rng = seeded(2);
    const cup = newCup(CLUB, rng);
    recordResult(cup, 0, 1, false, teams, rng);
    expect(cup.out).toBe(true);
    expect(cup.champ).not.toBeNull();
    expect(cup.champ).not.toBe(CLUB);
    expect(cup.rounds).toHaveLength(3);
  });

  it("scales the computer's level with rating and round", () => {
    expect(cupLevel(1, 2, 0)).toBe(1);
    expect(cupLevel(2, 3, 2)).toBe(2.5);
    expect(cupLevel(0, 1, 0)).toBe(0);
  });

  it("rejects a corrupt stored cup", () => {
    expect(cleanCup({ team: CLUB, round: 5, rounds: [] }, CLUB)).toBeNull();
    expect(cleanCup("nope", CLUB)).toBeNull();
  });
});

describe("club codes", () => {
  it("auto-fills the short code from the name", () => {
    expect(autoCode("Hightown Swifts")).toBe("HSW");
    expect(autoCode("Feltham Green Rovers")).toBe("FGR");
    expect(autoCode("Baize")).toBe("BAI");
    expect(autoCode("Xi")).toBe("XIX");
    expect(autoCode("")).toBe("CLB");
  });
});
