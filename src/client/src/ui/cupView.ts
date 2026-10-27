import type { Club } from "../rules/clubs";
import { myTie, ROUNDS, type CupState, type Tie } from "../rules/cup";
import { esc } from "./dom";
import { kitEl } from "./kit";

function tieHTML(cup: CupState, teams: readonly Club[], t: Tie): string {
  const row = (ti: number | null, g: number | null): string => {
    const k = ti === null ? undefined : teams[ti];
    if (ti === null || !k) return `<div class="tr tbd"><span class="tn">To be decided</span></div>`;
    const cls = [t.w === null ? "" : t.w === ti ? "w" : "l", ti === cup.team ? "you" : ""].join(
      " ",
    );
    return `<div class="tr ${cls}">${kitEl(k)}<span class="tn">${esc(k.name)}</span><span class="tg">${g === null ? "" : g}${t.gg && t.w === ti ? "*" : ""}</span></div>`;
  };
  return `<div class="tie">${row(t.a, t.ga)}${row(t.b, t.gb)}</div>`;
}

/** The Cup sheet: head, bracket and action buttons (ids cupPlay, cupNew, cupAbandon, cupClose). */
export function cupHTML(cup: CupState, teams: readonly Club[]): string {
  const cols = [0, 1, 2]
    .map((r) => {
      const ties =
        cup.rounds[r] ??
        Array.from({ length: [4, 2, 1][r] ?? 1 }, (): Tie => ({
          a: null,
          b: null,
          ga: null,
          gb: null,
          w: null,
          gg: false,
        }));
      return `<div class="col"><h3>${ROUNDS[r] ?? ""}</h3>${ties.map((t) => tieHTML(cup, teams, t)).join("")}</div>`;
    })
    .join("");
  const name = (i: number | null): string => esc((i === null ? undefined : teams[i]?.name) ?? "");
  const me = name(cup.team);
  let head: string;
  let actions: string;
  if (cup.champ !== null) {
    const won = cup.champ === cup.team;
    head = won
      ? `<span class="res">Cup winners</span><span class="line">${me} lift the Cup.</span>`
      : `<span class="res">Knocked out</span><span class="line">${name(cup.champ)} won the Cup.</span>`;
    actions = `<button class="btn amber" id="cupNew">New Cup</button><button class="btn ghost" id="cupClose">Close</button>`;
  } else {
    const t = myTie(cup);
    const opp = t ? (t.a === cup.team ? t.b : t.a) : null;
    const round = ROUNDS[cup.round] ?? "";
    head = `<span class="tag">${me}</span><span class="res">${round}</span><span class="line">Next: ${name(opp)}</span>`;
    actions = `<button class="btn amber" id="cupPlay">Play the ${round.toLowerCase()}</button><button class="btn ghost" id="cupAbandon">Abandon Cup</button><button class="btn ghost" id="cupClose">Close</button>`;
  }
  const champ = cup.champ !== null ? `<div class="champ">Winners: ${name(cup.champ)}</div>` : "";
  return `${head}<div class="bracket">${cols}</div>${champ}<p class="hint">* won on golden goal</p><div class="row">${actions}</div>`;
}
