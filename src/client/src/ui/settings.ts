import { CLUB, OPP, cleanClub, DEFAULT_CLUB, DEFAULT_OPP, type ClubData } from "../rules/clubs";
import { isFormation, type FormChoice } from "../rules/formations";
import { FORMATS, type MatchFormat } from "../rules/match";

const PREFIX = "ff_";
/** The prototype's keys. Copied across once so testers keep their club and settings. */
const LEGACY_PREFIX = "ff2_";
const KEYS = [
  "mode",
  "diff",
  "away",
  "fmt",
  "blockOn",
  "sound",
  "form0",
  "form1",
  "club",
  "oppClub",
  "cup",
] as const;
type Key = (typeof KEYS)[number];

export const store = {
  get(k: Key): unknown {
    try {
      const v = localStorage.getItem(PREFIX + k);
      return v === null ? undefined : (JSON.parse(v) as unknown);
    } catch {
      return undefined;
    }
  },
  set(k: Key, v: unknown): void {
    try {
      localStorage.setItem(PREFIX + k, JSON.stringify(v));
    } catch {
      // Storage full or blocked (private mode): settings just won't persist.
    }
  },
};

export function migrateLegacy(): void {
  try {
    for (const k of KEYS) {
      const old = localStorage.getItem(LEGACY_PREFIX + k);
      if (old !== null && localStorage.getItem(PREFIX + k) === null)
        localStorage.setItem(PREFIX + k, old);
    }
  } catch {
    // Storage unavailable: nothing to migrate.
  }
}

export interface Settings {
  mode: "cpu" | "pvp";
  diff: 0 | 1 | 2;
  /** Opponents' index: an original club (0–7) or your designed opposition (OPP). */
  away: number;
  fmt: MatchFormat;
  block: 0 | 1;
  sound: boolean;
  form0: FormChoice;
  form1: FormChoice;
}

const formChoice = (v: unknown): FormChoice => (v === "club" || isFormation(v) ? v : "club");

export function loadSettings(): Settings {
  const away = store.get("away");
  const diff = store.get("diff");
  const fmt = store.get("fmt");
  return {
    mode: store.get("mode") === "pvp" ? "pvp" : "cpu",
    diff: diff === 0 || diff === 2 ? diff : 1,
    away:
      Number.isInteger(away) && (((away as number) >= 0 && (away as number) < CLUB) || away === OPP)
        ? (away as number)
        : 0,
    fmt: FORMATS.includes(fmt as MatchFormat) ? (fmt as MatchFormat) : "t3",
    block: store.get("blockOn") === 1 ? 1 : 0,
    sound: store.get("sound") !== false,
    form0: formChoice(store.get("form0")),
    form1: formChoice(store.get("form1")),
  };
}

export const loadClub = (): ClubData => cleanClub(store.get("club"), DEFAULT_CLUB);
export const loadOppClub = (): ClubData => cleanClub(store.get("oppClub"), DEFAULT_OPP);
