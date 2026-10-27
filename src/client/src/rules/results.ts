import { cleanClub, type ClubData } from "./clubs";

/** What sort of match it was. */
export type ResultKind = "cpu" | "pvp" | "online" | "cup";
const KINDS: readonly ResultKind[] = ["cpu", "pvp", "online", "cup"];

/** One finished match, from the player's side ("me" is always the player's own club). */
export interface MatchResult {
  /** When it finished (ms since 1970). */
  at: number;
  kind: ResultKind;
  /** Computer difficulty for matches against the computer (Easy 0, Medium 1, Hard 2). */
  lvl: 0 | 1 | 2 | null;
  /** Cup round name ("Quarter-final", "Semi-final", "Final"). */
  round: string | null;
  me: ClubData;
  opp: ClubData;
  /** Goals for and against. */
  gf: number;
  ga: number;
  /** Decided by golden goal. */
  gg: boolean;
  /** The friend dropped out of an online match and the computer finished it. */
  cpuFinished: boolean;
}

/** Results kept on the device; older ones drop off the end. */
export const MAX_RESULTS = 200;

export type Outcome = "W" | "D" | "L";
export const outcome = (r: MatchResult): Outcome => (r.gf > r.ga ? "W" : r.gf < r.ga ? "L" : "D");

const goals = (v: unknown): number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 99 ? v : -1;

const FALLBACK: ClubData = {
  name: "Unknown",
  code: "",
  shirt: "#888888",
  alt: "#ffffff",
  base: "#222222",
  pat: "solid",
};

/** One stored result, checked field by field; null if it can't be trusted. */
export function cleanResult(v: unknown): MatchResult | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const gf = goals(o.gf);
  const ga = goals(o.ga);
  const kind = KINDS.includes(o.kind as ResultKind) ? (o.kind as ResultKind) : null;
  if (gf < 0 || ga < 0 || !kind || typeof o.at !== "number" || !Number.isFinite(o.at)) return null;
  const lvl = o.lvl === 0 || o.lvl === 1 || o.lvl === 2 ? o.lvl : null;
  const round = typeof o.round === "string" ? o.round.slice(0, 20) : null;
  return {
    at: o.at,
    kind,
    lvl: kind === "cpu" ? (lvl ?? 1) : null,
    round: kind === "cup" ? round : null,
    me: cleanClub(o.me, FALLBACK),
    opp: cleanClub(o.opp, FALLBACK),
    gf,
    ga,
    gg: o.gg === true,
    cpuFinished: o.cpuFinished === true,
  };
}

/** The stored list (newest first), dropping anything malformed. */
export function cleanResults(v: unknown): MatchResult[] {
  if (!Array.isArray(v)) return [];
  const out: MatchResult[] = [];
  for (const x of v) {
    const r = cleanResult(x);
    if (r) out.push(r);
    if (out.length === MAX_RESULTS) break;
  }
  return out;
}

/** Adds a result to the front of the list, keeping at most MAX_RESULTS. */
export function addResult(list: MatchResult[], r: MatchResult): MatchResult[] {
  return [r, ...list].slice(0, MAX_RESULTS);
}

/** Played, won, drawn, lost, goals for and against. */
export interface WinRecord {
  p: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
}

const emptyRecord = (): WinRecord => ({ p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 });

function tally(rec: WinRecord, r: MatchResult): void {
  rec.p++;
  rec.gf += r.gf;
  rec.ga += r.ga;
  const o = outcome(r);
  if (o === "W") rec.w++;
  else if (o === "D") rec.d++;
  else rec.l++;
}

export interface RecordRow {
  label: string;
  rec: WinRecord;
}

const DIFF = ["Easy", "Medium", "Hard"] as const;

/** The player's record by kind of match, only rows with games in them, then the total. */
export function recordRows(list: readonly MatchResult[]): RecordRow[] {
  const rows: RecordRow[] = [
    ...DIFF.map((d) => ({ label: `Computer · ${d}`, rec: emptyRecord() })),
    { label: "Online friends", rec: emptyRecord() },
    { label: "Two players", rec: emptyRecord() },
    { label: "Cup ties", rec: emptyRecord() },
  ];
  const total = emptyRecord();
  for (const r of list) {
    const i = r.kind === "cpu" ? (r.lvl ?? 1) : r.kind === "online" ? 3 : r.kind === "pvp" ? 4 : 5;
    const row = rows[i];
    if (row) tally(row.rec, r);
    tally(total, r);
  }
  const used = rows.filter((r) => r.rec.p > 0);
  return used.length > 1 ? [...used, { label: "All matches", rec: total }] : used;
}

/** Cups won: finals won. */
export const cupsWon = (list: readonly MatchResult[]): number =>
  list.filter((r) => r.kind === "cup" && r.round === "Final" && outcome(r) === "W").length;

export interface HeadToHead {
  opp: ClubData;
  rec: WinRecord;
}

/**
 * Every club the player has faced (by name), most played first, then best goal difference.
 * The newest result's kit is shown for a club that changed colours.
 */
export function headToHead(list: readonly MatchResult[]): HeadToHead[] {
  const by = new Map<string, HeadToHead>();
  for (const r of list) {
    const key = r.opp.name.trim().toLowerCase();
    let h = by.get(key);
    if (!h) {
      h = { opp: r.opp, rec: emptyRecord() };
      by.set(key, h);
    }
    tally(h.rec, r);
  }
  return [...by.values()].sort(
    (a, b) =>
      b.rec.p - a.rec.p ||
      b.rec.gf - b.rec.ga - (a.rec.gf - a.rec.ga) ||
      a.opp.name.localeCompare(b.opp.name),
  );
}

/** The last few outcomes, newest first. */
export const form = (list: readonly MatchResult[], n = 5): Outcome[] =>
  list.slice(0, n).map(outcome);
