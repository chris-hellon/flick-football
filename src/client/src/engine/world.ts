import { makeBody, type Ball, type Team, type TeamBody, type Body } from "./body";
import { BALL_MASS, CX, GW, H, KEEPER_LINE, KR, PLAYER_MASS, POST_R, RB, RP } from "./constants";

export const PLAYERS_PER_SIDE = 10;

export interface World {
  /** Ids 0–9 are home, 10–19 away. */
  players: TeamBody[];
  /** keepers[0] is home's, keepers[1] away's. */
  keepers: [TeamBody, TeamBody];
  ball: Ball;
  posts: Body[];
  /** Every body, in collision order. */
  bodies: Body[];
  /** Bodies that move under friction (players and ball). */
  movers: Body[];
}

export function createWorld(): World {
  const players: TeamBody[] = [];
  for (const t of [0, 1] as Team[]) {
    for (let i = 0; i < PLAYERS_PER_SIDE; i++) {
      const p = makeBody("p", t, 0, 0, RP, PLAYER_MASS) as TeamBody;
      p.id = t * PLAYERS_PER_SIDE + i;
      players.push(p);
    }
  }
  const keepers: [TeamBody, TeamBody] = [
    makeBody("k", 0, CX, H - KEEPER_LINE, KR, Infinity) as TeamBody,
    makeBody("k", 1, CX, KEEPER_LINE, KR, Infinity) as TeamBody,
  ];
  const ball: Ball = {
    ...makeBody("ball", null, CX, H / 2, RB, BALL_MASS),
    last: null,
    touch: null,
    shotOK: false,
  };
  const posts = [
    [CX - GW / 2, 0],
    [CX + GW / 2, 0],
    [CX - GW / 2, H],
    [CX + GW / 2, H],
  ].map(([x, y]) => makeBody("post", null, x ?? 0, y ?? 0, POST_R, Infinity));
  return {
    players,
    keepers,
    ball,
    posts,
    movers: [...players, ball],
    bodies: [...players, ...keepers, ball, ...posts],
  };
}

export function playerById(world: World, id: number): TeamBody | undefined {
  return world.players.find((p) => p.id === id);
}
