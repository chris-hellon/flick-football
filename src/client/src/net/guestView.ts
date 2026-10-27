import { makeClub } from "../rules/clubs";
import type { Fx, Match, Phase } from "../rules/match";
import { clamp } from "../util/math";
import type { AimDto, GuestState } from "./protocol";

const LIVE: readonly Phase[] = ["aim", "think", "moving", "block", "blockthink", "pause", "replay"];
/** Positions further than this from the last drawn spot jump straight there. */
const SNAP = 120;

/**
 * The guest and spectators don't simulate: they draw the host's snapshots, easing bodies towards
 * each new position, ticking banner and call-out ages locally, and playing the host's sounds.
 */
export class GuestView {
  hostAim: AimDto | null = null;
  private targets: number[] | null = null;
  private kitKey = "";
  private lastFx = -1;
  private readonly m: Match;
  private readonly fx: Fx;
  private readonly onBoard: () => void;

  constructor(m: Match, fx: Fx, onBoard: () => void) {
    this.m = m;
    this.fx = fx;
    this.onBoard = onBoard;
  }

  /** Forget sounds and kits from an earlier match (a new join). */
  reset(): void {
    this.targets = null;
    this.kitKey = "";
    this.lastFx = -1;
    this.hostAim = null;
  }

  /** Applies one snapshot. Returns the phase before it. */
  apply(s: GuestState): Phase {
    const m = this.m;
    const prev = m.phase;
    let board = false;
    if (s.k) {
      const key = JSON.stringify(s.k);
      if (key !== this.kitKey) {
        this.kitKey = key;
        m.kits = [makeClub(s.k[0]), makeClub(s.k[1])];
        board = true;
      }
    }
    m.cfg = {
      cup: false,
      mode: "online",
      lvl: 1,
      home: m.kits[0],
      away: m.kits[1],
      fmt: s.fmt,
      block: s.bl,
      forms: s.fo,
    };
    m.phase = s.ph;
    m.turn = s.tn;
    m.swapped = s.sw;
    m.locked = s.lk;
    if (s.sc[0] !== m.score[0] || s.sc[1] !== m.score[1]) {
      m.score = [s.sc[0], s.sc[1]];
      board = true;
    }
    m.half = s.hf;
    m.clockLeft = s.cl;
    if (s.p) this.targets = s.p;
    if (s.sp !== null) m.world.ball.spin = s.sp;
    if (board) this.onBoard();
    if (s.st !== null && s.st !== m.lastStatus) m.setStatus(s.st, s.stt);

    // Keep local ages for the banner and call-outs we already show, so they don't jump back.
    const b = m.banner;
    m.banner = s.bn && b && b.text === s.bn.text && b.sub === s.bn.sub ? b : s.bn;
    const old = new Map(
      m.floaters.map((f) => [`${f.text}|${Math.round(f.x)}|${Math.round(f.y)}`, f]),
    );
    m.floaters = s.fl.map((f) => old.get(`${f.text}|${Math.round(f.x)}|${Math.round(f.y)}`) ?? f);
    this.hostAim = s.am;

    // Sounds: play the ones numbered after the last we heard (none on the first snapshot).
    const top = s.fx.reduce((mx, e) => Math.max(mx, e[0]), this.lastFx);
    if (this.lastFx >= 0) {
      for (const [n, kind, a, b2] of s.fx) {
        if (n <= this.lastFx) continue;
        if (kind === "t") this.fx.tock(clamp(a || 0.5, 0, 1), clamp(b2 || 1, 0.5, 2));
        else if (kind === "c") this.fx.cheer();
        else if (kind === "o") this.fx.ooh();
        else this.fx.whistle(clamp(Math.round(a), 1, 3));
      }
    }
    this.lastFx = top;

    if (s.ph === "over" && s.ft) {
      for (const t of [0, 1] as const) {
        const [shots, onT, saves, flicks, corners, fouls] = s.ft[t] ?? [0, 0, 0, 0, 0, 0];
        m.stats[t] = { goals: m.score[t], shots, onT, saves, flicks, corners, fouls };
      }
    }
    if (LIVE.includes(s.ph) && !LIVE.includes(prev)) this.fx.crowd(true);
    if (!LIVE.includes(s.ph) && LIVE.includes(prev)) this.fx.crowd(false);
    return prev;
  }

  /** Eases the drawn positions towards the latest snapshot. */
  frame(dt: number): void {
    const m = this.m;
    m.clock += dt;
    const t = this.targets;
    if (t) {
      const k = Math.min(1, dt * 18);
      let i = 0;
      const ease = (b: { x: number; y: number }): void => {
        const tx = (t[i++] ?? 0) / 10;
        const ty = (t[i++] ?? 0) / 10;
        if (Math.hypot(tx - b.x, ty - b.y) > SNAP) {
          b.x = tx;
          b.y = ty;
        } else {
          b.x += (tx - b.x) * k;
          b.y += (ty - b.y) * k;
        }
      };
      m.world.players.forEach(ease);
      m.world.keepers.forEach(ease);
      ease(m.world.ball);
    }
    if (m.banner) m.banner.t += dt;
    for (const f of m.floaters) f.t += dt;
    m.floaters = m.floaters.filter((f) => f.t < 1.4);
  }
}
