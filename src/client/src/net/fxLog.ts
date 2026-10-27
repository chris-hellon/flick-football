import type { Fx } from "../rules/match";
import type { FxEntry, FxKind } from "./protocol";

const KEEP = 6;
const r2 = (v: number): number => Math.round(v * 100) / 100;

/** Plays sounds and, while hosting, remembers the last few so the guest can play them too. */
export class FxLog implements Fx {
  recording = false;
  entries: FxEntry[] = [];
  private n = 0;
  private readonly inner: Fx;

  constructor(inner: Fx) {
    this.inner = inner;
  }

  private log(kind: FxKind, a = 0, b = 0): void {
    if (!this.recording) return;
    this.entries.push([++this.n, kind, r2(a), r2(b)]);
    if (this.entries.length > KEEP) this.entries.shift();
  }

  tock(vol: number, pitch: number): void {
    this.log("t", vol, pitch);
    this.inner.tock(vol, pitch);
  }

  whistle(blasts: number): void {
    this.log("w", blasts);
    this.inner.whistle(blasts);
  }

  cheer(): void {
    this.log("c");
    this.inner.cheer();
  }

  ooh(): void {
    this.log("o");
    this.inner.ooh();
  }

  crowd(on: boolean): void {
    this.inner.crowd(on);
  }
}
