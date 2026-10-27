import type { Team } from "../engine/body";
import { cleanClub, DEFAULT_OPP, type ClubData } from "../rules/clubs";
import { isFormation, type FormationName } from "../rules/formations";
import {
  FORMATS,
  PHASES,
  type Banner,
  type Floater,
  type Half,
  type Match,
  type MatchFormat,
  type Phase,
} from "../rules/match";
import { hexOk } from "../util/colour";
import { clamp } from "../util/math";

// Message shapes for /hubs/match. See docs/ONLINE_PROTOCOL.md. Everything received is untrusted.

export type Seat = "host" | "guest" | "spectator";
export type ClubDto = ClubData;

export interface FlickDto {
  /** Increasing sequence number. */
  n: number;
  id: number;
  vx: number;
  vy: number;
  b: 0 | 1;
}

/** A guest moving its restart taker (world units). */
export interface PlaceDto {
  id: number;
  x: number;
  y: number;
}

export interface AimDto {
  id: number;
  vx: number;
  vy: number;
  b: 0 | 1;
}

export type FxKind = "t" | "c" | "o" | "w";
/** A numbered sound: [n, kind, a, b]. */
export type FxEntry = [number, FxKind, number, number];
/** Full-time stats per side: shots, on target, saves, flicks, corners, fouls. */
export type StatsRow = [number, number, number, number, number, number];

export interface StateDto {
  ph: Phase;
  tn: Team;
  lk: number | null;
  /** The restart taker that can still be moved (throw-ins and corners). */
  pt: number | null;
  /** The side whose keeper has the ball (goal kick or gathered). */
  kb: Team | null;
  sc: [number, number];
  hf: Half;
  cl: number;
  fmt: MatchFormat;
  bl: 0 | 1;
  fo: [FormationName, FormationName];
  sw: 0 | 1;
  /** 46 ints: x·10, y·10 for players 0–19, keepers 0–1, ball. */
  p: number[];
  sp: number;
  st: string;
  stt: Team;
  k: [ClubDto, ClubDto];
  bn: { x: string; s: string; c: string; t: number } | null;
  fl: [string, number, number, number][];
  am: AimDto | null;
  fx: FxEntry[];
  ft: StatsRow[] | null;
}

export interface CreateResult {
  ok: boolean;
  error: string | null;
  code: string | null;
  seat: Seat | null;
  token: string | null;
}

export interface JoinResult extends CreateResult {
  otherClub: ClubDto | null;
  otherForm: string | null;
  otherPresent: boolean;
  lastState: unknown;
}

export const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 5;
const POSITIONS = 46;

export const normaliseCode = (s: string): string =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, CODE_LENGTH);

export const isCode = (s: string): boolean =>
  s.length === CODE_LENGTH && [...s].every((c) => CODE_CHARS.includes(c));

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const int = (v: unknown, lo: number, hi: number): v is number =>
  Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

export function cleanAim(a: unknown): AimDto | null {
  if (!obj(a) || !int(a.id, 0, 21) || !num(a.vx) || !num(a.vy)) return null;
  return { id: a.id, vx: a.vx, vy: a.vy, b: a.b === 1 ? 1 : 0 };
}

/** A guest's taker move as the host receives it: one of the guest's players, finite numbers. */
export function cleanPlace(p: unknown): PlaceDto | null {
  if (!obj(p) || !int(p.id, 10, 19) || !num(p.x) || !num(p.y)) return null;
  return { id: p.id, x: p.x, y: p.y };
}

/** A guest's flick as the host receives it: one of the guest's players or its keeper (21). */
export function cleanFlick(f: unknown): FlickDto | null {
  if (!obj(f) || !num(f.n) || !num(f.vx) || !num(f.vy)) return null;
  const id = f.id;
  if (!int(id, 10, 19) && id !== 21) return null;
  return { n: f.n, id: id as number, vx: f.vx, vy: f.vy, b: f.b === 1 ? 1 : 0 };
}

export const cleanForm = (v: unknown): FormationName => (isFormation(v) ? v : "4-4-2");

/** A snapshot after validation, ready for the guest's view. */
export interface GuestState {
  ph: Phase;
  tn: Team;
  lk: number | null;
  pt: number | null;
  kb: Team | null;
  sc: [number, number];
  hf: Half;
  cl: number;
  fmt: MatchFormat;
  bl: boolean;
  fo: [FormationName, FormationName];
  sw: boolean;
  p: number[] | null;
  sp: number | null;
  st: string | null;
  stt: Team;
  k: [ClubData, ClubData] | null;
  bn: Banner | null;
  fl: Floater[];
  am: AimDto | null;
  fx: FxEntry[];
  ft: StatsRow[] | null;
}

const FX_KINDS: readonly FxKind[] = ["t", "c", "o", "w"];

export function cleanState(raw: unknown): GuestState | null {
  if (!obj(raw)) return null;
  const s = raw;
  const fo = Array.isArray(s.fo) ? s.fo : [];
  const sc = Array.isArray(s.sc) ? s.sc : [];
  const bn = obj(s.bn) && typeof s.bn.x === "string" ? s.bn : null;
  const statsRow = (r: unknown): StatsRow => {
    const v = Array.isArray(r) ? r : [];
    return [0, 1, 2, 3, 4, 5].map((i) => (int(v[i], 0, 1e6) ? v[i] : 0)) as StatsRow;
  };
  return {
    ph: PHASES.includes(s.ph as Phase) ? (s.ph as Phase) : "pause",
    tn: s.tn === 1 ? 1 : 0,
    lk: int(s.lk, 0, 19) ? s.lk : null,
    pt: int(s.pt, 0, 19) ? s.pt : null,
    kb: s.kb === 0 || s.kb === 1 ? s.kb : null,
    sc: [int(sc[0], 0, 999) ? sc[0] : 0, int(sc[1], 0, 999) ? sc[1] : 0],
    hf: s.hf === "gg" ? "gg" : s.hf === 2 ? 2 : 1,
    cl: num(s.cl) ? clamp(s.cl, 0, 600) : 0,
    fmt: FORMATS.includes(s.fmt as MatchFormat) ? (s.fmt as MatchFormat) : "t3",
    bl: s.bl === 1,
    fo: [cleanForm(fo[0]), cleanForm(fo[1])],
    sw: s.sw === 1,
    p:
      Array.isArray(s.p) &&
      s.p.length === POSITIONS &&
      s.p.every((v) => num(v) && Math.abs(v) < 20000)
        ? (s.p as number[])
        : null,
    sp: num(s.sp) ? s.sp : null,
    st: typeof s.st === "string" ? s.st.slice(0, 200) : null,
    stt: s.stt === 1 ? 1 : 0,
    k:
      Array.isArray(s.k) && s.k.length === 2
        ? [cleanClub(s.k[0], DEFAULT_OPP), cleanClub(s.k[1], DEFAULT_OPP)]
        : null,
    bn: bn
      ? {
          text: String(bn.x).slice(0, 20),
          sub: String(bn.s ?? "").slice(0, 40),
          color: hexOk(bn.c) ? bn.c : "#f3efe2",
          t: num(bn.t) ? clamp(bn.t, 0, 10) : 1,
        }
      : null,
    fl: Array.isArray(s.fl)
      ? s.fl
          .slice(0, 6)
          .filter(
            (f): f is [string, number, number, number] =>
              Array.isArray(f) && typeof f[0] === "string" && f.slice(1, 4).every(num),
          )
          .map((f) => ({ text: f[0].slice(0, 8), x: f[1], y: f[2], t: clamp(f[3], 0, 2) }))
      : [],
    am: cleanAim(s.am),
    fx: Array.isArray(s.fx)
      ? s.fx
          .slice(0, 12)
          .filter(
            (e): e is FxEntry => Array.isArray(e) && num(e[0]) && FX_KINDS.includes(e[1] as FxKind),
          )
          .map((e) => [e[0], e[1], num(e[2]) ? e[2] : 0, num(e[3]) ? e[3] : 0])
      : [],
    ft: Array.isArray(s.ft) && s.ft.length === 2 ? [statsRow(s.ft[0]), statsRow(s.ft[1])] : null,
  };
}

const r2 = (v: number): number => Math.round(v * 100) / 100;

export const clubDto = (k: ClubData): ClubDto => ({
  name: k.name,
  code: k.code,
  shirt: k.shirt,
  alt: k.alt,
  base: k.base,
  pat: k.pat,
});

/** The host's snapshot of the match. */
export function buildState(m: Match, am: AimDto | null, fx: FxEntry[]): StateDto {
  const cfg = m.cfg;
  const p: number[] = [];
  const put = (b: { x: number; y: number }): void =>
    void p.push(Math.round(b.x * 10), Math.round(b.y * 10));
  m.world.players.forEach(put);
  m.world.keepers.forEach(put);
  put(m.world.ball);
  return {
    ph: m.phase,
    tn: m.turn,
    lk: m.locked,
    pt: m.placing?.id ?? null,
    kb: m.keeperBall,
    sc: [m.score[0], m.score[1]],
    hf: m.half,
    cl: Math.ceil(m.clockLeft),
    fmt: cfg?.fmt ?? "t3",
    bl: cfg?.block ? 1 : 0,
    fo: cfg ? [cfg.forms[0], cfg.forms[1]] : ["4-4-2", "4-4-2"],
    sw: m.swapped ? 1 : 0,
    p,
    sp: r2(m.world.ball.spin),
    st: m.lastStatus.slice(0, 200),
    stt: m.lastStatusTeam,
    k: [clubDto(m.kits[0]), clubDto(m.kits[1])],
    bn: m.banner
      ? { x: m.banner.text, s: m.banner.sub.slice(0, 40), c: m.banner.color, t: r2(m.banner.t) }
      : null,
    fl: m.floaters.map((f) => [f.text, Math.round(f.x), Math.round(f.y), r2(f.t)]),
    am,
    fx: [...fx],
    ft:
      m.phase === "over"
        ? m.stats.map((x) => [x.shots, x.onT, x.saves, x.flicks, x.corners, x.fouls] as StatsRow)
        : null,
  };
}

/** Identifies a snapshot without the ages the guest ticks itself, so the host only sends on change. */
export const changeKey = (s: StateDto): string =>
  JSON.stringify({ ...s, bn: s.bn && { ...s.bn, t: 0 }, fl: s.fl.map((f) => [f[0], f[1], f[2]]) });
