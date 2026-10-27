import type { TeamBody } from "../engine/body";
import { playerById } from "../engine/world";
import type { HubClient } from "../net/hub";
import { FxLog } from "../net/fxLog";
import { GuestView } from "../net/guestView";
import {
  buildState,
  changeKey,
  cleanAim,
  cleanFlick,
  cleanForm,
  cleanState,
  isCode,
  normaliseCode,
  type AimDto,
  type ClubDto,
  type JoinResult,
  type Seat,
} from "../net/protocol";
import { cleanClub, DEFAULT_OPP, type ClubData } from "../rules/clubs";
import type { FormationName } from "../rules/formations";
import type { Match } from "../rules/match";
import { el } from "./dom";

/** What the online controller needs from the page. */
export interface OnlineHost {
  readonly match: Match;
  /** Score or kits changed. */
  board(): void;
  myClub(): ClubDto;
  myForm(): FormationName;
  /** The friend's club changed (host side). */
  setFriendClub(club: ClubData): void;
  /** Re-run the pre-match card if we're on it (settings or players changed); force: whatever is showing. */
  refreshPreMatch(force?: boolean): void;
  /** Bring the pitch into view (on a phone the card you tapped is far below it). */
  showPitch(): void;
  /** Our seat changed: guest view on/off, flipped pitch, buttons. */
  seatChanged(): void;
  /** A snapshot arrived (guest or spectator). */
  showState(prev: string): void;
  /** Online play ended here; keepMatch leaves the current match running offline. */
  ended(keepMatch: boolean): void;
  /** The away side's player has gone for good: the computer plays on. */
  playOnVsComputer(): void;
  status(msg: string): void;
}

const SESSION_KEY = "ff_online";
const SEND_MS = 1000 / 15;
const AIM_MS = 100;
const DROP_OFFER_MS = 60_000;

interface Session {
  code: string;
  token: string;
}

function loadSession(): Session | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null") as unknown;
    if (v && typeof v === "object" && "code" in v && "token" in v) {
      const { code, token } = v as Record<string, unknown>;
      if (typeof code === "string" && isCode(code) && typeof token === "string")
        return { code, token };
    }
  } catch {
    // Storage blocked: no rejoin after refresh.
  }
  return null;
}

function saveSession(s: Session | null): void {
  try {
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage blocked.
  }
}

/** The "Play a friend online" card and everything that goes over the network. */
export class Online {
  role: Seat | null = null;
  code = "";
  /** Host: the guest is connected. Guest: the host is connected. */
  otherPresent = false;
  friendForm: FormationName = "4-4-2";
  /** The guest's aim preview, shown faded on the host. */
  remoteAim: AimDto | null = null;
  readonly view: GuestView;
  readonly fx: FxLog;
  private hub: HubClient | null = null;
  private token: string | null = null;
  private busy = false;
  private reconnecting = false;
  private lastFlickN = 0;
  private lastSkipN = 0;
  private flickSeq = 0;
  private skipSeq = 0;
  private sentAt = 0;
  private lastKey = "";
  private aimAt = 0;
  private dropTimer = 0;
  private readonly app: OnlineHost;

  constructor(app: OnlineHost, fx: FxLog) {
    this.app = app;
    this.fx = fx;
    this.view = new GuestView(app.match, fx, () => app.board());
    this.wire();
  }

  /** Watching or playing someone else's match: no local simulation. */
  get guestSide(): boolean {
    return this.role === "guest" || this.role === "spectator";
  }

  /** Hosting with the friend connected: matches use the online config. */
  get hosting(): boolean {
    return this.role === "host" && this.otherPresent;
  }

  /** On page load: take our seat back after a refresh, or fill in a code from a /m/CODE link. */
  resume(): void {
    const s = loadSession();
    const linked = /^\/m\/([A-Za-z0-9]{5})\/?$/.exec(location.pathname)?.[1];
    if (s && (!linked || normaliseCode(linked) === s.code)) {
      void this.join(s.code, s.token);
      return;
    }
    if (linked) {
      const code = normaliseCode(linked);
      el<HTMLInputElement>("onCode").value = code;
      this.app.status(`Tap Join to play in match ${code}.`);
      // The online card sits below the pitch on a phone: bring Join into view.
      el("onlineCard").scrollIntoView({ block: "center" });
      el("onJoin").focus({ preventScroll: true });
    }
  }

  // ---------- Connecting ----------
  private async connect(): Promise<HubClient | null> {
    if (this.hub?.connected) return this.hub;
    this.showError("Connecting…");
    try {
      const { HubClient } = await import("../net/hub");
      const hub = new HubClient(
        {
          GuestJoined: (club, form) => this.onGuestJoined(club, form),
          GuestLeft: () => this.onGuestLeft(),
          HostLeft: () => this.onHostLeft(),
          HostReturned: () => this.onHostReturned(),
          ClubUpdated: (club, form) => this.onClubUpdated(club, form),
          State: (s) => this.onState(s),
          Flick: (f) => this.onFlick(f),
          Aim: (a) => this.onAim(a),
          Skip: (n) => this.onSkip(n),
          RoomClosed: (reason) => this.onRoomClosed(reason),
        },
        {
          reconnecting: () => {
            this.reconnecting = true;
            this.updateCard();
          },
          reconnected: () => void this.rejoin(),
          closed: () => this.onConnectionLost(),
        },
      );
      await hub.start();
      this.hub = hub;
      this.showError("");
      return hub;
    } catch {
      this.showError("Couldn't reach the server. Check your connection and try again.");
      return null;
    }
  }

  async create(): Promise<void> {
    if (this.role || this.busy) return;
    this.busy = true;
    try {
      const hub = await this.connect();
      if (!hub) return;
      const r = await hub.createMatch(this.app.myClub(), this.app.myForm());
      if (!r.ok || !r.code || !r.token)
        return this.showError(r.error ?? "Couldn't open a match. Try again in a moment.");
      this.enter("host", r.code, r.token, false);
      this.app.refreshPreMatch(true);
    } finally {
      this.busy = false;
    }
  }

  async join(rawCode: string, token: string | null = null): Promise<void> {
    if (this.role || this.busy) return;
    const code = normaliseCode(rawCode);
    if (!isCode(code)) return this.showError("Enter the 5-character code your friend sees.");
    this.busy = true;
    try {
      const hub = await this.connect();
      if (!hub) return;
      const r = await hub.joinMatch(code, this.app.myClub(), this.app.myForm(), token);
      if (!r.ok || !r.seat || !r.token) {
        saveSession(null);
        return this.showError(r.error ?? "Couldn't join that match.");
      }
      this.applyJoin(r, code);
    } finally {
      this.busy = false;
    }
  }

  /** After an automatic reconnect: take the same seat back on the new connection. */
  private async rejoin(): Promise<void> {
    this.reconnecting = false;
    if (!this.hub || !this.role || !this.token) return this.updateCard();
    const r = await this.hub
      .joinMatch(this.code, this.app.myClub(), this.app.myForm(), this.token)
      .catch(() => null);
    if (!r?.ok || !r.seat) return this.end("The match closed while you were reconnecting.");
    if (this.role === "host") {
      this.otherPresent = r.otherPresent;
      this.lastKey = "";
    } else if (r.lastState) this.onState(r.lastState);
    this.updateCard();
  }

  private applyJoin(r: JoinResult, code: string): void {
    const seat = r.seat ?? "spectator";
    this.enter(seat, code, r.token ?? "", r.otherPresent);
    if (seat === "host") {
      // Back after a refresh: our match state is gone, so line up again with the friend if they're here.
      if (r.otherClub) {
        this.app.setFriendClub(cleanClub(r.otherClub, DEFAULT_OPP));
        this.friendForm = cleanForm(r.otherForm);
      }
      this.app.refreshPreMatch(true);
      return;
    }
    if (r.lastState) this.onState(r.lastState);
    else
      this.app.status(
        seat === "guest" ? "Connected. Your friend kicks off." : "Watching the match.",
      );
    this.app.showPitch();
  }

  private enter(seat: Seat, code: string, token: string, otherPresent: boolean): void {
    this.role = seat;
    this.code = code;
    this.token = token;
    this.otherPresent = otherPresent;
    this.lastFlickN = this.lastSkipN = 0;
    this.flickSeq = this.skipSeq = Date.now();
    this.lastKey = "";
    this.remoteAim = null;
    this.view.reset();
    this.fx.recording = seat === "host";
    this.fx.entries = [];
    saveSession({ code, token });
    history.replaceState(null, "", `/m/${code}`);
    this.showError("");
    this.app.seatChanged();
    this.updateCard();
  }

  /** Leaves on purpose. keepMatch: the host plays on against the computer. */
  async leave(keepMatch = false): Promise<void> {
    const hub = this.hub;
    this.hub = null;
    this.reset();
    if (hub) {
      await hub.leave();
      await hub.stop().catch(() => undefined);
    }
    this.app.ended(keepMatch);
  }

  private reset(): void {
    clearTimeout(this.dropTimer);
    this.role = null;
    this.code = "";
    this.token = null;
    this.otherPresent = false;
    this.remoteAim = null;
    this.reconnecting = false;
    this.fx.recording = false;
    saveSession(null);
    if (location.pathname !== "/") history.replaceState(null, "", "/");
    el("onDropped").hidden = true;
    this.app.seatChanged();
    this.updateCard();
  }

  private end(msg: string): void {
    const hub = this.hub;
    this.hub = null;
    this.reset();
    void hub?.stop().catch(() => undefined);
    this.app.ended(false);
    this.showError(msg);
  }

  private onConnectionLost(): void {
    if (!this.role) return;
    this.end("Lost the connection to the server. Join again with the same code to carry on.");
  }

  private onRoomClosed(reason: unknown): void {
    this.end(
      reason === "expired"
        ? "That online match has run its three hours, so it's closed."
        : "Your friend closed the online match.",
    );
  }

  // ---------- Host ----------
  private onGuestJoined(club: unknown, form: unknown): void {
    if (this.role !== "host") return;
    const back = this.app.match.cfg?.mode === "online" && this.app.match.phase !== "menu";
    this.otherPresent = true;
    this.remoteAim = null;
    clearTimeout(this.dropTimer);
    el("onDropped").hidden = true;
    this.app.setFriendClub(cleanClub(club, DEFAULT_OPP));
    this.friendForm = cleanForm(form);
    this.lastKey = "";
    if (back) this.app.status(`${this.app.match.name(1)} are back.`);
    else this.app.refreshPreMatch();
    this.updateCard();
  }

  private onGuestLeft(): void {
    if (this.role !== "host") return;
    this.otherPresent = false;
    this.remoteAim = null;
    const m = this.app.match;
    if (m.cfg?.mode === "online" && m.phase !== "menu" && m.phase !== "over") {
      this.app.status("Your friend has left. They can rejoin with the same code.");
      clearTimeout(this.dropTimer);
      this.dropTimer = window.setTimeout(() => {
        if (
          this.role === "host" &&
          !this.otherPresent &&
          m.phase !== "over" &&
          m.cfg?.mode === "online"
        )
          el("onDropped").hidden = false;
      }, DROP_OFFER_MS);
    } else this.app.refreshPreMatch();
    this.updateCard();
  }

  private onClubUpdated(club: unknown, form: unknown): void {
    if (this.role !== "host") return; // guests take kits from the snapshots
    this.app.setFriendClub(cleanClub(club, DEFAULT_OPP));
    this.friendForm = cleanForm(form);
    this.app.refreshPreMatch();
    this.updateCard();
  }

  private onFlick(raw: unknown): void {
    const f = cleanFlick(raw);
    const m = this.app.match;
    if (
      this.role !== "host" ||
      !f ||
      f.n <= this.lastFlickN ||
      m.cfg?.mode !== "online" ||
      m.actor() !== 1
    )
      return;
    const p = playerById(m.world, f.id);
    if (!p || p.team !== 1) return;
    this.lastFlickN = f.n;
    this.remoteAim = null;
    m.humanFlick(p, f.vx, f.vy);
  }

  private onSkip(n: unknown): void {
    const m = this.app.match;
    if (this.role !== "host" || typeof n !== "number" || n <= this.lastSkipN) return;
    this.lastSkipN = n;
    if (m.cfg?.mode === "online" && m.phase === "block" && m.actor() === 1)
      m.skipBlock(`${m.name(1)} skip the block flick. ${m.name(m.turn)} to flick.`);
  }

  private onAim(raw: unknown): void {
    const a = cleanAim(raw);
    const m = this.app.match;
    if (this.role === "host")
      this.remoteAim = a && m.cfg?.mode === "online" && m.actor() === 1 && a.id >= 10 ? a : null;
    else if (this.guestSide) this.view.hostAim = a;
  }

  /** Each frame while hosting: send a snapshot when something changed, at most 15 a second. */
  hostTick(now: number, aim: AimDto | null): void {
    if (this.role !== "host" || !this.hub?.connected || !this.app.match.cfg) return;
    if (now - this.sentAt < SEND_MS) return;
    const s = buildState(this.app.match, aim, this.fx.entries);
    const key = changeKey(s);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.sentAt = now;
    this.hub.publishState(s);
  }

  /** Our own club or shape changed. */
  clubChanged(): void {
    if (this.role === "host" || this.role === "guest")
      this.hub?.updateClub(this.app.myClub(), this.app.myForm());
  }

  // ---------- Guest ----------
  private onState(raw: unknown): void {
    if (!this.guestSide) return;
    const s = cleanState(raw);
    if (!s) return;
    this.otherPresent = true;
    const prev = this.view.apply(s);
    this.app.showState(prev);
  }

  private onHostLeft(): void {
    if (!this.guestSide) return;
    this.otherPresent = false;
    this.app.status(
      "Your friend has dropped out. They have two minutes to come back, or you can leave.",
    );
    this.fx.crowd(false);
    this.updateCard();
  }

  private onHostReturned(): void {
    if (!this.guestSide) return;
    this.otherPresent = true;
    this.app.status("Your friend is back. They'll set up the match again.");
    this.updateCard();
  }

  sendFlick(p: TeamBody, vx: number, vy: number): void {
    if (this.role !== "guest" || !this.hub) return;
    this.flickSeq = Math.max(this.flickSeq + 1, Date.now());
    const block = this.app.match.phase === "block";
    this.hub.sendFlick({
      n: this.flickSeq,
      id: p.id,
      vx: Math.round(vx),
      vy: Math.round(vy),
      b: block ? 1 : 0,
    });
  }

  /** Aim previews: at most 10 a second, and only while dragging. */
  sendAim(a: AimDto | null): void {
    if (this.role !== "guest" || !this.hub) return;
    const now = performance.now();
    if (a && now - this.aimAt < AIM_MS) return;
    this.aimAt = now;
    this.hub.sendAim(a);
  }

  sendSkip(): void {
    if (this.role !== "guest" || !this.hub || this.app.match.phase !== "block") return;
    this.skipSeq = Math.max(this.skipSeq + 1, Date.now());
    this.hub.sendSkip(this.skipSeq);
  }

  // ---------- Card ----------
  private wire(): void {
    el("onCreate").addEventListener("click", () => void this.create());
    el("onJoin").addEventListener(
      "click",
      () => void this.join(el<HTMLInputElement>("onCode").value),
    );
    const codeInput = el<HTMLInputElement>("onCode");
    codeInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void this.join(codeInput.value);
    });
    codeInput.addEventListener("input", () => {
      codeInput.value = normaliseCode(codeInput.value);
    });
    el("onLeave").addEventListener("click", () => void this.leave());
    el("onCopy").addEventListener("click", () => this.copy());
    el("onShare").addEventListener("click", () => void this.share());
    el("onPlayOn").addEventListener("click", () => {
      el("onDropped").hidden = true;
      this.app.playOnVsComputer();
    });
    el("onEnd").addEventListener("click", () => void this.leave());
  }

  private link(): string {
    return `${location.origin}/m/${this.code}`;
  }

  private copy(): void {
    const btn = el("onCopy");
    const done = (): void => {
      btn.textContent = "Copied";
      setTimeout(() => (btn.textContent = "Copy code"), 1500);
    };
    if (navigator.clipboard)
      navigator.clipboard.writeText(this.code).then(done, () => this.selectCode());
    else this.selectCode();
  }

  private async share(): Promise<void> {
    const url = this.link();
    if (navigator.share) {
      await navigator
        .share({
          title: "Flick Football",
          text: `Play me at Flick Football. Match code ${this.code}.`,
          url,
        })
        .catch(() => undefined);
      return;
    }
    const btn = el("onShare");
    await navigator.clipboard?.writeText(url).then(
      () => {
        btn.textContent = "Link copied";
        setTimeout(() => (btn.textContent = "Share link"), 1500);
      },
      () => this.selectCode(),
    );
  }

  private selectCode(): void {
    const rg = document.createRange();
    rg.selectNodeContents(el("onShowCode"));
    const sel = getSelection();
    sel?.removeAllRanges();
    sel?.addRange(rg);
  }

  showError(msg: string): void {
    el("onErr").textContent = msg;
    el("onErr").hidden = !msg;
  }

  updateCard(): void {
    const live = !!this.role;
    el("onIdle").hidden = live;
    el("onLive").hidden = !live;
    if (!live) return;
    el("onShowCode").textContent = this.code;
    el("onShare").hidden = this.role !== "host";
    const friend = this.app.match.name(1);
    let msg: string;
    if (this.reconnecting) msg = "Connection lost. Reconnecting…";
    else if (this.role === "host")
      msg = !this.otherPresent
        ? "Waiting for your friend. Send them the code or the link, and they enter the code under Join."
        : this.app.match.phase === "menu"
          ? `${friend} have joined. Press Kick off when you're ready.`
          : `Playing ${friend} online.`;
    else if (this.role === "spectator")
      msg = "This match already has two players, so you're watching.";
    else
      msg = this.otherPresent
        ? "Connected. Your friend kicks off."
        : "Your friend has dropped out. They have two minutes to come back.";
    el("onMsg").textContent = msg;
    el("onLeave").textContent = this.role === "host" ? "End online match" : "Leave online match";
  }
}
