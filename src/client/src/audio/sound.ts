import type { Fx } from "../rules/match";

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

/** Web Audio effects: tock, whistle, cheer, ooh and crowd ambience. Starts after the first tap. */
export class Sound implements Fx {
  enabled: boolean;
  private ac: AudioContext | null = null;
  private crowdGain: GainNode | null = null;
  private lastTock = 0;

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  /** Call from a user gesture: browsers only allow audio after one. */
  init(): void {
    if (!this.ac && this.enabled) {
      try {
        const Ctor = window.AudioContext ?? window.webkitAudioContext;
        if (Ctor) this.ac = new Ctor();
      } catch {
        this.ac = null;
      }
    }
    if (this.ac?.state === "suspended") void this.ac.resume();
  }

  private noiseBuf(ac: AudioContext, len: number): AudioBuffer {
    const b = ac.createBuffer(1, Math.floor(ac.sampleRate * len), ac.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  crowd(on: boolean): void {
    const ac = this.ac;
    if (!ac) return;
    if (!this.crowdGain) {
      const src = ac.createBufferSource();
      const f = ac.createBiquadFilter();
      const g = ac.createGain();
      src.buffer = this.noiseBuf(ac, 3);
      src.loop = true;
      f.type = "lowpass";
      f.frequency.value = 520;
      g.gain.value = 0;
      src.connect(f).connect(g).connect(ac.destination);
      src.start();
      this.crowdGain = g;
    }
    this.crowdGain.gain.setTargetAtTime(on && this.enabled ? 0.045 : 0, ac.currentTime, 0.4);
  }

  tock(vol: number, pitch: number): void {
    const ac = this.ac;
    if (!ac || !this.enabled) return;
    const now = ac.currentTime;
    if (now - this.lastTock < 0.03) return;
    this.lastTock = now;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(700 * pitch, now);
    o.frequency.exponentialRampToValueAtTime(160 * pitch, now + 0.07);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.25 * vol + 0.02, now + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    o.connect(g).connect(ac.destination);
    o.start(now);
    o.stop(now + 0.1);
  }

  private swell(freq: number, peak: number, len: number, q: number): BiquadFilterNode | null {
    const ac = this.ac;
    if (!ac || !this.enabled) return null;
    const now = ac.currentTime;
    const src = ac.createBufferSource();
    const f = ac.createBiquadFilter();
    const g = ac.createGain();
    src.buffer = this.noiseBuf(ac, len);
    f.type = "bandpass";
    f.frequency.setValueAtTime(freq, now);
    f.Q.value = q;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(peak, now + len * 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, now + len);
    src.connect(f).connect(g).connect(ac.destination);
    src.start(now);
    return f;
  }

  cheer(): void {
    this.swell(900, 0.4, 2.2, 0.6);
  }

  ooh(): void {
    const f = this.swell(520, 0.22, 1.1, 1.2);
    if (f && this.ac) f.frequency.exponentialRampToValueAtTime(300, this.ac.currentTime + 1);
  }

  /** 1 blast at kick-off, 2 at half time, 3 with a long last blast at full time. */
  whistle(n: number): void {
    const ac = this.ac;
    if (!ac || !this.enabled) return;
    let t = ac.currentTime + 0.05;
    for (let i = 0; i < n; i++) {
      const len = i === n - 1 && n === 3 ? 0.7 : 0.22;
      const o = ac.createOscillator();
      const lfo = ac.createOscillator();
      const ld = ac.createGain();
      const g = ac.createGain();
      o.type = "sine";
      o.frequency.value = 2900;
      lfo.frequency.value = 38;
      ld.gain.value = 140;
      lfo.connect(ld).connect(o.frequency);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.07, t + 0.02);
      g.gain.setValueAtTime(0.07, t + len - 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g).connect(ac.destination);
      o.start(t);
      lfo.start(t);
      o.stop(t + len);
      lfo.stop(t + len);
      t += len + 0.12;
    }
  }
}
