export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/** A source of uniform random numbers in [0, 1). Injected so tests can seed it. */
export type Rng = () => number;

export const rnd = (rng: Rng, a: number, b: number): number => a + rng() * (b - a);

export const pick = <T>(rng: Rng, a: readonly T[]): T => {
  const v = a[Math.floor(rng() * a.length)];
  if (v === undefined) throw new Error("pick from an empty list");
  return v;
};

export function shuffle<T>(rng: Rng, a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

/** Small, fast seeded generator (mulberry32). */
export function seeded(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
