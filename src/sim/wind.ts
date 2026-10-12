import { DEG, KN } from './boat';

/** Wind keyframe. speed/gustAmp in knots, dir = direction the wind blows FROM (deg, compass). */
export interface WindKey {
  t: number; // seconds of sim time
  speed: number;
  dir: number;
  gustAmp?: number; // knots added at a gust core
  gustRate?: number; // 0..1, density of gust cells
  shiftAmp?: number; // deg, amplitude of oscillating shifts
  shiftPeriod?: number; // s
}

export interface WindBase {
  speed: number;
  dir: number;
  gustAmp: number;
  gustRate: number;
  shiftAmp: number;
  shiftPeriod: number;
}

export interface WindSample {
  speed: number; // m/s at 10 m
  dir: number; // radians, FROM, compass
}

export function wrapDeg(a: number): number {
  return ((a % 360) + 540) % 360 - 180;
}

/** Interpolate direction along the shortest arc. Result in [0, 360). */
export function lerpDir(a: number, b: number, f: number): number {
  return (a + wrapDeg(b - a) * f + 360) % 360;
}

export function interpolateKeys(keys: WindKey[], t: number): WindBase {
  const k = keys;
  let i = 0;
  while (i < k.length - 1 && k[i + 1].t <= t) i++;
  const a = k[i];
  const b = k[Math.min(i + 1, k.length - 1)];
  const f = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
  const mix = (x: number | undefined, y: number | undefined, d: number) =>
    (x ?? d) + ((y ?? x ?? d) - (x ?? d)) * f;
  return {
    speed: mix(a.speed, b.speed, 0),
    dir: lerpDir(a.dir, b.dir, f),
    gustAmp: mix(a.gustAmp, b.gustAmp, 0),
    gustRate: mix(a.gustRate, b.gustRate, 0.5),
    shiftAmp: mix(a.shiftAmp, b.shiftAmp, 0),
    shiftPeriod: mix(a.shiftPeriod, b.shiftPeriod, 240),
  };
}

/** Hourly observation: [hour, speed kn, dir deg, gust kn]. */
export type HourRow = [number, number, number, number];

export const GUST_FACTOR_CAP = 1.6;

/**
 * Convert hourly reanalysis data into wind keys. `compression` = sim seconds per real hour
 * is derived from replay speed: e.g. 120x means one hour passes in 30 s of sim time.
 */
export function hourlyToKeys(rows: HourRow[], startHour: number, compression: number): WindKey[] {
  const secPerHour = 3600 / compression;
  return rows
    .filter((r) => r[0] >= startHour)
    .map(([h, speed, dir, gust]) => ({
      t: (h - startHour) * secPerHour,
      speed,
      dir,
      gustAmp: Math.max(0, Math.min(gust, GUST_FACTOR_CAP * speed) - speed),
      gustRate: 0.6,
      shiftAmp: 6,
      shiftPeriod: 300,
    }));
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface GustCell {
  x: number; // world east (m)
  y: number; // world north (m)
  radius: number;
  strength: number; // -1..1 (negative = lull), scaled by gustAmp
  age: number;
  life: number;
}

const FIELD = 1600; // gust cells live in a square of this size centred on the boat

/** Wind field: time-varying base plus drifting gust/lull cells. */
export class WindField {
  cells: GustCell[] = [];
  base: WindBase;
  t = 0;
  private rand: () => number;

  constructor(
    private keys: WindKey[],
    seed = 1,
  ) {
    this.rand = rng(seed);
    this.base = interpolateKeys(keys, 0);
  }

  setKeys(keys: WindKey[]) {
    this.keys = keys;
  }

  get duration(): number {
    return this.keys[this.keys.length - 1].t;
  }

  /** Base direction including oscillating shifts (deg). */
  baseDir(): number {
    const b = this.base;
    if (!b.shiftAmp) return b.dir;
    const ph = (2 * Math.PI * this.t) / b.shiftPeriod;
    // Two incommensurate harmonics make shifts irregular but deterministic.
    return (b.dir + b.shiftAmp * (0.75 * Math.sin(ph) + 0.25 * Math.sin(2.7 * ph + 1.3)) + 360) % 360;
  }

  step(dt: number, cx: number, cy: number) {
    this.t += dt;
    this.base = interpolateKeys(this.keys, this.t);
    const target = Math.round(4 + 20 * this.base.gustRate);
    const d = this.baseDir() * DEG;
    // Air moves toward dir+180
    const vx = -Math.sin(d) * this.base.speed * KN * 0.9;
    const vy = -Math.cos(d) * this.base.speed * KN * 0.9;
    for (const c of this.cells) {
      c.x += vx * dt;
      c.y += vy * dt;
      c.age += dt;
    }
    this.cells = this.cells.filter(
      (c) => c.age < c.life && Math.abs(c.x - cx) < FIELD && Math.abs(c.y - cy) < FIELD,
    );
    while (this.cells.length < target) this.cells.push(this.spawn(cx, cy, d, this.cells.length === 0));
  }

  private spawn(cx: number, cy: number, d: number, anywhere: boolean): GustCell {
    const r = this.rand;
    // Spawn upwind (or anywhere at start) so cells drift across the boat.
    const along = anywhere ? (r() - 0.5) * 2 * FIELD * 0.8 : FIELD * (0.5 + 0.4 * r());
    const across = (r() - 0.5) * 2 * FIELD * 0.8;
    const ux = Math.sin(d);
    const uy = Math.cos(d);
    return {
      x: cx + ux * along + uy * across,
      y: cy + uy * along - ux * across,
      radius: 70 + 160 * r(),
      strength: r() < 0.7 ? 0.5 + 0.5 * r() : -(0.3 + 0.4 * r()),
      age: anywhere ? r() * 60 : 0,
      life: 120 + 240 * r(),
    };
  }

  /** Normalised gust intensity at a point (sum of cell bumps, -1..1+). */
  gustAt(x: number, y: number): number {
    let g = 0;
    for (const c of this.cells) {
      const d2 = (x - c.x) ** 2 + (y - c.y) ** 2;
      const env = Math.min(1, c.age / 20, (c.life - c.age) / 20);
      g += c.strength * env * Math.exp(-d2 / (c.radius * c.radius));
    }
    return g;
  }

  sample(x: number, y: number): WindSample {
    const g = this.gustAt(x, y);
    const speed = Math.max(0, this.base.speed + g * this.base.gustAmp);
    // Gusts veer (northern hemisphere: wind from higher up is veered); lulls back.
    const dir = this.baseDir() + 6 * Math.max(-1, Math.min(1, g));
    return { speed: speed * KN, dir: (((dir % 360) + 360) % 360) * DEG };
  }
}
