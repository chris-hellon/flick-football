import { clamp } from "./math";

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Lightens (amt > 0) or darkens (amt < 0) a #rrggbb colour. */
export function shade(hex: string, amt: number): string {
  return (
    "#" +
    rgb(hex)
      .map((c) =>
        clamp(Math.round(c * (1 + amt)), 0, 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

export function greenish(hex: string): boolean {
  const [r, g, b] = rgb(hex);
  return g > r + 20 && g > b + 20;
}

export function hsl(h: number, s: number, l: number): string {
  const f = (n: number): string => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
      .toString(16)
      .padStart(2, "0");
  };
  return "#" + f(0) + f(8) + f(4);
}

export function colDist(x: string, y: string): number {
  const a = rgb(x);
  const b = rgb(y);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export const hexOk = (v: unknown): v is string =>
  typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
