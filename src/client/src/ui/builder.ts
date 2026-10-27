import { RP } from "../engine/constants";
import { drawFigure } from "../render/figures";
import {
  autoCode,
  makeClub,
  PATTERNS,
  type Club,
  type ClubData,
  type Pattern,
} from "../rules/clubs";
import { colDist, hsl, shade } from "../util/colour";
import { pick, rnd } from "../util/math";
import { el, esc } from "./dom";

const PLACES = [
  "Riverside",
  "Kingsbridge",
  "Millbrook",
  "Castlegate",
  "Harbourside",
  "Northfield",
  "Westwood",
  "Elmstead",
  "Seacombe",
  "Lowmoor",
  "Hightown",
  "Redbank",
  "Stonehill",
  "Brookvale",
  "Fairhaven",
  "Saltmarsh",
  "Greystone",
  "Ravensdale",
  "Thornbury",
  "Copperfield",
  "Baize",
  "Feltham Green",
  "Chalkhill",
  "Marshgate",
];
const SUFFIX = [
  "Rovers",
  "Wanderers",
  "Athletic",
  "United",
  "Town",
  "Albion",
  "Rangers",
  "Harriers",
  "Dynamos",
  "Swifts",
  "Corinthians",
  "Villa",
  "Flyers",
  "FC",
];

/** Name, main, second and base colours for a ready-made kit. */
const SCHEMES: readonly (readonly [string, string, string, string])[] = [
  ["Claret and sky", "#7a1f3a", "#8fc4ea", "#7a1f3a"],
  ["Black and white", "#1b1b1b", "#f4f1e6", "#232323"],
  ["Tangerine and black", "#f26a21", "#1b1b1b", "#ef6b22"],
  ["Royal and white", "#1f4fb8", "#f4f1e6", "#1d45a0"],
  ["Green and gold", "#147a3c", "#f2c230", "#126b35"],
  ["Red and black", "#c9252c", "#1b1b1b", "#b81f26"],
  ["Navy and yellow", "#1b2f6b", "#f2d33a", "#1d3478"],
  ["Sky and navy", "#7cb7e8", "#1b2f6b", "#5b9bd6"],
  ["Purple and gold", "#6b2fa3", "#f2c230", "#5a2690"],
  ["Amber and black", "#f0a91c", "#151515", "#e9a21a"],
];

const rng = Math.random;

function suggestNames(n: number): string[] {
  const s = new Set<string>();
  while (s.size < n) s.add(`${pick(rng, PLACES)} ${pick(rng, SUFFIX)}`);
  return [...s];
}

function builderHTML(p: string): string {
  return `<div class="preview" aria-hidden="true">
      <canvas id="${p}Prev" width="264" height="132"></canvas>
      <div class="pv"><span class="pvn" id="${p}PvName"></span><span class="pvc" id="${p}PvCode"></span></div>
    </div>
    <div class="split">
      <div class="group"><label class="label" for="${p}Name">Club name</label><input class="txt" id="${p}Name" maxlength="20" autocomplete="off"></div>
      <div class="group"><label class="label" for="${p}Code">Short</label><input class="txt" id="${p}Code" maxlength="3" autocomplete="off"></div>
    </div>
    <div class="group"><span class="label">Need a name? Tap one</span><div class="sugg" id="${p}Sugg"></div></div>
    <div class="group"><span class="label">Shirt</span>
      <div class="seg pat" id="${p}Pat">
        <button type="button" data-v="solid">Plain</button><button type="button" data-v="stripes">Stripes</button><button type="button" data-v="hoops">Hoops</button><button type="button" data-v="halves">Halves</button><button type="button" data-v="sash">Sash</button>
      </div>
    </div>
    <div class="colors">
      <div class="group"><label class="label" for="${p}Shirt">Main</label><input type="color" id="${p}Shirt"></div>
      <div class="group"><label class="label" for="${p}Alt">Second</label><input type="color" id="${p}Alt"></div>
      <div class="group"><label class="label" for="${p}Base">Base</label><input type="color" id="${p}Base"></div>
    </div>
    <div class="group"><span class="label">Colour schemes</span><div class="schemes" id="${p}Schemes"></div></div>`;
}

export interface BuilderOptions {
  /** Element id prefix; the builder renders into #{prefix}Build. */
  prefix: string;
  data: ClubData;
  /** The live club object the match draws; updated in place. */
  club: Club;
  /** Randomise keeps the shirt clear of this club's. */
  rival: Club | null;
  /** Called after every edit (save it, refresh what shows it). */
  onChange: () => void;
}

export interface Builder {
  sync(): void;
  randomise(): void;
}

/** One builder drives the form, preview and data for one club. Used for your club and the custom opposition. */
export function makeBuilder(o: BuilderOptions): Builder {
  const { prefix, data, club } = o;
  el(prefix + "Build").innerHTML = builderHTML(prefix);
  const q = <T extends HTMLElement = HTMLElement>(id: string): T => el<T>(prefix + id);
  const input = (id: string): HTMLInputElement => q<HTMLInputElement>(id);

  function render(): void {
    q("PvName").textContent = club.name;
    q("PvCode").textContent = club.code;
    const c = q<HTMLCanvasElement>("Prev").getContext("2d");
    if (!c) return;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, 264, 132);
    c.setTransform(3.2, 0, 0, 3.2, 0, 0);
    drawFigure(c, { x: 20, y: 21, r: RP }, club, false, true);
    drawFigure(c, { x: 61, y: 21, r: RP }, club, true, true);
  }

  function schemes(): void {
    q("Schemes").innerHTML = SCHEMES.map(
      ([n, a, b, c], i) =>
        `<button type="button" data-i="${i}" title="${n}" aria-label="${n}" aria-pressed="${data.shirt === a && data.alt === b && data.base === c}" style="background:linear-gradient(90deg,${a} 50%,${b} 50%);border-color:${c}"></button>`,
    ).join("");
  }

  function sugg(): void {
    q("Sugg").innerHTML =
      suggestNames(3)
        .map((n) => `<button type="button" data-n="${esc(n)}">${esc(n)}</button>`)
        .join("") + `<button type="button" class="more" data-more="1">More names</button>`;
  }

  function sync(): void {
    input("Name").value = data.name;
    input("Code").value = data.code;
    input("Code").placeholder = autoCode(data.name || "My Club");
    input("Shirt").value = data.shirt;
    input("Alt").value = data.alt;
    input("Base").value = data.base;
    q("Pat")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === data.pat)));
    schemes();
    render();
  }

  function changed(): void {
    Object.assign(club, makeClub(data));
    render();
    o.onChange();
  }

  function randomise(): void {
    const avoid = o.rival?.shirt ?? null;
    for (let tries = 0; tries < 12; tries++) {
      if (rng() < 0.6) {
        const [, a, b, c] = pick(rng, SCHEMES);
        data.shirt = a;
        data.alt = b;
        data.base = c;
      } else {
        const h = rng() * 360;
        data.shirt = hsl(h, rnd(rng, 0.55, 0.85), rnd(rng, 0.3, 0.5));
        data.alt =
          rng() < 0.5
            ? "#f4f1e6"
            : hsl((h + rnd(rng, 150, 210)) % 360, rnd(rng, 0.6, 0.9), rnd(rng, 0.5, 0.65));
        data.base = rng() < 0.6 ? shade(data.shirt, -0.12) : shade(data.alt, -0.2);
      }
      if (!avoid || colDist(data.shirt, avoid) > 110) break; // keep the two sides easy to tell apart
    }
    data.name = suggestNames(1)[0] ?? data.name;
    data.code = "";
    data.pat = pick(rng, PATTERNS);
    sync();
    changed();
    sugg();
  }

  input("Name").addEventListener("input", (e) => {
    data.name = (e.target as HTMLInputElement).value;
    input("Code").placeholder = autoCode(data.name || "My Club");
    changed();
  });
  input("Code").addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    data.code = t.value.replace(/[^a-z0-9]/gi, "").toUpperCase();
    t.value = data.code;
    changed();
  });
  (
    [
      ["Shirt", "shirt"],
      ["Alt", "alt"],
      ["Base", "base"],
    ] as const
  ).forEach(([id, k]) =>
    input(id).addEventListener("input", (e) => {
      data[k] = (e.target as HTMLInputElement).value;
      changed();
      schemes();
    }),
  );
  q("Pat").addEventListener("click", (e) => {
    const v = (e.target as HTMLElement).dataset.v;
    if (!v || !PATTERNS.includes(v as Pattern)) return;
    data.pat = v as Pattern;
    sync();
    changed();
  });
  q("Schemes").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button");
    const s = b ? SCHEMES[Number(b.dataset.i)] : undefined;
    if (!s) return;
    [, data.shirt, data.alt, data.base] = s;
    sync();
    changed();
  });
  q("Sugg").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button");
    if (!b) return;
    if (b.dataset.more) return sugg();
    data.name = b.dataset.n ?? data.name;
    data.code = "";
    sync();
    changed();
    sugg();
  });
  sugg();
  return { sync, randomise };
}
