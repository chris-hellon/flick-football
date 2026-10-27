import { Sound } from "../audio/sound";
import type { Team } from "../engine/body";
import { figureById } from "../engine/world";
import { FxLog } from "../net/fxLog";
import { clubDto, type AimDto, type ClubDto } from "../net/protocol";
import { Renderer, type ViewState } from "../render/renderer";
import {
  CLUB,
  cleanClub,
  DEFAULT_CLUB,
  DEFAULT_OPP,
  makeClub,
  OPP,
  ORIGINAL_CLUBS,
  REMOTE,
  type Club,
  type ClubData,
} from "../rules/clubs";
import {
  cleanCup,
  cupLevel,
  newCup,
  opponentOf,
  recordResult,
  ROUNDS,
  type CupState,
} from "../rules/cup";
import {
  addResult,
  cleanResults,
  cupsWon,
  form,
  headToHead,
  outcome,
  recordRows,
  type MatchResult,
  type WinRecord,
} from "../rules/results";
import {
  FORMATION_NAMES,
  isFormation,
  type FormationName,
  type FormChoice,
} from "../rules/formations";
import { Match, PLACE_R, type MatchConfig, type MatchFormat } from "../rules/match";
import { makeBuilder, type Builder } from "./builder";
import { cupHTML } from "./cupView";
import { el, esc } from "./dom";
import { Input } from "./input";
import { kitCSS } from "./kit";
import { Online, type OnlineHost } from "./online";
import { flagTab, initTabs, selectTab } from "./tabs";
import { Ticker } from "./ticker";
import {
  loadClub,
  loadOppClub,
  loadSettings,
  migrateLegacy,
  store,
  type Settings,
} from "./settings";

const FMT_TEXT: Record<MatchFormat, string> = {
  t3: "Two halves of 3 minutes",
  t5: "Two halves of 5 minutes",
  g3: "First to 3 goals",
  g5: "First to 5 goals",
};
const DIFF_TEXT = ["Easy", "Medium", "Hard"] as const;
const MODE_HINT = {
  cpu: "You against the computer.",
  pvp: "Two players taking turns on this device.",
  online: "A friend on their own phone or computer.",
} as const;
/** Results listed before "Show all". */
const RECENT = 10;
const OUTCOME = { W: "Won", D: "Drawn", L: "Lost" } as const;
const gd = (r: WinRecord): string => {
  const d = r.gf - r.ga;
  return d > 0 ? `+${d}` : String(d);
};
const resultDate = (at: number): string => {
  const d = new Date(at);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
};
/** "Friendly · Medium computer · 27 Oct" and so on. */
function resultMeta(r: MatchResult): string {
  const what =
    r.kind === "cup"
      ? `Cup ${(r.round ?? "tie").toLowerCase()}`
      : r.kind === "online"
        ? r.cpuFinished
          ? "Online · computer finished it"
          : "Online friendly"
        : r.kind === "pvp"
          ? "Two players"
          : `Friendly · ${DIFF_TEXT[r.lvl ?? 1]} computer`;
  return [what, r.gg ? "golden goal" : "", resultDate(r.at)].filter(Boolean).join(" · ");
}
/** No animation frame for this long means the page is in the background. */
const STALLED_MS = 150;
const rng = Math.random;
const FRIEND: ClubData = {
  name: "Your friend",
  code: "",
  shirt: "#1b2f6b",
  alt: "#f4f1e6",
  pat: "solid",
  base: "#1d3478",
};

/** The page: side panel, scoreboard, overlays, the Cup, online play and the frame loop around one Match. */
export class App implements OnlineHost {
  private readonly s: Settings;
  /** Originals 0–7, your club at CLUB, your designed opposition at OPP, an online friend at REMOTE. */
  private readonly teams: Club[];
  private readonly club: ClubData;
  private readonly oppClub: ClubData;
  private cup: CupState | null;
  private readonly sound: Sound;
  readonly match: Match;
  readonly renderer: Renderer;
  readonly online: Online;
  private readonly input: Input;
  private readonly mine: Builder;
  private readonly theirs: Builder;
  private lastClock = "";
  private lastSkip: string | null = null;
  private last = 0;
  private frameAt = 0;
  private results: MatchResult[];
  private allResults = false;
  /** The friend left an online match and the computer finished it. */
  private cpuFinished = false;
  private readonly ticker = new Ticker(() => this.backgroundTick());

  constructor() {
    migrateLegacy();
    this.s = loadSettings();
    this.club = loadClub();
    this.oppClub = loadOppClub();
    this.teams = [
      ...ORIGINAL_CLUBS.map((c) => ({ ...c })),
      makeClub(this.club),
      makeClub(this.oppClub),
      makeClub(FRIEND),
    ];
    this.cup = cleanCup(store.get("cup"), CLUB);
    this.results = cleanResults(store.get("results"));
    this.sound = new Sound(this.s.sound);
    const fx = new FxLog(this.sound);
    this.match = new Match(
      {
        status: (msg, team) => this.showStatus(msg, team),
        board: () => this.board(),
        fullTime: () => this.showFullTime(),
      },
      fx,
      [this.team(0), this.team(1)],
    );
    const cv = el<HTMLCanvasElement>("cv");
    const stage = el("stage");
    this.renderer = new Renderer(cv, stage);
    this.online = new Online(this, fx);
    this.input = new Input(
      cv,
      {
        phase: () => this.match.phase,
        canAim: () => this.canAim(),
        pickPlayer: (x, y) => this.match.pickPlayer(x, y),
        tappedLocked: (x, y) => void this.match.tappedLocked(x, y),
        canPlaceAt: (x, y) => this.canPlace() && this.nearBall(x, y),
        place: (x, y, done) => this.place(x, y, done),
        flick: (p, vx, vy) => {
          if (this.online.guestSide) this.online.sendFlick(p, vx, vy);
          else this.match.humanFlick(p, vx, vy);
        },
        aim: (a) => this.online.sendAim(a),
        replayTap: () => {
          if (!this.online.guestSide) this.match.endReplay();
        },
      },
      this.renderer,
      () => this.sound.init(),
    );
    this.mine = makeBuilder({
      prefix: "c",
      data: this.club,
      club: this.team(CLUB),
      rival: null,
      onChange: () => this.clubChanged(CLUB),
    });
    this.theirs = makeBuilder({
      prefix: "o",
      data: this.oppClub,
      club: this.team(OPP),
      rival: this.team(CLUB),
      onChange: () => this.clubChanged(OPP),
    });
    this.wireControls();
    this.fillSelects();
    this.syncControls();
    this.mine.sync();
    this.theirs.sync();
    new ResizeObserver(() => this.renderer.resize()).observe(stage);
    this.renderer.resize();
    // The pitch cache has text on it: redraw once the web fonts arrive.
    void document.fonts?.ready.then(() => this.renderer.resize());
    this.preMatch();
    this.online.updateCard();
    this.renderResults();
    initTabs();
    this.online.resume();
    requestAnimationFrame((t) => {
      this.last = t;
      this.frame(t);
    });
  }

  private team(i: number): Club {
    const t = this.teams[i];
    if (!t) throw new Error(`no team ${i}`);
    return t;
  }

  private formFor(team: number, choice: FormChoice): FormationName {
    return choice !== "club" && isFormation(choice) ? choice : this.team(team).form;
  }

  // ---------- Who may flick ----------
  private canAim(): boolean {
    const m = this.match;
    const o = this.online;
    if (o.guestSide)
      return (
        o.role === "guest" &&
        !!m.cfg &&
        (m.phase === "aim" || m.phase === "block") &&
        m.actor() === 1
      );
    if (!m.canAim()) return false;
    // Hosting: only our side, and only while the friend is connected.
    return m.cfg?.mode !== "online" || (m.actor() === 0 && o.otherPresent);
  }

  /** May this screen move the restart taker now? */
  private canPlace(): boolean {
    const m = this.match;
    const o = this.online;
    if (!m.canPlace()) return false;
    if (o.guestSide) return o.role === "guest" && m.turn === 1;
    return m.cfg?.mode !== "online" || (m.turn === 0 && o.otherPresent);
  }

  private nearBall(x: number, y: number): boolean {
    const b = this.match.world.ball;
    return Math.hypot(x - b.x, y - b.y) <= PLACE_R + 12;
  }

  private place(x: number, y: number, done: boolean): void {
    const m = this.match;
    const tk = m.placing;
    if (!tk || !this.canPlace()) return;
    // A guest moves its taker straight away; the host's next snapshot confirms the spot.
    if (m.placeTaker(x, y) || done) {
      if (this.online.guestSide) this.online.sendPlace(tk, done);
    }
  }

  private skipLabel(): string | null {
    const m = this.match;
    const o = this.online;
    if (o.guestSide)
      return o.role === "guest" && m.phase === "block" && m.actor() === 1
        ? "Skip block flick"
        : null;
    if (m.cfg?.mode === "online" && m.phase === "block" && m.actor() !== 0) return null;
    return m.skipLabel();
  }

  private skip(): void {
    if (this.online.guestSide) this.online.sendSkip();
    else if (this.skipLabel()) this.match.skip();
  }

  /** The other player's aim preview, drawn faded. */
  private remoteAim(): ViewState["remoteAim"] {
    const m = this.match;
    const o = this.online;
    let a: AimDto | null = null;
    if (o.guestSide && m.actor() === 0) a = o.view.hostAim;
    else if (o.role === "host" && m.cfg?.mode === "online" && m.actor() === 1) a = o.remoteAim;
    const p = a ? figureById(m.world, a.id) : undefined;
    return a && p ? { p, vx: a.vx, vy: a.vy, block: a.b === 1 } : null;
  }

  // ---------- Frame loop ----------
  private frame(now: number): void {
    const dt = Math.max(0, Math.min((now - this.last) / 1000, 0.05));
    this.last = now;
    this.frameAt = performance.now();
    if (this.online.guestSide) this.online.view.frame(dt);
    else {
      this.match.frame(dt);
      this.online.hostTick(now, this.input.aim());
    }
    this.input.tick();
    this.updateClock();
    this.updateSkip();
    this.renderer.render(this.match, {
      ...this.input.view(),
      remoteAim: this.remoteAim(),
      placeRing: this.canPlace(),
    });
    requestAnimationFrame((t) => this.frame(t));
  }

  /**
   * Browsers stop animation frames in a background tab or a covered window. The host's page runs
   * the match for both players, so while hosting a worker timer keeps it going (nothing is drawn).
   */
  private backgroundTick(): void {
    const now = performance.now();
    if (this.online.role !== "host" || now - this.frameAt < STALLED_MS) return;
    // Catch up in frame-sized steps if the timer lagged, but never more than a second at once.
    let behind = Math.min(now - this.last, 1000);
    this.last = now;
    while (behind > 0) {
      const step = Math.min(behind, 50);
      this.match.frame(step / 1000);
      behind -= step;
    }
    this.online.hostTick(now, null);
  }

  // ---------- Scoreboard ----------
  private showStatus(msg: string, team: Team): void {
    const m = this.match;
    const line = el("status");
    if (line.textContent !== msg) {
      line.textContent = msg;
      // Restart the fade-in for each new line of commentary.
      line.classList.remove("fresh", "tight");
      // A long line (two long club names) steps down a size rather than being cut off.
      if (line.scrollHeight > line.clientHeight + 1) line.classList.add("tight");
      void line.offsetWidth;
      line.classList.add("fresh");
    }
    el("chip").style.background = m.kits[team].shirt;
    el("t0").classList.toggle("on", m.actor() === 0);
    el("t1").classList.toggle("on", m.actor() === 1);
  }

  /** A notice for this screen only. It isn't the match's status, so it never reaches the guest. */
  status(msg: string): void {
    this.showStatus(msg, 0);
    // A guest shows the host's status line again with the next snapshot.
    if (this.online.guestSide) this.match.lastStatus = "";
  }

  board(): void {
    const m = this.match;
    for (const t of [0, 1] as const) {
      el("s" + t).textContent = String(m.score[t]);
      el("n" + t).textContent = m.kits[t].name;
      el("c" + t).textContent = m.kits[t].code;
      el("kit" + t).style.background = kitCSS(m.kits[t]);
    }
  }

  private updateClock(): void {
    const m = this.match;
    let txt: string;
    if (!m.cfg) txt = "";
    else if (m.half === "gg") txt = "Golden goal";
    else if (!m.timed()) txt = `First to ${m.goalTarget()}`;
    else {
      const s = Math.ceil(m.clockLeft);
      const min = Math.floor(s / 60);
      txt = `${m.half === 1 ? "1st" : "2nd"} half · ${min}:${String(s % 60).padStart(2, "0")}`;
    }
    if (txt !== this.lastClock) {
      el("clock").textContent = txt;
      this.lastClock = txt;
    }
  }

  private updateSkip(): void {
    const label = this.skipLabel();
    if (label === this.lastSkip) return;
    this.lastSkip = label;
    const b = el("skip");
    b.hidden = !label;
    if (label) b.textContent = label;
  }

  // ---------- Match flow ----------
  private friendlyCfg(): MatchConfig {
    const s = this.s;
    return {
      cup: false,
      mode: s.mode === "pvp" ? "pvp" : "cpu",
      lvl: s.diff,
      home: this.team(CLUB),
      away: this.team(s.away),
      fmt: s.fmt,
      block: !!s.block,
      forms: [this.formFor(CLUB, s.form0), this.formFor(s.away, s.form1)],
    };
  }

  private onlineCfg(): MatchConfig {
    const s = this.s;
    return {
      cup: false,
      mode: "online",
      lvl: 1,
      home: this.team(CLUB),
      away: this.team(REMOTE),
      fmt: s.fmt,
      block: !!s.block,
      forms: [this.formFor(CLUB, s.form0), this.online.friendForm],
    };
  }

  /** Online chosen under Play against, or already hosting a match. */
  private onlineMode(): boolean {
    return this.s.mode === "online" || this.online.role === "host";
  }

  private cfg(): MatchConfig {
    return this.onlineMode() ? this.onlineCfg() : this.friendlyCfg();
  }

  /** The one main action right now, shared by the side button and the pre-match card. */
  private action(): { label: string; hint: string; go: (() => void) | null } {
    const o = this.online;
    const pre = this.match.phase === "menu";
    const start = (): void => this.begin(this.cfg());
    if (o.guestSide)
      return o.role === "guest"
        ? {
            label: `Your ${o.them} kicks off`,
            hint: o.isPublic
              ? "You're in a public match."
              : "You're in your friend's online match.",
            go: null,
          }
        : { label: "Watching", hint: "This match already has two players.", go: null };
    if (this.onlineMode()) {
      if (!o.role)
        return {
          label: "Create online match",
          hint: "Or join your friend's match with their code.",
          go: () => void o.create(),
        };
      if (!o.otherPresent)
        return o.isPublic
          ? {
              label: "Finding an opponent…",
              hint: "The next person to tap Play anyone joins you.",
              go: null,
            }
          : {
              label: "Waiting for your friend",
              hint: `Send them the code ${o.code} or the link.`,
              go: null,
            };
      return pre
        ? {
            label: "Kick off",
            hint: `Your ${o.them} is here. Kick off when you're both ready.`,
            go: start,
          }
        : {
            label: "Restart match",
            hint: `Starts a fresh online match with your ${o.them}.`,
            go: start,
          };
    }
    return pre
      ? { label: "Kick off", hint: "The match starts when you press this.", go: start }
      : { label: "Restart match", hint: "Starts a fresh match with the Play settings.", go: start };
  }

  private hideOverlays(): void {
    el("ftOver").hidden = true;
    el("cupOver").hidden = true;
    el("preOver").hidden = true;
  }

  private begin(cfg: MatchConfig): void {
    this.hideOverlays();
    this.input.clear();
    this.sound.init();
    this.online.fx.entries = [];
    this.cpuFinished = false;
    this.match.start(cfg);
    this.updateClock();
    this.clearDirty();
    this.online.updateCard();
  }

  private startFriendly(): void {
    this.action().go?.();
  }

  /** Lines the teams up on the pre-match card: nothing runs until Kick off. */
  private preMatch(): void {
    if (this.online.guestSide) return;
    this.input.clear();
    const o = this.online;
    // Until a friend joins, the away side is a placeholder.
    if (this.onlineMode() && !o.otherPresent) Object.assign(this.team(REMOTE), makeClub(FRIEND));
    const cfg = this.cfg();
    const msg = !this.onlineMode()
      ? undefined
      : o.otherPresent
        ? `${cfg.away.name} are here. Press Kick off when you're both ready.`
        : o.role === "host"
          ? o.isPublic
            ? "Looking for an opponent. You can still change your club."
            : `Waiting for your friend to join with code ${o.code}. You can still change your club.`
          : "Create an online match and send your friend the code, or join theirs.";
    this.match.preMatch(cfg, msg);
    this.updateClock();
    this.syncPre();
    this.hideOverlays();
    el("preOver").hidden = false;
    const a = this.action();
    this.setPreKick(!!a.go, a.label);
    this.clearDirty();
    this.online.updateCard();
  }

  private setPreKick(enabled: boolean, label: string): void {
    const b = el<HTMLButtonElement>("preKick");
    b.disabled = !enabled;
    b.textContent = label;
  }

  private syncPre(): void {
    const m = this.match;
    const cfg = m.cfg;
    if (!cfg) return;
    for (const t of [0, 1] as const) {
      el("preName" + t).textContent = m.kits[t].name;
      el("preKit" + t).style.background = kitCSS(m.kits[t]);
    }
    const who =
      cfg.mode === "online"
        ? this.online.role === "host" && !this.online.otherPresent
          ? `Code ${this.online.code}`
          : ""
        : cfg.mode === "pvp"
          ? "Two players"
          : `${DIFF_TEXT[this.s.diff]} computer`;
    // Each part stays on one line ("4-4-2 v 4-4-2" must never break at a hyphen).
    el("preInfo").innerHTML = [FMT_TEXT[cfg.fmt], who, `${cfg.forms[0]} v ${cfg.forms[1]}`]
      .filter(Boolean)
      .map((x) => `<span class="nb">${esc(x)}</span>`)
      .join(" · ");
    el("preTag").textContent = cfg.mode === "online" ? "Online friendly" : "Friendly";
  }

  /** save: false when a guest rejoins a match that had already finished (saved the first time). */
  private showFullTime(save = true): void {
    const m = this.match;
    const cfg = m.cfg;
    if (!cfg) return;
    const N = m.name;
    const w = m.winner();
    const [a, b] = m.stats;
    el("ftTag").textContent = cfg.cup
      ? `Full time · ${ROUNDS[this.cup?.round ?? 0] ?? ""}`
      : "Full time";
    el("ftRes").textContent = w === null ? "Draw" : `${N(w)} win`;
    el("ftScore").textContent =
      `${N(0)} ${m.score[0]} – ${m.score[1]} ${N(1)}${m.half === "gg" ? " (golden goal)" : ""}`;
    const tf = a.flicks + b.flicks || 1;
    const rows: [string, string | number, string | number][] = [
      ["Shots", a.shots, b.shots],
      ["On target", a.onT, b.onT],
      ["Saves", a.saves, b.saves],
      [
        "Possession",
        Math.round((a.flicks / tf) * 100) + "%",
        Math.round((b.flicks / tf) * 100) + "%",
      ],
      ["Flicks", a.flicks, b.flicks],
      ["Corners", a.corners, b.corners],
      ["Fouls", a.fouls, b.fouls],
    ];
    el("ftStats").innerHTML =
      `<tr><td>${esc(m.kits[0].code)}</td><td></td><td>${esc(m.kits[1].code)}</td></tr>` +
      rows.map((r) => `<tr><td>${r[1]}</td><td>${r[0]}</td><td>${r[2]}</td></tr>`).join("");
    const ftNext = el("ftNext");
    if (cfg.cup && this.cup) {
      recordResult(this.cup, m.score[0], m.score[1], m.half === "gg", this.teams, rng);
      store.set("cup", this.cup);
      this.syncCupBtn();
      ftNext.textContent = "Back to the Cup";
    } else if (this.online.guestSide) ftNext.textContent = "Leave online match";
    else if (cfg.mode === "online") ftNext.textContent = "Rematch";
    else ftNext.textContent = "Play again";
    el("ftOver").hidden = false;
    if (save) this.saveResult();
    if (!this.online.guestSide)
      m.setStatus(`Full time. ${N(0)} ${m.score[0]}, ${N(1)} ${m.score[1]}.`, w ?? 0);
  }

  // ---------- Results ----------
  /** Keeps the finished match on this device. Spectators don't keep anything. */
  private saveResult(): void {
    const m = this.match;
    const cfg = m.cfg;
    const o = this.online;
    if (!cfg || (o.guestSide && o.role !== "guest")) return;
    const me = o.role === "guest" ? 1 : 0;
    const them = me === 0 ? 1 : 0;
    const online = o.role !== null || this.cpuFinished;
    const r: MatchResult = {
      at: Date.now(),
      kind: cfg.cup ? "cup" : online ? "online" : cfg.mode === "pvp" ? "pvp" : "cpu",
      lvl: null,
      round: cfg.cup ? (ROUNDS[this.cup?.round ?? 0] ?? null) : null,
      me: cleanClub(m.kits[me], DEFAULT_CLUB),
      opp: cleanClub(m.kits[them], DEFAULT_OPP),
      gf: m.score[me],
      ga: m.score[them],
      gg: m.half === "gg",
      cpuFinished: this.cpuFinished,
    };
    if (r.kind === "cpu") r.lvl = cfg.lvl < 0.5 ? 0 : cfg.lvl < 1.5 ? 1 : 2;
    this.results = addResult(this.results, r);
    store.set("results", this.results);
    this.renderResults();
    flagTab("results", "new");
  }

  private renderResults(): void {
    const list = this.results;
    el("resEmpty").hidden = list.length > 0;
    el("resHead").hidden = list.length === 0;
    el("resBody").hidden = list.length === 0;
    el("resForm").innerHTML = form(list)
      .map((x) => `<span class="o ${x}" title="${OUTCOME[x]}">${x}</span>`)
      .join("");
    if (!list.length) return;
    const nums = (r: WinRecord): string =>
      [r.p, r.w, r.d, r.l].map((n) => `<td>${n}</td>`).join("") + `<td>${gd(r)}</td>`;
    const head = "<tr><th></th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th></tr>";
    el("resRec").innerHTML =
      head +
      recordRows(list)
        .map((row) => `<tr><td>${esc(row.label)}</td>${nums(row.rec)}</tr>`)
        .join("");
    const cups = cupsWon(list);
    el("resCups").hidden = cups === 0;
    el("resCups").textContent = cups === 1 ? "Cups won: 1" : `Cups won: ${cups}`;

    const shown = this.allResults ? list : list.slice(0, RECENT);
    el("resList").innerHTML = shown
      .map((r) => {
        const x = outcome(r);
        const score = `${esc(r.me.name)} ${r.gf}–${r.ga} ${esc(r.opp.name)}`;
        return (
          `<li><span class="o ${x}" title="${OUTCOME[x]}">${x}</span>` +
          `<span class="kit" style="background:${kitCSS(makeClub(r.opp))}"></span>` +
          `<span class="txt"><span class="sc">${score}</span>` +
          `<span class="meta">${esc(resultMeta(r))}</span></span></li>`
        );
      })
      .join("");
    const more = el<HTMLButtonElement>("resMore");
    more.hidden = list.length <= RECENT;
    more.textContent = this.allResults ? "Show fewer" : `Show all ${list.length}`;

    el("resH2H").innerHTML =
      "<tr><th></th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th></tr>" +
      headToHead(list)
        .map(
          (h) =>
            `<tr><td><span class="kit" style="background:${kitCSS(makeClub(h.opp))}"></span>` +
            `${esc(h.opp.name)}</td>${nums(h.rec)}</tr>`,
        )
        .join("");
  }

  private clearResults(): void {
    if (!confirm("Clear all your results from this device? This can't be undone.")) return;
    this.results = [];
    this.allResults = false;
    store.set("results", []);
    this.renderResults();
  }

  // ---------- Online (OnlineHost) ----------
  myClub(): ClubDto {
    return clubDto(this.club);
  }

  myForm(): FormationName {
    return this.formFor(CLUB, this.s.form0);
  }

  setFriendClub(club: ClubData): void {
    Object.assign(this.team(REMOTE), makeClub(club));
    if (this.match.cfg?.away === this.team(REMOTE)) this.board();
  }

  refreshPreMatch(force = false): void {
    if (force || (this.match.phase === "menu" && el("cupOver").hidden)) this.preMatch();
  }

  showPitch(): void {
    const r = el("stage").getBoundingClientRect();
    if (r.top < 0 || r.top > innerHeight / 2)
      el("stage").scrollIntoView({ block: "start", behavior: "smooth" });
  }

  seatChanged(): void {
    const flip = this.online.role === "guest";
    if (this.renderer.flip !== flip) {
      this.renderer.flip = flip;
      this.renderer.resize();
    }
    this.input.clear();
    if (this.online.role === "host") this.ticker.start();
    else this.ticker.stop();
    if (this.online.role) this.setMode("online");
    else this.syncControls();
    if (this.online.guestSide) {
      this.match.halt();
      this.hideOverlays();
      el("preOver").hidden = false;
      this.setPreKick(false, "Connecting…");
    }
    this.clearDirty();
  }

  /** A snapshot arrived: follow the host's overlays. */
  showState(prev: string): void {
    const m = this.match;
    if (m.phase === "menu") {
      el("preOver").hidden = false;
      this.syncPre();
      const guest = this.online.role === "guest";
      this.setPreKick(
        false,
        guest ? "Waiting for your friend to kick off" : "Waiting for kick-off",
      );
      // The host's own pre-match line ("… are here") isn't meant for this screen.
      this.status(
        guest
          ? `Connected. Your ${this.online.them} kicks off when you're both ready.`
          : "You're watching. The match starts when the host kicks off.",
      );
    } else el("preOver").hidden = true;
    if (m.phase === "over" && prev !== "over") this.showFullTime(prev !== "menu");
    else if (m.phase !== "over") el("ftOver").hidden = true;
    this.updateClock();
    this.online.updateCard();
  }

  ended(keepMatch: boolean): void {
    if (!keepMatch) this.preMatch();
    else this.clearDirty();
  }

  showOnline(): void {
    this.setMode("online");
    selectTab("play");
  }

  playOnVsComputer(): void {
    this.cpuFinished = true;
    this.setMode("cpu");
    this.match.handOverToComputer(this.s.diff);
    this.match.setStatus(
      `The computer takes over ${this.match.name(1)}. Play on.`,
      this.match.turn,
    );
    void this.online.leave(true);
  }

  // ---------- Cup ----------
  private openCup(): void {
    if (this.online.role) void this.online.leave(true);
    this.cup ??= newCup(CLUB, rng);
    store.set("cup", this.cup);
    this.match.halt();
    this.input.clear();
    this.hideOverlays();
    el("cupOver").hidden = false;
    this.renderCup();
  }

  private closeCup(): void {
    el("cupOver").hidden = true;
    this.preMatch();
  }

  private playCupTie(): void {
    const cup = this.cup;
    const opp = cup ? opponentOf(cup) : null;
    if (!cup || opp === null) return;
    const s = this.s;
    const o = this.team(opp);
    this.begin({
      cup: true,
      mode: "cpu",
      lvl: cupLevel(s.diff, o.rating, cup.round),
      home: this.team(cup.team),
      away: o,
      fmt: s.fmt.startsWith("t") ? s.fmt : "t3",
      block: !!s.block,
      forms: [this.formFor(CLUB, s.form0), o.form],
    });
  }

  private renderCup(): void {
    const cup = this.cup;
    if (!cup) return;
    el("cupSheet").innerHTML = cupHTML(cup, this.teams);
    const on = (id: string, fn: () => void): void => {
      const b = document.getElementById(id);
      if (b) b.onclick = fn;
    };
    on("cupPlay", () => this.playCupTie());
    on("cupNew", () => {
      this.cup = newCup(CLUB, rng);
      store.set("cup", this.cup);
      this.renderCup();
    });
    on("cupAbandon", () => {
      this.cup = null;
      store.set("cup", null);
      this.closeCup();
    });
    on("cupClose", () => this.closeCup());
    this.syncCupBtn();
  }

  private syncCupBtn(): void {
    const cup = this.cup;
    el("cupBtn").textContent = !cup
      ? "Enter the Cup"
      : cup.champ !== null
        ? "View the Cup"
        : `Continue: ${ROUNDS[cup.round] ?? ""}`;
  }

  // ---------- Side panel ----------
  private clubChanged(idx: number): void {
    store.set(idx === CLUB ? "club" : "oppClub", idx === CLUB ? this.club : this.oppClub);
    if (idx === OPP) {
      const o = [...el<HTMLSelectElement>("awaySel").options].find((x) => Number(x.value) === OPP);
      if (o) o.textContent = `${this.team(OPP).name} (your design)`;
    }
    if (idx === CLUB) this.online.clubChanged();
    const cfg = this.match.cfg;
    const club = this.team(idx);
    if (!this.online.guestSide && cfg && (cfg.home === club || cfg.away === club)) {
      this.board();
      if (this.match.phase === "menu") this.syncPre();
    }
    if (!el("cupOver").hidden && this.cup) this.renderCup();
  }

  private fillSelects(): void {
    el("awaySel").innerHTML =
      `<option value="${OPP}">${esc(this.team(OPP).name)} (your design)</option>` +
      [0, 1, 2, 3, 4, 5, 6, 7]
        .map((i) => `<option value="${i}">${esc(this.team(i).name)}</option>`)
        .join("");
    this.fillForms();
  }

  private fillForms(): void {
    const list = FORMATION_NAMES.map((f) => `<option value="${f}">${f}</option>`).join("");
    const f0 = el<HTMLSelectElement>("form0Sel");
    const f1 = el<HTMLSelectElement>("form1Sel");
    f0.innerHTML = `<option value="club">Usual (${this.team(CLUB).form})</option>` + list;
    f1.innerHTML = `<option value="club">Usual (${this.team(this.s.away).form})</option>` + list;
    f0.value = this.s.form0;
    f1.value = this.s.form1;
  }

  private syncControls(): void {
    const s = this.s;
    const press = (seg: string, v: string): void =>
      document
        .querySelectorAll<HTMLButtonElement>(`#${seg} button`)
        .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === v)));
    press("modeSeg", s.mode);
    press("diffSeg", String(s.diff));
    press("blockSeg", String(s.block));
    el("modeHint").textContent = MODE_HINT[s.mode];
    el("offBox").hidden = s.mode === "online";
    el("onBox").hidden = s.mode !== "online";
    el("diffBox").hidden = s.mode !== "cpu";
    el("form1Box").hidden = s.mode === "online";
    // A guest plays the host's match: only its own shape is its choice.
    el("lenBox").hidden = el("blockBox").hidden = this.online.guestSide;
    el<HTMLSelectElement>("awaySel").value = String(s.away);
    el<HTMLSelectElement>("fmtSel").value = s.fmt;
    el("oBox").hidden = s.away !== OPP;
    this.fillForms();
    el("sndTxt").textContent = s.sound ? "Sound on" : "Sound off";
    el("snd").setAttribute("aria-pressed", String(s.sound));
    this.syncCupBtn();
  }

  /** Settings only take effect at kick-off, so the button says so when they've changed. */
  private markDirty(): void {
    if (this.online.guestSide) return;
    const m = this.match;
    if (m.phase === "menu" && !m.cfg?.cup) return this.preMatch();
    if (this.onlineMode() && !this.online.otherPresent) return this.clearDirty();
    const b = el("startBtn");
    b.classList.add("ready");
    b.textContent = "Kick off with these settings";
    el("kickHint").textContent = "Your changes start from the next kick-off.";
  }

  private clearDirty(): void {
    const b = el<HTMLButtonElement>("startBtn");
    const a = this.action();
    b.disabled = !a.go;
    b.classList.toggle("ready", !!a.go && this.match.phase === "menu");
    b.textContent = a.label;
    el("kickHint").textContent = a.hint;
    // The pre-match card carries the same action.
    if (!el("preOver").hidden && !this.online.guestSide) this.setPreKick(!!a.go, a.label);
  }

  /** Play against: computer, same device or online. */
  private setMode(mode: Settings["mode"]): void {
    const s = this.s;
    if (s.mode === mode) return this.syncControls();
    s.mode = mode;
    store.set("mode", mode);
    this.syncControls();
  }

  private seg(id: string, apply: (v: string) => void): void {
    el(id).addEventListener("click", (e) => {
      const v = (e.target as HTMLElement).dataset.v;
      if (v === undefined) return;
      apply(v);
      this.syncControls();
      this.markDirty();
    });
  }

  private wireControls(): void {
    el("resClear").addEventListener("click", () => this.clearResults());
    el("resMore").addEventListener("click", () => {
      this.allResults = !this.allResults;
      this.renderResults();
    });
    const s = this.s;
    this.seg("modeSeg", (v) => {
      const mode = v === "pvp" || v === "online" ? v : "cpu";
      if (mode !== "online" && this.online.role) {
        if (!confirm("Leave the online match?")) return;
        void this.online.leave();
      }
      this.setMode(mode);
    });
    this.seg("diffSeg", (v) => {
      s.diff = v === "0" ? 0 : v === "2" ? 2 : 1;
      store.set("diff", s.diff);
    });
    this.seg("blockSeg", (v) => {
      s.block = v === "1" ? 1 : 0;
      store.set("blockOn", s.block);
    });
    el("cRand").addEventListener("click", () => this.mine.randomise());
    el("oRand").addEventListener("click", () => {
      this.theirs.randomise();
      s.away = OPP;
      store.set("away", OPP);
      this.syncControls();
      this.markDirty();
    });
    el<HTMLSelectElement>("awaySel").addEventListener("change", (e) => {
      const v = Number((e.target as HTMLSelectElement).value);
      s.away = (v >= 0 && v < CLUB) || v === OPP ? v : 0;
      store.set("away", s.away);
      this.syncControls();
      this.markDirty();
    });
    el<HTMLSelectElement>("fmtSel").addEventListener("change", (e) => {
      const v = (e.target as HTMLSelectElement).value;
      s.fmt = v === "t5" || v === "g3" || v === "g5" ? v : "t3";
      store.set("fmt", s.fmt);
      this.markDirty();
    });
    for (const [id, key] of [
      ["form0Sel", "form0"],
      ["form1Sel", "form1"],
    ] as const) {
      el<HTMLSelectElement>(id).addEventListener("change", (e) => {
        const v = (e.target as HTMLSelectElement).value;
        s[key] = isFormation(v) ? v : "club";
        store.set(key, s[key]);
        if (key === "form0") this.online.clubChanged();
        this.markDirty();
      });
    }
    el("startBtn").addEventListener("click", () => this.startFriendly());
    el("preKick").addEventListener("click", () => this.startFriendly());
    el("cupBtn").addEventListener("click", () => this.openCup());
    el("ftNext").addEventListener("click", () => {
      if (this.online.guestSide) void this.online.leave();
      else if (this.match.cfg?.cup && this.cup) this.openCup();
      else this.startFriendly();
    });
    el("snd").addEventListener("click", () => {
      s.sound = !s.sound;
      store.set("sound", s.sound);
      this.sound.enabled = s.sound;
      if (s.sound) this.sound.init();
      const ph = this.match.phase;
      this.sound.crowd(s.sound && !!this.match.cfg && ph !== "over" && ph !== "menu");
      this.syncControls();
    });
    el("skip").addEventListener("click", () => this.skip());
    document.addEventListener("keydown", (e) => {
      if (
        (e.key === " " || e.key === "Enter") &&
        !el("skip").hidden &&
        document.activeElement === document.body
      ) {
        e.preventDefault();
        this.skip();
      }
    });
  }
}
