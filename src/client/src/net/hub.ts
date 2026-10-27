import {
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
  type HubConnection,
} from "@microsoft/signalr";
import type { AimDto, ClubDto, CreateResult, FlickDto, JoinResult, StateDto } from "./protocol";

/** Server-to-client events. Arguments are untrusted. */
export interface HubEvents {
  GuestJoined(club: unknown, form: unknown): void;
  GuestLeft(): void;
  HostLeft(): void;
  HostReturned(): void;
  ClubUpdated(club: unknown, form: unknown): void;
  State(state: unknown): void;
  Flick(flick: unknown): void;
  Aim(aim: unknown): void;
  Skip(n: unknown): void;
  RoomClosed(reason: unknown): void;
}

export interface ConnectionEvents {
  reconnecting(): void;
  reconnected(): void;
  closed(): void;
}

const RETRY_DELAYS = [0, 1000, 3000, 5000, 10000];

/** A thin typed wrapper over the SignalR connection to /hubs/match, with automatic reconnect. */
export class HubClient {
  private readonly conn: HubConnection;

  constructor(events: HubEvents, conn: ConnectionEvents) {
    this.conn = new HubConnectionBuilder()
      .withUrl("/hubs/match")
      .withAutomaticReconnect(RETRY_DELAYS)
      .configureLogging(LogLevel.Warning)
      .build();
    for (const [name, fn] of Object.entries(events) as [
      keyof HubEvents,
      (...args: unknown[]) => void,
    ][]) {
      this.conn.on(name, fn);
    }
    this.conn.onreconnecting(() => conn.reconnecting());
    this.conn.onreconnected(() => conn.reconnected());
    this.conn.onclose(() => conn.closed());
  }

  get connected(): boolean {
    return this.conn.state === HubConnectionState.Connected;
  }

  start(): Promise<void> {
    return this.conn.start();
  }

  stop(): Promise<void> {
    return this.conn.stop();
  }

  createMatch(club: ClubDto, form: string): Promise<CreateResult> {
    return this.conn.invoke<CreateResult>("CreateMatch", club, form);
  }

  joinMatch(code: string, club: ClubDto, form: string, token: string | null): Promise<JoinResult> {
    return this.conn.invoke<JoinResult>("JoinMatch", code, club, form, token);
  }

  // Fire-and-forget sends: a dropped one is superseded by the next.
  updateClub(club: ClubDto, form: string): void {
    this.send("UpdateClub", club, form);
  }

  publishState(state: StateDto): void {
    this.send("PublishState", state);
  }

  sendFlick(flick: FlickDto): void {
    this.send("SendFlick", flick);
  }

  sendAim(aim: AimDto | null): void {
    this.send("SendAim", aim);
  }

  sendSkip(n: number): void {
    this.send("SendSkip", n);
  }

  async leave(): Promise<void> {
    if (this.connected) await this.conn.invoke("Leave").catch(() => undefined);
  }

  private send(method: string, ...args: unknown[]): void {
    if (this.connected) this.conn.send(method, ...args).catch(() => undefined);
  }
}
