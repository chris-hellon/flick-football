import { afterEach, describe, expect, it, vi } from "vitest";
import { Ticker } from "../../src/client/src/ui/ticker";

describe("background ticker", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires every 50 ms until stopped (interval fallback without workers)", () => {
    vi.useFakeTimers();
    let n = 0;
    const t = new Ticker(() => n++);
    t.start();
    t.start(); // a second start doesn't double the rate
    expect(t.running).toBe(true);
    vi.advanceTimersByTime(500);
    expect(n).toBe(10);
    t.stop();
    expect(t.running).toBe(false);
    vi.advanceTimersByTime(500);
    expect(n).toBe(10);
  });
});
