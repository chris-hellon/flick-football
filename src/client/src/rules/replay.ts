import type { World } from "../engine/world";

export const MAX_SEGMENT_FRAMES = 720;
const FRAME_LEN = 47; // 20 players + 2 keepers (x, y) + ball (x, y, spin)

/** Records every flick as a segment of frames; keeps the last two. */
export class Recorder {
  segments: Float32Array[][] = [];

  begin(): void {
    this.segments.push([]);
    if (this.segments.length > 2) this.segments.shift();
  }

  record(world: World): void {
    const seg = this.segments[this.segments.length - 1];
    if (!seg || seg.length > MAX_SEGMENT_FRAMES) return;
    const f = new Float32Array(FRAME_LEN);
    let i = 0;
    for (const p of world.players) {
      f[i++] = p.x;
      f[i++] = p.y;
    }
    for (const k of world.keepers) {
      f[i++] = k.x;
      f[i++] = k.y;
    }
    f[i++] = world.ball.x;
    f[i++] = world.ball.y;
    f[i] = world.ball.spin;
    seg.push(f);
  }

  /** Returns every recorded frame and clears the recording. */
  take(): Float32Array[] {
    const frames = this.segments.flat();
    this.segments = [];
    return frames;
  }

  clear(): void {
    this.segments = [];
  }
}

export function applyFrame(world: World, f: Float32Array): void {
  let i = 0;
  const at = (): number => f[i++] ?? 0;
  for (const p of world.players) {
    p.x = at();
    p.y = at();
  }
  for (const k of world.keepers) {
    k.x = at();
    k.y = at();
  }
  world.ball.x = at();
  world.ball.y = at();
  world.ball.spin = at();
}
