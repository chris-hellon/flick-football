import type { Team, TeamBody } from "../../src/client/src/engine/body";
import { ORIGINAL_CLUBS, type Club } from "../../src/client/src/rules/clubs";
import {
  Match,
  silentFx,
  type MatchConfig,
} from "../../src/client/src/rules/match";
import { seeded } from "../../src/client/src/util/math";

const club = (i: number): Club => ({ ...(ORIGINAL_CLUBS[i] as Club) });

export function config(over: Partial<MatchConfig> = {}): MatchConfig {
  return {
    cup: false,
    mode: "pvp",
    lvl: 1,
    home: club(0),
    away: club(1),
    fmt: "g5",
    block: false,
    forms: ["4-4-2", "4-4-2"],
    ...over,
  };
}

export interface Harness {
  m: Match;
  statuses: string[];
  fullTime: number;
}

/** A match with no sound and a seeded random source, kicked off by home. */
export function harness(over: Partial<MatchConfig> = {}, seed = 1): Harness {
  const h: Harness = { m: null as unknown as Match, statuses: [], fullTime: 0 };
  const hooks = {
    status: (msg: string) => void h.statuses.push(msg),
    board: () => {},
    fullTime: () => void h.fullTime++,
  };
  const cfg = config(over);
  h.m = new Match(hooks, silentFx, [cfg.home, cfg.away], seeded(seed));
  h.m.start(cfg);
  return h;
}

/** Runs 60 fps frames until the match is waiting for a flick again (or a limit). */
export function settle(m: Match, maxSeconds = 20): void {
  for (let i = 0; i < maxSeconds * 60; i++) {
    m.frame(1 / 60);
    if (m.phase === "aim" || m.phase === "block" || m.phase === "over") return;
  }
  throw new Error(`match did not settle; phase ${m.phase}`);
}

export function frames(m: Match, seconds: number): void {
  for (let i = 0; i < seconds * 60; i++) m.frame(1 / 60);
}

/** Moves every player except those listed well away from (x, y), to keep a test's flick clean. */
export function clearAround(
  m: Match,
  keep: TeamBody[],
  x: number,
  y: number,
): void {
  let n = 0;
  for (const p of m.world.players) {
    if (keep.includes(p)) continue;
    if (Math.hypot(p.x - x, p.y - y) < 260) {
      p.x = 30 + (n % 10) * 62;
      p.y =
        y > 525 ? 40 + Math.floor(n / 10) * 40 : 1010 - Math.floor(n / 10) * 40;
      n++;
    }
  }
}

export const playerOf = (m: Match, team: Team, i = 0): TeamBody => {
  const p = m.world.players.find(
    (q) => q.team === team && q.id === team * 10 + i,
  );
  if (!p) throw new Error("no player");
  return p;
};

/** Puts player p directly behind the ball (on the side away from the target) and flicks it at the target. */
export function flickAt(
  m: Match,
  p: TeamBody,
  tx: number,
  ty: number,
  speed: number,
  gap = 40,
): void {
  const { ball } = m.world;
  const dx = tx - ball.x;
  const dy = ty - ball.y;
  const d = Math.hypot(dx, dy);
  p.x = ball.x - (dx / d) * gap;
  p.y = ball.y - (dy / d) * gap;
  m.doFlick(p, (dx / d) * speed, (dy / d) * speed, m.phase === "block");
}
