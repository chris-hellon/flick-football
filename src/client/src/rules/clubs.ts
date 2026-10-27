import { greenish, hexOk, shade } from "../util/colour";
import type { FormationName } from "./formations";

export type Pattern = "solid" | "stripes" | "hoops" | "halves" | "sash";
export const PATTERNS: readonly Pattern[] = ["solid", "stripes", "hoops", "halves", "sash"];

export interface Club {
  name: string;
  code: string;
  shirt: string;
  alt: string;
  pat: Pattern;
  base: string;
  baseDk: string;
  rim: string;
  /** Keeper's shirt. */
  gk: string;
  head: string;
  /** 1–3, used by the Cup. */
  rating: number;
  /** Usual formation. */
  form: FormationName;
  custom?: boolean;
}

/** What the club builder edits and stores. */
export interface ClubData {
  name: string;
  code: string;
  shirt: string;
  alt: string;
  pat: Pattern;
  base: string;
}

// Original clubs only: never real clubs, crests or kits.
export const ORIGINAL_CLUBS: readonly Club[] = [
  {
    name: "Harbour Albion",
    code: "HAR",
    shirt: "#d0262d",
    alt: "#f4f1e6",
    pat: "stripes",
    base: "#c9252c",
    baseDk: "#6e1014",
    rim: "#f4f1e6",
    gk: "#2f8f46",
    head: "#3b2416",
    rating: 3,
    form: "4-4-2",
  },
  {
    name: "Northgate United",
    code: "NGU",
    shirt: "#7cb7e8",
    alt: "#f4f1e6",
    pat: "solid",
    base: "#5b9bd6",
    baseDk: "#1f4b78",
    rim: "#ffffff",
    gk: "#e8d23a",
    head: "#2a1c10",
    rating: 2,
    form: "4-3-3",
  },
  {
    name: "Ironvale",
    code: "IRV",
    shirt: "#7a1f3a",
    alt: "#8fc4ea",
    pat: "halves",
    base: "#7a1f3a",
    baseDk: "#3a0c1a",
    rim: "#8fc4ea",
    gk: "#f08a24",
    head: "#3b2416",
    rating: 2,
    form: "3-5-2",
  },
  {
    name: "Mekong Rangers",
    code: "MEK",
    shirt: "#0f7a3d",
    alt: "#f4f1e6",
    pat: "hoops",
    base: "#eeeee6",
    baseDk: "#8f998f",
    rim: "#0f7a3d",
    gk: "#1c1c1c",
    head: "#1c140c",
    rating: 2,
    form: "4-4-2",
  },
  {
    name: "Kingsport Athletic",
    code: "KAT",
    shirt: "#f4f1e6",
    alt: "#1b1b1b",
    pat: "sash",
    base: "#efeee8",
    baseDk: "#8d8b83",
    rim: "#1b1b1b",
    gk: "#c9252c",
    head: "#3b2416",
    rating: 3,
    form: "4-2-3-1",
  },
  {
    name: "Ashby Town",
    code: "ASH",
    shirt: "#f0a91c",
    alt: "#151515",
    pat: "stripes",
    base: "#e9a21a",
    baseDk: "#7a5208",
    rim: "#151515",
    gk: "#3c6fd1",
    head: "#2a1c10",
    rating: 1,
    form: "5-3-2",
  },
  {
    name: "Dunmore City",
    code: "DUN",
    shirt: "#1b2f6b",
    alt: "#e9c24a",
    pat: "solid",
    base: "#1d3478",
    baseDk: "#0a1638",
    rim: "#e9c24a",
    gk: "#7fd04c",
    head: "#1c140c",
    rating: 3,
    form: "4-3-3",
  },
  {
    name: "Redcliff Rovers",
    code: "RCR",
    shirt: "#f26a21",
    alt: "#1b1b1b",
    pat: "halves",
    base: "#ef6b22",
    baseDk: "#7a300a",
    rim: "#1b1b1b",
    gk: "#8a49c9",
    head: "#3b2416",
    rating: 1,
    form: "4-5-1",
  },
];

/** Index of the player's own club in the teams list. */
export const CLUB = 8;
/** Index of the custom opposition the player can design. */
export const OPP = 9;

export const DEFAULT_CLUB: ClubData = {
  name: "Baize Rovers",
  code: "",
  shirt: "#6b2fa3",
  alt: "#f2c230",
  pat: "stripes",
  base: "#5a2690",
};
export const DEFAULT_OPP: ClubData = {
  name: "Castlegate Harriers",
  code: "",
  shirt: "#f4f1e6",
  alt: "#1b1b1b",
  pat: "hoops",
  base: "#efeee8",
};

/** Initials for 3+ words; first letter plus two for two words; first three letters for one. */
export function autoCode(name: string): string {
  const w = name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  const [a = "", b = ""] = w;
  if (!w.length) return "CLB";
  const code =
    w.length >= 3
      ? w
          .slice(0, 3)
          .map((x) => x[0])
          .join("")
      : w.length === 2
        ? (a[0] ?? "") + b.slice(0, 2)
        : a.slice(0, 3);
  return code.padEnd(3, "X");
}

export function makeClub(c: ClubData): Club {
  const name = (c.name || "").trim() || "My Club";
  const code = ((c.code || "").trim() || autoCode(name)).toUpperCase().slice(0, 3);
  return {
    name,
    code,
    shirt: c.shirt,
    alt: c.alt,
    pat: c.pat,
    base: c.base,
    baseDk: shade(c.base, -0.55),
    rim: c.alt,
    gk: greenish(c.shirt) ? "#e8d23a" : "#2f8f46",
    head: "#2a1c10",
    rating: 2,
    form: "4-4-2",
    custom: true,
  };
}

/** Cleans club data from storage (or, later, from the network). */
export function cleanClub(c: unknown, fallback: ClubData): ClubData {
  if (!c || typeof c !== "object") return { ...fallback };
  const o = c as Record<string, unknown>;
  return {
    name: String(o.name ?? "")
      .replace(/\p{Cc}/gu, "")
      .slice(0, 20),
    code: String(o.code ?? "")
      .replace(/[^a-z0-9]/gi, "")
      .slice(0, 3),
    shirt: hexOk(o.shirt) ? o.shirt : fallback.shirt,
    alt: hexOk(o.alt) ? o.alt : fallback.alt,
    base: hexOk(o.base) ? o.base : fallback.base,
    pat: PATTERNS.includes(o.pat as Pattern) ? (o.pat as Pattern) : fallback.pat,
  };
}
