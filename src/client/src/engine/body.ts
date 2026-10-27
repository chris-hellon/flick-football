import { CX } from "./constants";

export type Team = 0 | 1;
export type BodyKind = "p" | "k" | "ball" | "post";

export interface Body {
  kind: BodyKind;
  team: Team | null;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  m: number;
  /** Inverse mass; 0 for kinematic or static bodies. */
  im: number;
  id: number;
  /** Ball rotation, for drawing only. */
  spin: number;
  /** Keeper's target x. */
  tx: number;
  /** Keeper's time until it next reads the ball. */
  react: number;
}

/** A player or keeper. */
export interface TeamBody extends Body {
  team: Team;
}

export interface Ball extends Body {
  /** Last outfield touch: decides goals and own goals. */
  last: Team | null;
  /** Last touch by anyone (keepers too): decides corners and throw-ins. */
  touch: Team | null;
  /** The last outfield touch happened inside that side's shooting area. */
  shotOK: boolean;
}

export function makeBody(
  kind: BodyKind,
  team: Team | null,
  x: number,
  y: number,
  r: number,
  m: number,
): Body {
  return {
    kind,
    team,
    x,
    y,
    vx: 0,
    vy: 0,
    r,
    m,
    im: m === Infinity ? 0 : 1 / m,
    id: 0,
    spin: 0,
    tx: CX,
    react: 0,
  };
}

export const hasTeam = (b: Body): b is TeamBody => b.team !== null;
export const speedOf = (b: Body): number => Math.hypot(b.vx, b.vy);
