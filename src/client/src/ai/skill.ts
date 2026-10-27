import type { Team } from "../engine/body";
import type { KeeperSkill } from "../engine/physics";

export interface AiSkill {
  /** Aim error, radians (±). */
  noise: number;
  /** Power error, fraction (±). */
  pErr: number;
  /** Picks randomly among the best K candidates. */
  topK: number;
  /** Chance of taking a block flick. */
  blockProb: number;
}

/** Difficulty level l: Easy 0, Medium 1, Hard 2 (Cup ties up to 2.5). */
export function aiSkill(l: number): AiSkill {
  return {
    noise: 0.15 * Math.pow(0.47, l),
    pErr: 0.2 * Math.pow(0.5, l),
    topK: l < 0.7 ? 3 : l < 1.5 ? 2 : 1,
    blockProb: Math.min(1, 0.35 + 0.3 * l),
  };
}

export const HUMAN_KEEPER: KeeperSkill = { speed: 120, delay: 0.18, err: 14 };

/** Tuned after "impossible to score": keep the computer's keeper beatable. */
export function keeperSkill(team: Team, vsComputer: boolean, l: number): KeeperSkill {
  if (vsComputer && team === 1)
    return { speed: 85 + 21 * l, delay: 0.26 - 0.04 * l, err: 26 - 6 * l };
  return HUMAN_KEEPER;
}
