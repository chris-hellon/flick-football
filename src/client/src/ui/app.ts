import { Sound } from "../audio/sound";
import type { Team } from "../engine/body";
import { playerById } from "../engine/world";
import { FxLog } from "../net/fxLog";
import { clubDto, type AimDto, type ClubDto } from "../net/protocol";
import { Renderer, type ViewState } from "../render/renderer";
import {
  CLUB,
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
  FORMATION_NAMES,
  isFormation,
  type FormationName,
  type FormChoice,
} from "../rules/formations";
import { Match, type MatchConfig, type MatchFormat } from "../rules/match";
import { makeBuilder, type Builder } from "./builder";
import { cupHTML } from "./cupView";
import { el, esc } from "./dom";
import { Input } from "./input";
import { kitCSS } from "./kit";
import { Online, type OnlineHost } from "./online";
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
    const p = a ? playerById(m.world, a.id) : undefined;
    return a && p ? { p, vx: a.vx, vy: a.vy, block: a.b === 1 } : null;
  }

  // ---------- Frame loop ----------
  private frame(now: number): void {
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    if (this.online.guestSide) this.online.view.frame(dt);
    else {
      this.match.frame(dt);
      this.online.hostTick(now, this.input.aim());
    }
    this.input.tick();
    this.updateClock();
    this.updateSkip();
    this.renderer.render(this.match, { ...this.input.view(), remoteAim: this.remoteAim() });
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------- Scoreboard ----------
  private showStatus(msg: string, team: Team): void {
    const m = this.match;
    el("status").textContent = msg;
    el("chip").style.background = m.kits[team].shirt;
    el("t0").classList.toggle("on", m.actor() === 0);
    el("t1").classList.toggle("on", m.actor() === 1);
  }

  status(msg: string): void {
    this.match.setStatus(msg, 0);
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
      mode: s.mode,
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

  private cfg(): MatchConfig {
    return this.online.hosting ? this.onlineCfg() : this.friendlyCfg();
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
    this.match.start(cfg);
    this.updateClock();
    this.clearDirty();
    this.online.updateCard();
  }

  private startFriendly(): void {
    if (this.online.guestSide) return;
    this.begin(this.cfg());
  }

  /** Lines the teams up on the pre-match card: nothing runs until Kick off. */
  private preMatch(): void {
    if (this.online.guestSide) return;
    this.input.clear();
    const cfg = this.cfg();
    const msg = this.online.hosting
      ? `${cfg.away.name} are here. Press Kick off when you're both ready.`
      : this.online.role === "host"
        ? "Waiting for your friend to join. You can still change your club."
        : undefined;
    this.match.preMatch(cfg, msg);
    this.updateClock();
    this.syncPre();
    this.hideOverlays();
    el("preOver").hidden = false;
    this.setPreKick(true, "Kick off");
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
        ? "Online friendly"
        : cfg.mode === "pvp"
          ? "Two players"
          : `${DIFF_TEXT[this.s.diff]} computer`;
    el("preInfo").textContent = `${FMT_TEXT[cfg.fmt]} · ${who} · ${cfg.forms[0]} v ${cfg.forms[1]}`;
  }

  private showFullTime(): void {
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
    if (!this.online.guestSide)
      m.setStatus(`Full time. ${N(0)} ${m.score[0]}, ${N(1)} ${m.score[1]}.`, w ?? 0);
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
      this.setPreKick(
        false,
        this.online.role === "guest"
          ? "Waiting for your friend to kick off"
          : "Waiting for kick-off",
      );
    } else el("preOver").hidden = true;
    if (m.phase === "over" && prev !== "over") this.showFullTime();
    else if (m.phase !== "over") el("ftOver").hidden = true;
    this.updateClock();
    this.online.updateCard();
  }

  ended(keepMatch: boolean): void {
    if (!keepMatch) this.preMatch();
    else this.clearDirty();
  }

  playOnVsComputer(): void {
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
    el("diffSeg").classList.toggle("off", s.mode === "pvp");
    el<HTMLSelectElement>("awaySel").value = String(s.away);
    el<HTMLSelectElement>("fmtSel").value = s.fmt;
    el("oBox").hidden = s.away !== OPP;
    this.fillForms();
    el("snd").textContent = s.sound ? "Sound on" : "Sound off";
    this.syncCupBtn();
  }

  /** Settings only take effect at kick-off, so the button says so when they've changed. */
  private markDirty(): void {
    if (this.online.guestSide) return;
    const m = this.match;
    if (m.phase === "menu" && !m.cfg?.cup) return this.preMatch();
    const b = el("startBtn");
    b.classList.add("ready");
    b.textContent = "Kick off with these settings";
    el("kickHint").textContent = "Your changes start from the next kick-off.";
  }

  private clearDirty(): void {
    const b = el<HTMLButtonElement>("startBtn");
    if (this.online.guestSide) {
      b.classList.remove("ready");
      b.disabled = true;
      b.textContent = "Host kicks off";
      el("kickHint").textContent = "You're in your friend's online match.";
      return;
    }
    b.disabled = false;
    const pre = this.match.phase === "menu";
    b.classList.toggle("ready", pre);
    b.textContent = pre ? "Kick off" : "Restart match";
    el("kickHint").textContent = pre
      ? "The match starts when you press this."
      : this.online.hosting
        ? "Starts a fresh online match with your friend."
        : "Starts a fresh friendly with the settings below.";
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
    const s = this.s;
    this.seg("modeSeg", (v) => {
      s.mode = v === "pvp" ? "pvp" : "cpu";
      store.set("mode", s.mode);
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
