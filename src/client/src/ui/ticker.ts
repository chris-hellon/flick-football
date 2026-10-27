/** How often the ticker fires, in ms. */
const TICK_MS = 50;

/**
 * A steady timer that keeps firing in a background tab or a covered window, where browsers stop
 * animation frames and slow main-thread timers to once a second. It runs in a tiny worker, whose
 * timers aren't held back; without workers it falls back to a plain interval.
 */
export class Ticker {
  private worker: Worker | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly fn: () => void;

  constructor(fn: () => void) {
    this.fn = fn;
  }

  get running(): boolean {
    return this.worker !== null || this.interval !== null;
  }

  start(): void {
    if (this.running) return;
    if (typeof Worker !== "undefined") {
      const src = `setInterval(() => postMessage(0), ${TICK_MS});`;
      const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      try {
        this.worker = new Worker(url);
        this.worker.onmessage = () => this.fn();
        return;
      } catch {
        this.worker = null; // blocked (e.g. by a content security policy): use the interval
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    this.interval = setInterval(this.fn, TICK_MS);
  }

  stop(): void {
    this.worker?.terminate();
    this.worker = null;
    if (this.interval !== null) clearInterval(this.interval);
    this.interval = null;
  }
}
