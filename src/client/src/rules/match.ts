import { hasTeam, type Body, type Team, type TeamBody } from "../engine/body";
import {
  CX,
  GW,
  H,
  KEEPER_LINE,
  MAX_DT,
  MAX_FLICK_TIME,
  MAXV,
  RB,
  GOAL_AREA_D,
  GOAL_AREA_HW,
  KEEPER_KICK,
  KR,
  RP,
  RUN_OFF,
  SUBSTEPS,
  W,
  ZONE,
} from "../engine/constants";
import { advance, ballIsOut, moveKeeper, settled, type KeeperSkill } from "../engine/physics";
import { createWorld, type World } from "../engine/world";
import { inAiFrame, planAttack, planBlock, planKeeperKick } from "../ai/plan";
import { aiSkill, keeperSkill } from "../ai/skill";
import { clamp, type Rng } from "../util/math";
import type { Club } from "./clubs";
import { FORMS, type FormationName } from "./formations";
import { applyFrame, Recorder } from "./replay";

export type Phase =
  "menu" | "aim" | "think" | "moving" | "block" | "blockthink" | "pause" | "replay" | "over";
export const PHASES: readonly Phase[] = [
  "menu",
  "aim",
  "think",
  "moving",
  "block",
  "blockthink",
  "pause",
  "replay",
  "over",
];
export type Mode = "cpu" | "pvp" | "online";
export type MatchFormat = "t3" | "t5" | "g3" | "g5";
export const FORMATS: readonly MatchFormat[] = ["t3", "t5", "g3", "g5"];
export type Half = 1 | 2 | "gg";

export interface MatchConfig {
  cup: boolean;
  mode: Mode;
  /** Computer level (Easy 0, Medium 1, Hard 2; Cup up to 2.5). */
  lvl: number;
  home: Club;
  away: Club;
  fmt: MatchFormat;
  block: boolean;
  forms: [FormationName, FormationName];
}

export interface Stats {
  goals: number;
  shots: number;
  onT: number;
  flicks: number;
  fouls: number;
  corners: number;
  saves: number;
}

/** Sounds the match asks for. */
export interface Fx {
  tock(vol: number, pitch: number): void;
  whistle(blasts: number): void;
  cheer(): void;
  ooh(): void;
  crowd(on: boolean): void;
}

export const silentFx: Fx = { tock() {}, whistle() {}, cheer() {}, ooh() {}, crowd() {} };

/** What the page shows outside the canvas. */
export interface MatchHooks {
  status(msg: string, team: Team): void;
  /** Score or kits changed. */
  board(): void;
  fullTime(): void;
}

interface FlickState {
  team: Team;
  p: TeamBody;
  hitBall: boolean;
  foul: boolean;
  block: boolean;
  shot: boolean;
  onT: boolean;
  ball0: { x: number; y: number };
}

export interface AiPlan {
  p: TeamBody;
  vx: number;
  vy: number;
  /** Seconds the aim line has shown. */
  t: number;
  block: boolean;
}

export interface Banner {
  text: string;
  sub: string;
  t: number;
  color: string;
}

export interface Floater {
  text: string;
  x: number;
  y: number;
  t: number;
}

interface Replay {
  frames: Float32Array[];
  i: number;
  hold: number;
  cb: () => void;
}

type RestartKind = "gk" | "c" | "t";

const LIVE: readonly Phase[] = ["aim", "think", "moving", "block", "blockthink"];
const WAITING: readonly Phase[] = ["aim", "think", "block", "blockthink"];
const AI_THINK_MS = 600;
const AI_BLOCK_MS = 450;
const AI_AIM_SHOW = 0.75;
const RESTART_MS = 1100;
const BANNER_MS = 1700;
const BREAK_MS = 2400;
const REPLAY_SPEED = 0.55;
/** Before a throw-in or corner, the taker may be moved anywhere this close to the ball. */
export const PLACE_R = 70;
/** How fast a keeper walks back onto its line after its kick (units a second). */
const KEEPER_RETURN = 160;

export const newStats = (): Stats => ({
  goals: 0,
  shots: 0,
  onT: 0,
  flicks: 0,
  fouls: 0,
  corners: 0,
  saves: 0,
});
export const halfLength = (fmt: MatchFormat): number => (fmt === "t5" ? 300 : 180);
const DARK_RIMS = ["#151515", "#1b1b1b"];
/** "Baize Rovers' keeper", "Harbour Albion's keeper". */
export const possessive = (name: string): string =>
  /s$/i.test(name.trim()) ? `${name.trim()}'` : `${name.trim()}'s`;

/** One match: turns, possession, fouls, restarts, clock, ends, replays and the computer's turns. */
export class Match {
  readonly world: World = createWorld();
  readonly recorder = new Recorder();
  cfg: MatchConfig | null = null;
  kits: [Club, Club];
  score: [number, number] = [0, 0];
  turn: Team = 0;
  phase: Phase = "menu";
  flick: FlickState | null = null;
  streak: { pid: number | null; count: number } = { pid: null, count: 0 };
  /** A player who has had three flicks in a row. */
  locked: number | null = null;
  /** The throw-in or corner taker, movable until the restart is taken. */
  placing: TeamBody | null = null;
  /** The side whose keeper has the ball (a goal kick, or gathered in the goal area). */
  keeperBall: Team | null = null;
  aiPlan: AiPlan | null = null;
  banner: Banner | null = null;
  floaters: Floater[] = [];
  /** Seconds since the page started; drives timers and pulses. */
  clock = 0;
  flickTime = 0;
  half: Half = 1;
  clockLeft = 0;
  timeUp = false;
  firstKick: Team = 0;
  stats: [Stats, Stats] = [newStats(), newStats()];
  replay: Replay | null = null;
  /** True in the second half: the teams have changed ends. */
  swapped = false;
  lastStatus = "";
  lastStatusTeam: Team = 0;
  fx: Fx;
  private timers: { at: number; fn: () => void }[] = [];
  private readonly hooks: MatchHooks;
  private readonly rng: Rng;

  constructor(hooks: MatchHooks, fx: Fx, kits: [Club, Club], rng: Rng = Math.random) {
    this.hooks = hooks;
    this.fx = fx;
    this.kits = kits;
    this.rng = rng;
  }

  // ---------- Queries ----------
  name = (t: Team): string => this.kits[t].name;
  /** Does team t attack towards the top goal? */
  up = (t: Team): boolean => (t === 0) !== this.swapped;
  isHuman = (t: Team): boolean => !this.cfg || this.cfg.mode !== "cpu" || t === 0;
  /** The side flicking now (the defenders during a block flick). */
  actor = (): Team =>
    this.phase === "block" || this.phase === "blockthink" ? ((1 - this.turn) as Team) : this.turn;
  timed = (): boolean => !!this.cfg && this.cfg.fmt.startsWith("t");
  goalTarget = (): number => (this.cfg ? +this.cfg.fmt.slice(1) : 0);
  keeperSkillFor = (t: Team): KeeperSkill =>
    keeperSkill(t, this.cfg?.mode === "cpu", this.cfg?.lvl ?? 1);

  setStatus(msg: string, t?: Team): void {
    this.lastStatus = msg;
    const tt = t ?? this.actor();
    this.lastStatusTeam = tt;
    this.hooks.status(msg, tt);
  }

  later(ms: number, fn: () => void): void {
    this.timers.push({ at: this.clock + ms / 1000, fn });
  }

  // ---------- Match flow ----------
  private reset(cfg: MatchConfig): void {
    this.cfg = cfg;
    this.kits = [cfg.home, cfg.away];
    this.timers = [];
    this.aiPlan = null;
    this.banner = null;
    this.replay = null;
    this.floaters = [];
    this.flick = null;
    this.score = [0, 0];
    this.stats = [newStats(), newStats()];
    this.recorder.clear();
    this.half = 1;
    this.clockLeft = halfLength(cfg.fmt);
    this.timeUp = false;
    this.firstKick = 0;
    this.swapped = false;
  }

  /** Lines the teams up and waits: nothing runs until Kick off. */
  preMatch(cfg: MatchConfig, msg = "Set up your club and the match, then press Kick off."): void {
    this.reset(cfg);
    this.turn = 0;
    this.formation();
    const { ball } = this.world;
    ball.x = CX;
    ball.y = H / 2;
    ball.vx = ball.vy = 0;
    this.phase = "menu";
    this.fx.crowd(false);
    this.hooks.board();
    this.setStatus(msg, 0);
  }

  start(cfg: MatchConfig): void {
    this.reset(cfg);
    this.hooks.board();
    this.fx.crowd(true);
    this.kickoff(0);
    this.fx.whistle(1);
  }

  /** Stops the match without a result (e.g. opening the Cup). */
  halt(): void {
    this.phase = "menu";
    this.placing = null;
    this.keeperBall = null;
    this.timers = [];
    this.aiPlan = null;
    this.replay = null;
    this.banner = null;
    this.fx.crowd(false);
  }

  formation(): void {
    for (const p of this.world.players) {
      const form = FORMS[this.cfg ? this.cfg.forms[p.team] : "4-4-2"];
      const [fx, fy] = form[p.id % 10] ?? [CX, H / 2];
      if (this.up(p.team)) {
        p.x = fx;
        p.y = fy;
      } else {
        p.x = W - fx;
        p.y = H - fy;
      }
      p.vx = p.vy = 0;
    }
    for (const k of this.world.keepers) {
      k.x = CX;
      k.tx = CX;
      k.vx = 0;
      k.y = this.up(k.team) ? H - KEEPER_LINE : KEEPER_LINE;
    }
  }

  kickoff(t: Team): void {
    this.formation();
    const { ball } = this.world;
    ball.x = CX;
    ball.y = H / 2;
    ball.vx = ball.vy = 0;
    ball.last = null;
    ball.touch = null;
    ball.shotOK = false;
    // The most advanced outfield player takes the kick-off.
    let kicker: TeamBody | null = null;
    for (const p of this.world.players) {
      if (p.team === t && (!kicker || (this.up(t) ? p.y < kicker.y : p.y > kicker.y))) kicker = p;
    }
    if (kicker) {
      kicker.x = CX;
      kicker.y = H / 2 + (this.up(t) ? 1 : -1) * (RP + RB + 4);
    }
    this.flick = null;
    this.setTurn(
      t,
      `${this.name(t)} kick off.${this.isHuman(t) ? " Drag back from a player and let go to flick." : ""}`,
    );
  }

  setTurn(t: Team, msg: string): void {
    this.placing = null;
    this.keeperBall = null;
    this.turn = t;
    this.streak = { pid: null, count: 0 };
    this.locked = null;
    this.phase = "aim";
    this.setStatus(msg);
    this.maybeAI();
  }

  private maybeAI(): void {
    if (this.cfg?.mode === "cpu" && this.turn === 1 && this.phase === "aim") {
      this.phase = "think";
      this.later(AI_THINK_MS, () => this.aiThink());
    }
  }

  doFlick(p: TeamBody, vx: number, vy: number, block: boolean): void {
    this.placing = null;
    this.keeperBall = null;
    const s = Math.hypot(vx, vy);
    if (s > MAXV) {
      vx *= MAXV / s;
      vy *= MAXV / s;
    }
    const { ball } = this.world;
    const ball0 = { x: ball.x, y: ball.y };
    const kick = p.kind === "k";
    if (kick) {
      // The keeper's kick: keepers stay on their rods, so the ball goes from the keeper's feet.
      ball.vx = vx * KEEPER_KICK;
      ball.vy = vy * KEEPER_KICK;
      ball.last = ball.touch = p.team;
      ball.shotOK = false;
    } else {
      p.vx = vx;
      p.vy = vy;
    }
    this.flick = {
      team: p.team,
      p,
      hitBall: false,
      foul: false,
      block,
      shot: false,
      onT: false,
      ball0,
    };
    if (kick) this.flick.hitBall = true;
    if (!block) this.stats[p.team].flicks++;
    this.phase = "moving";
    this.flickTime = 0;
    this.recorder.begin();
    this.recorder.record(this.world);
    this.fx.tock(0.5 + Math.min(s / MAXV, 1) * 0.5, 1);
  }

  private endFlick(): void {
    for (const b of this.world.movers) b.vx = b.vy = 0;
    const f = this.flick;
    this.flick = null;
    if (!f) {
      this.phase = "aim";
      return;
    }
    const N = this.name;
    if (f.block) {
      this.phase = "aim";
      if (f.hitBall) {
        const { ball } = this.world;
        ball.x = f.ball0.x;
        ball.y = f.ball0.y;
        ball.vx = ball.vy = 0;
        this.setStatus(
          `The block flick touched the ball, so it goes back. ${N(this.turn)} to flick.`,
        );
      } else this.setStatus(`${N(this.turn)} to flick.`);
      return this.maybeAI();
    }
    const t = f.team;
    const o = (1 - t) as Team;
    if (f.foul) {
      this.stats[t].fouls++;
      return this.setTurn(o, `Foul. ${N(t)} hit a player before the ball. ${N(o)} to flick.`);
    }
    const keeper = this.gathers(f.ball0);
    if (keeper) return this.keeperGathers(keeper.team);
    if (f.hitBall) {
      if (this.streak.pid === f.p.id) this.streak.count++;
      else this.streak = { pid: f.p.id, count: 1 };
      this.locked = this.streak.count >= 3 ? f.p.id : null;
      const keep =
        this.locked !== null
          ? `${N(t)} keep the ball. That player has had three flicks.`
          : `${N(t)} keep the ball.`;
      if (this.cfg?.block) return this.startBlock(keep);
      this.phase = "aim";
      this.setStatus(keep + (this.locked !== null ? " Pick a team-mate." : " Flick again."));
      return this.maybeAI();
    }
    this.setTurn(o, `${N(t)} missed the ball. ${N(o)} to flick.`);
  }

  private startBlock(prefix: string): void {
    this.phase = "block";
    const b = (1 - this.turn) as Team;
    this.setStatus(
      `${prefix} ${this.name(b)} block flick${this.isHuman(b) ? ": move one player without touching the ball, or skip." : "."}`,
    );
    if (!this.isHuman(b)) {
      this.phase = "blockthink";
      this.later(AI_BLOCK_MS, () => this.aiBlock());
    }
  }

  skipBlock(msg?: string): void {
    if (this.phase !== "block" && this.phase !== "blockthink") return;
    this.phase = "aim";
    this.setStatus(msg ?? `${this.name(this.turn)} to flick.`);
    this.maybeAI();
  }

  private ballOut(): void {
    const f = this.flick;
    const { ball } = this.world;
    const N = this.name;
    if (f?.block) {
      // A block flick can't move the ball out: put it back.
      ball.x = f.ball0.x;
      ball.y = f.ball0.y;
      ball.vx = ball.vy = 0;
      f.hitBall = true;
      return;
    }
    this.phase = "pause";
    this.flick = null;
    for (const b of this.world.movers) b.vx = b.vy = 0;
    let restart: [Team, number, number, RestartKind];
    if (ball.y < -RB || ball.y > H + RB) {
      const top = ball.y < 0;
      const topDef: Team = this.up(0) ? 1 : 0;
      const def = (top ? topDef : 1 - topDef) as Team;
      const att = (1 - def) as Team;
      const mouth = Math.abs(ball.x - CX) < GW / 2;
      if (mouth) {
        const own = ball.last === def;
        const valid = (ball.last === att && ball.shotOK) || own;
        if (valid) {
          if (!own) {
            if (!f?.shot) this.stats[att].shots++;
            if (!f?.onT) this.stats[att].onT++;
          }
          return this.scored(att, own);
        }
        this.setStatus(
          `No goal. The shot came from outside the shooting area. Goal kick to ${N(def)}.`,
          def,
        );
        restart = [def, CX, top ? 75 : H - 75, "gk"];
      } else {
        if (f?.shot && Math.abs(ball.x - CX) < GW * 1.1) {
          this.fx.ooh();
          this.floater("WIDE", ball.x, top ? 30 : H - 30);
        }
        if (ball.touch === def) {
          this.stats[att].corners++;
          this.setStatus(`Corner to ${N(att)}.`, att);
          restart = [att, ball.x < CX ? RB + 3 : W - RB - 3, top ? RB + 3 : H - RB - 3, "c"];
        } else {
          this.setStatus(`Goal kick to ${N(def)}.`, def);
          restart = [def, CX, top ? 75 : H - 75, "gk"];
        }
      }
    } else {
      const t = (ball.touch === null ? 1 - this.turn : 1 - ball.touch) as Team;
      this.setStatus(`Throw-in to ${N(t)}.`, t);
      restart = [t, ball.x < 0 ? RB + 3 : W - RB - 3, clamp(ball.y, 20, H - 20), "t"];
    }
    this.later(RESTART_MS, () => this.doRestart(...restart));
  }

  /** The keeper whose goal area the ball has just come to rest in (it must have moved). */
  private gathers(ball0: { x: number; y: number }): TeamBody | null {
    const { ball, keepers } = this.world;
    if (Math.hypot(ball.x - ball0.x, ball.y - ball0.y) < 1) return null;
    if (Math.abs(ball.x - CX) > GOAL_AREA_HW) return null;
    const top = ball.y <= GOAL_AREA_D;
    if (!top && ball.y < H - GOAL_AREA_D) return null;
    return keepers.find((k) => k.y < H / 2 === top) ?? null;
  }

  private keeperGathers(t: Team): void {
    const k = this.world.keepers[t];
    this.phase = "pause";
    this.setStatus(`${possessive(this.name(t))} keeper gathers the ball.`, t);
    this.floater("GATHERED", k.x, k.y + (k.y > H / 2 ? -40 : 40));
    this.later(RESTART_MS, () => this.doRestart(t, CX, k.y, "gk"));
  }

  /**
   * The keeper's kick: the ball on the front edge of side t's goal area, the keeper on its line
   * behind it, and only the keeper may kick it. A human side may first move its keeper.
   */
  private keeperRestart(t: Team): void {
    const { ball, players } = this.world;
    const k = this.world.keepers[t];
    k.x = k.tx = CX;
    k.vx = k.vy = 0;
    k.y = this.keeperLine(t);
    const out = k.y > H / 2 ? -1 : 1;
    ball.x = CX;
    ball.y = (out > 0 ? 0 : H) + out * (GOAL_AREA_D - RB - 2);
    ball.vx = ball.vy = 0;
    ball.last = ball.touch = null;
    ball.shotOK = false;
    // Clear anyone standing on the ball's spot.
    for (const q of players) {
      const dx = q.x - ball.x;
      const dy = q.y - ball.y;
      const d = Math.hypot(dx, dy);
      const min = q.r + ball.r + 6;
      if (d < min) {
        q.x = ball.x + (d ? dx / d : 1) * min;
        q.y = ball.y + (d ? dy / d : out) * min;
      }
    }
    this.setTurn(
      t,
      `${possessive(this.name(t))} keeper has the ball.${this.isHuman(t) ? " Drag near the ball to move your keeper, or drag back from your keeper to kick it." : ""}`,
    );
    this.keeperBall = t;
    if (this.isHuman(t)) this.placing = k;
  }

  /** The y of side t's keeper's line. */
  private keeperLine(t: Team): number {
    return this.up(t) ? H - KEEPER_LINE : KEEPER_LINE;
  }

  /** Places the ball and moves the nearest player of side t behind it. */
  doRestart(t: Team, x: number, y: number, kind: RestartKind): void {
    if (kind === "gk") return this.keeperRestart(t);
    const { ball, players } = this.world;
    ball.x = x;
    ball.y = y;
    ball.vx = ball.vy = 0;
    ball.last = null;
    ball.touch = null;
    ball.shotOK = false;
    // The taker stands behind the ball, facing the middle of the pitch.
    const l = Math.hypot(CX - x, H / 2 - y);
    const dx = (CX - x) / l;
    const dy = (H / 2 - y) / l;
    let taker: TeamBody | null = null;
    let best = 1e9;
    for (const p of players) {
      if (p.team !== t) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < best) {
        best = d;
        taker = p;
      }
    }
    if (taker) {
      const tk = taker;
      tk.x = x - dx * (RP + RB + 4);
      tk.y = y - dy * (RP + RB + 4);
      for (let it = 0; it < 3; it++) {
        for (const q of players) {
          if (q === tk) continue;
          for (const o of [ball, tk] as Body[]) {
            const ddx = q.x - o.x;
            const ddy = q.y - o.y;
            const d = Math.hypot(ddx, ddy) || 1;
            const min = q.r + o.r + 3;
            if (d < min) {
              q.x += (ddx / d) * (min - d);
              q.y += (ddy / d) * (min - d);
            }
          }
        }
      }
    }
    const movable = this.isHuman(t) && !!taker;
    this.setTurn(
      t,
      `${this.name(t)} to take it.${movable ? " Drag near the ball to move your taker, or flick." : ""}`,
    );
    if (movable) this.placing = taker;
  }

  /** Whether the side flicking now may still move its restart taker. */
  canPlace(): boolean {
    const tk = this.placing;
    return (
      !!tk && this.phase === "aim" && tk.team === this.turn && this.isHuman(this.turn) && !!this.cfg
    );
  }

  /**
   * Moves the restart taker towards (x, y): within PLACE_R of the ball but not on it, no further
   * off the pitch than a player may run, and never onto another figure. A keeper taking its kick
   * stays on the pitch and on its own goal's side of the ball. Returns whether it moved.
   */
  placeTaker(x: number, y: number): boolean {
    const tk = this.placing;
    if (!tk || !this.canPlace() || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const { ball, players, keepers } = this.world;
    let dx = x - ball.x;
    let dy = y - ball.y;
    const d = Math.hypot(dx, dy);
    const near = tk.r + RB + 2;
    if (d < 1e-6) {
      dx = 0;
      dy = near;
    } else {
      const k = clamp(d, near, PLACE_R) / d;
      dx *= k;
      dy *= k;
    }
    let nx = clamp(ball.x + dx, -RUN_OFF, W + RUN_OFF);
    let ny = clamp(ball.y + dy, -RUN_OFF, H + RUN_OFF);
    if (tk.kind === "k") {
      nx = clamp(nx, tk.r, W - tk.r);
      ny = tk.y < H / 2 ? clamp(ny, 0, ball.y) : clamp(ny, ball.y, H);
    }
    if (Math.hypot(nx - ball.x, ny - ball.y) < near - 1e-6) return false;
    for (const q of [...players, ...keepers] as Body[]) {
      if (q !== tk && Math.hypot(q.x - nx, q.y - ny) < q.r + tk.r + 1) return false;
    }
    tk.x = nx;
    tk.y = ny;
    tk.vx = tk.vy = 0;
    return true;
  }

  private scored(t: Team, own: boolean): void {
    const N = this.name;
    this.score[t]++;
    this.stats[t].goals++;
    this.hooks.board();
    const k = this.kits[t];
    this.banner = {
      text: "GOAL!",
      sub: own ? `Own goal · ${N(t)}` : N(t),
      t: 0,
      color: DARK_RIMS.includes(k.rim) ? k.shirt : k.rim,
    };
    this.setStatus(own ? `Own goal! ${N(t)} score.` : `Goal for ${N(t)}!`, t);
    this.fx.cheer();
    this.later(BANNER_MS, () => {
      this.banner = null;
      this.startReplay(() => this.afterGoal(t));
    });
  }

  private afterGoal(t: Team): void {
    if (this.half === "gg" || (!this.timed() && this.score[t] >= this.goalTarget()))
      return this.fullTime();
    if (this.timeUp) {
      this.kickoff((1 - t) as Team);
      return this.handleTimeUp();
    }
    this.kickoff((1 - t) as Team);
  }

  private handleTimeUp(): void {
    const cfg = this.cfg;
    if (!cfg) return;
    this.timeUp = false;
    this.aiPlan = null;
    this.phase = "pause";
    if (this.half === 1) {
      this.fx.whistle(2);
      this.banner = {
        text: "HALF TIME",
        sub: `${this.kits[0].code} ${this.score[0]} – ${this.score[1]} ${this.kits[1].code} · change ends`,
        t: 0,
        color: "#f3efe2",
      };
      this.setStatus("Half time.");
      this.later(BREAK_MS, () => {
        this.banner = null;
        this.half = 2;
        this.clockLeft = halfLength(cfg.fmt);
        this.swapped = true;
        this.fx.whistle(1);
        this.kickoff((1 - this.firstKick) as Team);
        this.setStatus(
          `Second half: the teams have changed ends. ${this.name(this.turn)} kick off.`,
        );
      });
    } else if (this.score[0] === this.score[1] && cfg.cup) {
      this.fx.whistle(2);
      this.banner = { text: "GOLDEN GOAL", sub: "Next goal wins the tie", t: 0, color: "#f3efe2" };
      this.setStatus("Level at full time. Golden goal: the next goal wins.");
      this.later(BREAK_MS, () => {
        this.banner = null;
        this.half = "gg";
        this.fx.whistle(1);
        this.kickoff(this.rng() < 0.5 ? 0 : 1);
      });
    } else {
      this.later(300, () => this.fullTime());
    }
  }

  private fullTime(): void {
    this.phase = "over";
    this.fx.whistle(3);
    this.fx.crowd(false);
    this.hooks.fullTime();
  }

  /** The winner, or null for a draw. */
  winner(): Team | null {
    return this.score[0] > this.score[1] ? 0 : this.score[1] > this.score[0] ? 1 : null;
  }

  // ---------- Replay ----------
  private startReplay(cb: () => void): void {
    const frames = this.recorder.take();
    if (frames.length < 12) return cb();
    this.phase = "replay";
    this.replay = { frames, i: 0, hold: 0, cb };
  }

  endReplay(): void {
    if (!this.replay) return;
    const { cb } = this.replay;
    this.replay = null;
    cb();
  }

  // ---------- Physics ----------
  private readonly onContact = (a: Body, b: Body, speed: number): void => {
    if (speed > 60)
      this.fx.tock(Math.min(speed / 900, 1), a.kind === "ball" || b.kind === "ball" ? 1.4 : 0.8);
    this.contact(a, b, speed);
  };

  /** Applies the rules to one collision. Public so tests can stage touches. */
  contact(a: Body, b: Body, speed: number): void {
    const { ball } = this.world;
    const flick = this.flick;
    if (a.kind === "ball" || b.kind === "ball") {
      const o = a.kind === "ball" ? b : a;
      if (flick?.block) {
        if (o.kind === "p") flick.hitBall = true;
        return;
      }
      if (o.kind === "p" && hasTeam(o)) {
        ball.last = o.team;
        ball.touch = o.team;
        ball.shotOK =
          ball.y < ZONE[0] ? this.up(o.team) : ball.y > ZONE[1] ? !this.up(o.team) : false;
        if (flick && o === flick.p) flick.hitBall = true;
        if (flick && ball.shotOK && o.team === flick.team && !flick.shot) {
          const toward = this.up(o.team) ? ball.vy < -120 : ball.vy > 120;
          if (toward) {
            flick.shot = true;
            this.stats[o.team].shots++;
          }
        }
      } else if (o.kind === "k" && hasTeam(o)) {
        // Keeper touches decide corners and throw-ins, not whether a goal counts.
        ball.touch = o.team;
        if (flick?.shot && !flick.onT && o.team !== flick.team) {
          flick.onT = true;
          this.stats[flick.team].onT++;
          this.stats[o.team].saves++;
          this.fx.ooh();
          this.floater("SAVE", o.x, o.y + (o.y > H / 2 ? -34 : 34));
        }
      } else if (o.kind === "post" && speed > 150) {
        this.fx.ooh();
        this.floater("POST", o.x, o.y + (o.y < H / 2 ? 34 : -34));
      }
      return;
    }
    if (!flick || flick.block || flick.hitBall || flick.foul) return;
    const o = a === flick.p ? b : b === flick.p ? a : null;
    if (o && o.kind === "p" && o.team !== flick.team) flick.foul = true;
  }

  private floater(text: string, x: number, y: number): void {
    this.floaters.push({ text, x, y, t: 0 });
  }

  step(dt: number): void {
    const { phase, world } = this;
    if (phase === "replay" || phase === "menu" || phase === "over") return;
    for (const k of world.keepers) {
      // A keeper waiting to take its kick stays where it was put.
      if (this.keeperBall === k.team && phase === "aim") continue;
      // After its kick, a keeper walks back onto its line.
      const line = this.keeperLine(k.team);
      if (k.y !== line) k.y += clamp(line - k.y, -KEEPER_RETURN * dt, KEEPER_RETURN * dt);
      moveKeeper(k, world.ball, this.keeperSkillFor(k.team), dt, this.rng);
    }
    if (phase !== "moving") return;
    advance(world, dt, this.onContact);
    if (ballIsOut(world.ball)) {
      this.ballOut();
      if (this.phase !== "moving") return;
    }
    this.flickTime += dt;
    if (settled(world.movers) || this.flickTime > MAX_FLICK_TIME) this.endFlick();
  }

  /** Advances everything by one animation frame. */
  frame(rawDt: number): void {
    const dt = Math.min(rawDt, MAX_DT);
    this.clock += dt;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      if (t && t.at <= this.clock) {
        this.timers.splice(i, 1);
        t.fn();
      }
    }
    if (this.timed() && this.half !== "gg" && LIVE.includes(this.phase)) {
      this.clockLeft = Math.max(0, this.clockLeft - dt);
      if (this.clockLeft === 0) this.timeUp = true;
    }
    for (let i = 0; i < SUBSTEPS; i++) this.step(dt / SUBSTEPS);
    if (this.phase === "moving") this.recorder.record(this.world);
    if (this.aiPlan && (this.phase === "think" || this.phase === "blockthink")) {
      this.aiPlan.t += dt;
      if (this.aiPlan.t > AI_AIM_SHOW) {
        const pl = this.aiPlan;
        this.aiPlan = null;
        this.doFlick(pl.p, pl.vx, pl.vy, pl.block);
      }
    }
    if (this.timeUp && WAITING.includes(this.phase) && !this.aiPlan) this.handleTimeUp();
    const r = this.replay;
    if (r) {
      if (r.i < r.frames.length - 1) {
        r.i = Math.min(r.i + dt * 60 * REPLAY_SPEED, r.frames.length - 1);
        const f = r.frames[Math.floor(r.i)];
        if (f) applyFrame(this.world, f);
      } else if ((r.hold += dt) > 0.8) this.endReplay();
    }
    if (this.banner) this.banner.t += dt;
    for (const f of this.floaters) f.t += dt;
    this.floaters = this.floaters.filter((f) => f.t < 1.4);
  }

  // ---------- Computer ----------
  private aiThink(): void {
    if (this.phase !== "think" || !this.cfg) return;
    const A = aiSkill(this.cfg.lvl);
    if (this.keeperBall === 1) {
      const kick = planKeeperKick(this.world, 1, this.up(1), A, this.rng);
      this.aiPlan = { ...kick, t: 0, block: false };
      return;
    }
    const plan = inAiFrame(this.world, this.up(1), () =>
      planAttack(this.world, this.locked, A, this.rng),
    );
    if (plan) this.aiPlan = { ...plan, t: 0, block: false };
  }

  private aiBlock(): void {
    if (this.phase !== "blockthink" || !this.cfg) return;
    const A = aiSkill(this.cfg.lvl);
    const plan = inAiFrame(this.world, this.up(1), () => planBlock(this.world, A, this.rng));
    if (!plan)
      return this.skipBlock(
        `${this.name(1)} skip the block flick. ${this.name(this.turn)} to flick.`,
      );
    this.aiPlan = { ...plan, t: 0, block: true };
  }

  /** The away side's player has gone (online): the computer takes over that side from here. */
  handOverToComputer(lvl: number): void {
    if (!this.cfg) return;
    this.cfg = { ...this.cfg, mode: "cpu", lvl };
    if (this.phase === "aim" && this.turn === 1) this.maybeAI();
    else if (this.phase === "block" && this.actor() === 1) {
      this.phase = "blockthink";
      this.later(AI_BLOCK_MS, () => this.aiBlock());
    }
  }

  // ---------- Human input ----------
  canAim(): boolean {
    return (
      !!this.cfg && (this.phase === "aim" || this.phase === "block") && this.isHuman(this.actor())
    );
  }

  /** The flickable player nearest a world point, if one is close enough. */
  pickPlayer(x: number, y: number): TeamBody | null {
    const a = this.actor();
    if (this.keeperBall === a && this.phase === "aim") {
      const k = this.world.keepers[a];
      return Math.hypot(k.x - x, k.y - y) < KR * 2.4 ? k : null;
    }
    let best: TeamBody | null = null;
    let bd = RP * 2.4;
    for (const p of this.world.players) {
      if (p.team !== a || (a === this.turn && p.id === this.locked)) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  /** Explains a tap on the locked player. Returns true if it was one. */
  tappedLocked(x: number, y: number): boolean {
    const lk = this.world.players.find(
      (q) =>
        q.id === this.locked &&
        this.actor() === this.turn &&
        Math.hypot(q.x - x, q.y - y) < RP * 2.4,
    );
    if (lk) this.setStatus("That player has had three flicks in a row. Pick a team-mate.");
    return !!lk;
  }

  /** A human flick; ignored unless it's a legal flick right now. */
  humanFlick(p: TeamBody, vx: number, vy: number): boolean {
    if (!this.canAim() || p.team !== this.actor()) return false;
    // While the keeper has the ball only the keeper kicks; otherwise keepers can't be flicked.
    if ((p.kind === "k") !== (this.keeperBall === p.team && this.phase === "aim")) return false;
    if (this.phase === "aim" && p.id === this.locked) return false;
    if (!Number.isFinite(vx) || !Number.isFinite(vy) || Math.hypot(vx, vy) < 1) return false;
    this.doFlick(p, vx, vy, this.phase === "block");
    return true;
  }

  skipLabel(): string | null {
    if (this.phase === "replay") return "Skip replay";
    if (this.phase === "block" && this.isHuman(this.actor())) return "Skip block flick";
    return null;
  }

  skip(): void {
    if (this.phase === "replay") this.endReplay();
    else if (this.phase === "block")
      this.skipBlock(
        `${this.name(this.actor())} skip the block flick. ${this.name(this.turn)} to flick.`,
      );
  }
}
