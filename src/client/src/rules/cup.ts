import { clamp, shuffle, type Rng } from "../util/math";
import type { Club } from "./clubs";

export const ROUNDS = ["Quarter-final", "Semi-final", "Final"] as const;

export interface Tie {
  a: number | null;
  b: number | null;
  ga: number | null;
  gb: number | null;
  /** Winner's team index. */
  w: number | null;
  /** Won on golden goal. */
  gg: boolean;
}

export interface CupState {
  /** The player's team index. */
  team: number;
  round: number;
  rounds: Tie[][];
  out: boolean;
  champ: number | null;
}

const emptyTie = (a: number | null, b: number | null): Tie => ({
  a,
  b,
  ga: null,
  gb: null,
  w: null,
  gg: false,
});

/** Your club plus seven of the eight originals, shuffled into quarter-finals. */
export function newCup(team: number, rng: Rng): CupState {
  const others = shuffle(
    rng,
    [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => i !== team),
  ).slice(0, 7);
  const order = shuffle(rng, [team, ...others]);
  const r0: Tie[] = [];
  for (let i = 0; i < 8; i += 2) r0.push(emptyTie(order[i] ?? null, order[i + 1] ?? null));
  return { team, round: 0, rounds: [r0], out: false, champ: null };
}

const ratingOf = (teams: readonly Club[], i: number | null): number =>
  (i === null ? undefined : teams[i]?.rating) ?? 2;

export function simTie(t: Tie, teams: readonly Club[], rng: Rng): void {
  const p = 0.5 + (ratingOf(teams, t.a) - ratingOf(teams, t.b)) * 0.13;
  const aw = rng() < p;
  const wg = 1 + Math.floor(rng() * 3);
  const lg = Math.floor(rng() * (wg + 1));
  t.gg = wg === lg;
  const g2 = t.gg ? lg + 1 : wg;
  if (aw) {
    t.ga = g2;
    t.gb = lg;
    t.w = t.a;
  } else {
    t.gb = g2;
    t.ga = lg;
    t.w = t.b;
  }
}

/** Simulates the round's unplayed ties and draws the next round (or crowns the champion). */
export function advance(cup: CupState, teams: readonly Club[], rng: Rng): void {
  const r = cup.rounds[cup.round] ?? [];
  r.forEach((t) => {
    if (t.w === null) simTie(t, teams, rng);
  });
  if (cup.round === ROUNDS.length - 1) {
    cup.champ = r[0]?.w ?? null;
    return;
  }
  const nx: Tie[] = [];
  for (let i = 0; i < r.length; i += 2) nx.push(emptyTie(r[i]?.w ?? null, r[i + 1]?.w ?? null));
  cup.rounds.push(nx);
  cup.round++;
}

export const myTie = (cup: CupState): Tie | undefined =>
  cup.rounds[cup.round]?.find((t) => t.a === cup.team || t.b === cup.team);

export function opponentOf(cup: CupState): number | null {
  const t = myTie(cup);
  if (!t) return null;
  return t.a === cup.team ? t.b : t.a;
}

/** Records the player's result; if they are out, simulates the rest to a champion. */
export function recordResult(
  cup: CupState,
  gMe: number,
  gOpp: number,
  gg: boolean,
  teams: readonly Club[],
  rng: Rng,
): void {
  const t = myTie(cup);
  if (!t) return;
  const meA = t.a === cup.team;
  t.ga = meA ? gMe : gOpp;
  t.gb = meA ? gOpp : gMe;
  t.gg = gg;
  t.w = gMe > gOpp ? cup.team : meA ? t.b : t.a;
  if (t.w !== cup.team) cup.out = true;
  advance(cup, teams, rng);
  while (cup.out && cup.champ === null) advance(cup, teams, rng);
}

/** Computer level for a Cup tie: tougher opponents and later rounds play harder. */
export const cupLevel = (diff: number, oppRating: number, round: number): number =>
  clamp(diff + (oppRating - 2) * 0.4 + round * 0.2, 0, 2.5);

/** Validates a stored cup (localStorage is untrusted). */
export function cleanCup(v: unknown, team: number): CupState | null {
  if (!v || typeof v !== "object") return null;
  const c = v as CupState;
  const okIdx = (x: unknown): boolean =>
    x === null || (Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 9);
  const okGoal = (x: unknown): boolean => x === null || (Number.isInteger(x) && (x as number) >= 0);
  if (c.team !== team || !Number.isInteger(c.round) || c.round < 0 || c.round > 2) return null;
  if (!Array.isArray(c.rounds) || c.rounds.length !== c.round + 1) return null;
  const sizes = [4, 2, 1];
  const ok = c.rounds.every(
    (r, i) =>
      Array.isArray(r) &&
      r.length === sizes[i] &&
      r.every(
        (t) =>
          t &&
          okIdx(t.a) &&
          okIdx(t.b) &&
          okIdx(t.w) &&
          okGoal(t.ga) &&
          okGoal(t.gb) &&
          typeof t.gg === "boolean",
      ),
  );
  if (!ok || typeof c.out !== "boolean" || !okIdx(c.champ)) return null;
  return c;
}
